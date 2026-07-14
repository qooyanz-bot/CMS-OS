import { createHash } from "node:crypto";
import { ContentService, type ContentCreateInput } from "./content-service.js";
import type { PortalService, PortalPage } from "./portal-service.js";
import { operationTypes, OperationStore, type OperationJob, type OperationJobRecord, type OperationType } from "../domain/operation-store.js";
import type { AuthenticatedPrincipal, CategorySlug } from "../domain/types.js";
import type { StateStore } from "../infrastructure/json-state-store.js";

export class OperationServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "OperationServiceError";
  }
}

export type OperationSubmitInput = {
  operation: OperationType;
  input: ContentCreateInput | ContentCreateBatchInput;
};

export type ContentCreateBatchInput = {
  category: CategorySlug;
  items: ContentCreateInput[];
};

export const MAX_BATCH_ITEMS = 50;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, canonicalize(nested)]));
  }
  return value;
}

function fingerprint(input: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(input)), "utf8").digest("hex");
}

function cloneInput(input: OperationSubmitInput["input"]): Record<string, unknown> {
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

function isBatchInput(input: OperationSubmitInput["input"]): input is ContentCreateBatchInput {
  return "items" in input && Array.isArray(input.items);
}

export class OperationService {
  private readonly store: OperationStore;

  public constructor(
    private readonly portal: PortalService,
    private readonly content: ContentService,
    stateStore?: StateStore,
    store?: OperationStore,
  ) {
    this.store = store ?? new OperationStore(stateStore);
  }

  public submit(principal: AuthenticatedPrincipal | null, input: OperationSubmitInput, idempotencyKey?: string): OperationJob {
    this.assertProvider(principal, "operation.submit");
    if (!operationTypes.includes(input.operation)) throw new OperationServiceError(400, "operationが不正です。");
    if (input.operation === "content.create_batch") {
      if (!isBatchInput(input.input) || input.input.items.length < 1 || input.input.items.length > MAX_BATCH_ITEMS) {
        throw new OperationServiceError(400, `content.create_batchは1〜${MAX_BATCH_ITEMS}件のitemsを指定してください。`);
      }
      if (input.input.category !== principal.category || input.input.items.some((item) => item.category !== principal.category)) {
        throw new OperationServiceError(403, "現在のカテゴリ以外にはジョブを投入できません。");
      }
    } else if (isBatchInput(input.input) || input.input.category !== principal.category) {
      throw new OperationServiceError(403, "現在のカテゴリ以外にはジョブを投入できません。");
    }
    const normalizedKey = idempotencyKey?.trim();
    if (normalizedKey && (normalizedKey.length < 1 || normalizedKey.length > 200)) throw new OperationServiceError(400, "Idempotency-Keyは200文字以内で指定してください。");
    const storedInput = cloneInput(input.input);
    const inputFingerprint = fingerprint(storedInput);
    if (normalizedKey) {
      const existing = this.store.findByIdempotencyKey(principal.providerId, input.operation, normalizedKey);
      if (existing) {
        if (existing.inputFingerprint !== inputFingerprint) throw new OperationServiceError(409, "同じIdempotency-Keyに異なる入力は指定できません。");
        return this.toSummary(existing);
      }
    }
    const created = this.store.create({
      category: principal.category,
      providerId: principal.providerId,
      operation: input.operation,
      status: "queued",
      input: storedInput,
      ...(normalizedKey ? { idempotencyKey: normalizedKey } : {}),
      inputFingerprint,
    });
    return this.toSummary(created);
  }

  public list(principal: AuthenticatedPrincipal | null, pagination: { limit?: number; cursor?: number } = {}): PortalPage<OperationJob> {
    this.assertProvider(principal, "operation.read");
    const limit = pagination.limit ?? 50;
    const cursor = pagination.cursor ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new OperationServiceError(400, "limitは1〜100で指定してください。");
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new OperationServiceError(400, "cursorは0以上の整数で指定してください。");
    const items = this.store.list()
      .filter((job) => job.category === principal.category && job.providerId === principal.providerId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const pageItems = items.slice(cursor, cursor + limit).map((job) => this.toSummary(job));
    const nextCursor = cursor + pageItems.length < items.length ? String(cursor + pageItems.length) : undefined;
    return { items: pageItems, page: { limit, ...(nextCursor ? { nextCursor } : {}) } };
  }

  public get(principal: AuthenticatedPrincipal | null, operationId: string): OperationJob {
    this.assertProvider(principal, "operation.read");
    return this.toSummary(this.getOwned(principal, operationId));
  }

  public async execute(principal: AuthenticatedPrincipal | null, operationId: string): Promise<OperationJob> {
    this.assertProvider(principal, "operation.submit");
    const job = this.getOwned(principal, operationId);
    if (job.status === "succeeded") return this.toSummary(job);
    if (job.status === "running") throw new OperationServiceError(409, "ジョブはすでに実行中です。");
    const running = this.store.update(job.id, { status: "running", startedAt: new Date().toISOString(), error: undefined, completedAt: undefined, result: undefined });
    if (!running) throw new OperationServiceError(404, "ジョブが見つかりません。");
    let partialResult: Record<string, unknown> | undefined;
    try {
      let result: Record<string, unknown>;
      if (job.operation === "content.create_batch") {
        const batch = running.input as unknown as ContentCreateBatchInput;
        const contentIds: string[] = [];
        partialResult = { contentIds, completedCount: 0, totalCount: batch.items.length };
        for (const item of batch.items) {
          const created = this.content.createContent(principal, item);
          contentIds.push(created.id);
          partialResult = { contentIds: [...contentIds], completedCount: contentIds.length, totalCount: batch.items.length };
        }
        result = { contentIds, itemCount: contentIds.length };
      } else {
        const created = this.content.createContent(principal, running.input as unknown as ContentCreateInput);
        result = { contentId: created.id };
      }
      const completed = this.store.update(job.id, { status: "succeeded", completedAt: new Date().toISOString(), result });
      if (!completed) throw new OperationServiceError(404, "ジョブが見つかりません。");
      return this.toSummary(completed);
    } catch (error) {
      const failed = this.store.update(job.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message.slice(0, 1000) : "ジョブの実行に失敗しました。",
        ...(partialResult ? { result: partialResult } : {}),
      });
      if (!failed) throw new OperationServiceError(404, "ジョブが見つかりません。");
      return this.toSummary(failed);
    }
  }

  public async executePending(principal: AuthenticatedPrincipal | null, limit = 10): Promise<OperationJob[]> {
    this.assertProvider(principal, "operation.submit");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new OperationServiceError(400, "limitは1〜50で指定してください。");
    const queued = this.store.list()
      .filter((job) => job.category === principal.category && job.providerId === principal.providerId && job.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
    const results: OperationJob[] = [];
    for (const job of queued) results.push(await this.execute(principal, job.id));
    return results;
  }

  private getOwned(principal: AuthenticatedPrincipal, operationId: string): OperationJobRecord {
    const job = this.store.get(operationId);
    if (!job || job.category !== principal.category || job.providerId !== principal.providerId) throw new OperationServiceError(404, "ジョブが見つかりません。");
    return job;
  }

  private toSummary(job: OperationJobRecord): OperationJob {
    return {
      id: job.id,
      category: job.category,
      providerId: job.providerId,
      operation: job.operation,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      ...(job.startedAt ? { startedAt: job.startedAt } : {}),
      ...(job.completedAt ? { completedAt: job.completedAt } : {}),
      ...(job.result ? { result: job.result } : {}),
      ...(job.error ? { error: job.error } : {}),
    };
  }

  private assertProvider(principal: AuthenticatedPrincipal | null, action: "operation.read" | "operation.submit"): asserts principal is AuthenticatedPrincipal & { role: "provider"; providerId: string } {
    if (!principal) throw new OperationServiceError(401, "ログインが必要です。");
    if (principal.role !== "provider" || !principal.providerId) throw new OperationServiceError(403, "非同期ジョブは事業者のみ利用できます。");
    this.portal.assertAction(principal, principal.category as CategorySlug, action);
  }
}
