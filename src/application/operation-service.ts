import { createHash } from "node:crypto";
import { ContentService, type ContentCreateInput, type ContentProposalCreateInput } from "./content-service.js";
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
  input: ContentCreateInput | ContentCreateBatchInput | ContentProposeBatchInput | ContentDraftBatchInput | ContentPolishBatchInput | ContentPrepareBatchInput;
};

export type ContentCreateBatchInput = {
  category: CategorySlug;
  items: ContentCreateInput[];
};

export type ContentProposeBatchInput = {
  category: CategorySlug;
  items: ContentProposalCreateInput[];
};

export type ContentDraftBatchInput = {
  category: CategorySlug;
  proposalIds: string[];
};

export type ContentPolishBatchInput = {
  category: CategorySlug;
  contentIds: string[];
  instructions?: string;
};

export type ContentPrepareBatchInput = {
  category: CategorySlug;
  items: ContentProposalCreateInput[];
  instructions?: string;
};

type ContentPrepareBatchItemResult = {
  inputIndex: number;
  proposalId?: string;
  contentId?: string;
  status?: string;
  factCheckPassed?: boolean;
  seoScore?: number;
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

function isItemsBatchInput(input: OperationSubmitInput["input"]): input is ContentCreateBatchInput | ContentProposeBatchInput {
  return "items" in input && Array.isArray(input.items);
}

function isDraftBatchInput(input: OperationSubmitInput["input"]): input is ContentDraftBatchInput {
  return "proposalIds" in input && Array.isArray(input.proposalIds);
}

function isPolishBatchInput(input: OperationSubmitInput["input"]): input is ContentPolishBatchInput {
  return "contentIds" in input && Array.isArray(input.contentIds);
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
    if (input.operation === "content.create_batch" || input.operation === "content.propose_batch" || input.operation === "content.prepare_batch") {
      if (!isItemsBatchInput(input.input) || input.input.items.length < 1 || input.input.items.length > MAX_BATCH_ITEMS) {
        throw new OperationServiceError(400, `${input.operation}は1〜${MAX_BATCH_ITEMS}件のitemsを指定してください。`);
      }
      if (input.input.category !== principal.category || input.input.items.some((item) => item.category !== principal.category)) {
        throw new OperationServiceError(403, "現在のカテゴリ以外にはジョブを投入できません。");
      }
      if (input.operation === "content.prepare_batch" && "instructions" in input.input && input.input.instructions !== undefined && (typeof input.input.instructions !== "string" || input.input.instructions.length > 1000)) {
        throw new OperationServiceError(400, "content.prepare_batchのinstructionsは1000文字以内で指定してください。");
      }
    } else if (input.operation === "content.draft_batch") {
      if (!isDraftBatchInput(input.input) || input.input.proposalIds.length < 1 || input.input.proposalIds.length > MAX_BATCH_ITEMS) {
        throw new OperationServiceError(400, `content.draft_batchは1〜${MAX_BATCH_ITEMS}件のproposalIdsを指定してください。`);
      }
      if (input.input.category !== principal.category || input.input.proposalIds.some((proposalId) => typeof proposalId !== "string" || proposalId.length === 0)) {
        throw new OperationServiceError(403, "現在のカテゴリ以外にはジョブを投入できません。");
      }
    } else if (input.operation === "content.polish_batch") {
      if (!isPolishBatchInput(input.input) || input.input.contentIds.length < 1 || input.input.contentIds.length > MAX_BATCH_ITEMS) {
        throw new OperationServiceError(400, `content.polish_batchは1〜${MAX_BATCH_ITEMS}件のcontentIdsを指定してください。`);
      }
      if (input.input.category !== principal.category || input.input.contentIds.some((contentId) => typeof contentId !== "string" || contentId.length === 0)) {
        throw new OperationServiceError(403, "現在のカテゴリ以外にはジョブを投入できません。");
      }
      if (input.input.instructions !== undefined && (typeof input.input.instructions !== "string" || input.input.instructions.length > 1000)) {
        throw new OperationServiceError(400, "instructionsは1000文字以内で指定してください。");
      }
    } else if (isItemsBatchInput(input.input) || isDraftBatchInput(input.input) || input.input.category !== principal.category) {
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
    const previousResult = job.status === "failed" ? job.result : undefined;
    const running = this.store.update(job.id, {
      status: "running",
      startedAt: new Date().toISOString(),
      error: undefined,
      completedAt: undefined,
      ...(previousResult ? { result: previousResult } : { result: undefined }),
    });
    if (!running) throw new OperationServiceError(404, "ジョブが見つかりません。");
    let partialResult: Record<string, unknown> | undefined;
    try {
      let result: Record<string, unknown>;
      if (job.operation === "content.create_batch") {
        const batch = running.input as unknown as ContentCreateBatchInput;
        const resumedIds = Array.isArray(previousResult?.contentIds)
          ? previousResult.contentIds.filter((value): value is string => typeof value === "string").slice(0, batch.items.length)
          : [];
        const contentIds = [...resumedIds];
        partialResult = { contentIds: [...contentIds], completedCount: contentIds.length, totalCount: batch.items.length };
        for (const item of batch.items.slice(contentIds.length)) {
          const created = this.content.createContent(principal, item);
          contentIds.push(created.id);
          partialResult = { contentIds: [...contentIds], completedCount: contentIds.length, totalCount: batch.items.length };
        }
        result = { contentIds, itemCount: contentIds.length };
      } else if (job.operation === "content.propose_batch") {
        const batch = running.input as unknown as ContentProposeBatchInput;
        const resumedIds = Array.isArray(previousResult?.proposalIds)
          ? previousResult.proposalIds.filter((value): value is string => typeof value === "string").slice(0, batch.items.length)
          : [];
        const proposalIds = [...resumedIds];
        partialResult = { proposalIds: [...proposalIds], completedCount: proposalIds.length, totalCount: batch.items.length };
        for (const item of batch.items.slice(proposalIds.length)) {
          const created = await this.content.createProposal(principal, item);
          proposalIds.push(created.id);
          partialResult = { proposalIds: [...proposalIds], completedCount: proposalIds.length, totalCount: batch.items.length };
        }
        result = { proposalIds, itemCount: proposalIds.length };
      } else if (job.operation === "content.draft_batch") {
        const batch = running.input as unknown as ContentDraftBatchInput;
        const resumedIds = Array.isArray(previousResult?.contentIds)
          ? previousResult.contentIds.filter((value): value is string => typeof value === "string").slice(0, batch.proposalIds.length)
          : [];
        const contentIds = [...resumedIds];
        partialResult = { contentIds: [...contentIds], completedCount: contentIds.length, totalCount: batch.proposalIds.length };
        for (const proposalId of batch.proposalIds.slice(contentIds.length)) {
          const created = await this.content.createDraft(principal, proposalId);
          contentIds.push(created.id);
          partialResult = { contentIds: [...contentIds], completedCount: contentIds.length, totalCount: batch.proposalIds.length };
        }
        result = { contentIds, itemCount: contentIds.length };
      } else if (job.operation === "content.polish_batch") {
        const batch = running.input as unknown as ContentPolishBatchInput;
        const resumedIds = Array.isArray(previousResult?.contentIds)
          ? previousResult.contentIds.filter((value): value is string => typeof value === "string").slice(0, batch.contentIds.length)
          : [];
        const contentIds = [...resumedIds];
        partialResult = { contentIds: [...contentIds], completedCount: contentIds.length, totalCount: batch.contentIds.length };
        for (const contentId of batch.contentIds.slice(contentIds.length)) {
          const polished = await this.content.polishContent(principal, contentId, batch.instructions);
          contentIds.push(polished.id);
          partialResult = { contentIds: [...contentIds], completedCount: contentIds.length, totalCount: batch.contentIds.length };
        }
        result = { contentIds, itemCount: contentIds.length };
      } else if (job.operation === "content.prepare_batch") {
        const batch = running.input as unknown as ContentPrepareBatchInput;
        const resumedItems: ContentPrepareBatchItemResult[] = Array.isArray(previousResult?.items)
          ? previousResult.items.slice(0, batch.items.length).map((value, inputIndex) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return { inputIndex };
            const item = value as Record<string, unknown>;
            return {
              inputIndex: typeof item.inputIndex === "number" ? item.inputIndex : inputIndex,
              ...(typeof item.proposalId === "string" ? { proposalId: item.proposalId } : {}),
              ...(typeof item.contentId === "string" ? { contentId: item.contentId } : {}),
              ...(typeof item.status === "string" ? { status: item.status } : {}),
              ...(typeof item.factCheckPassed === "boolean" ? { factCheckPassed: item.factCheckPassed } : {}),
              ...(typeof item.seoScore === "number" ? { seoScore: item.seoScore } : {}),
            };
          })
          : [];
        const items: ContentPrepareBatchItemResult[] = resumedItems;
        const savePrepareProgress = (): void => {
          partialResult = {
            items: items.map((item) => ({ ...item })),
            completedCount: items.filter((item) => item.status === "seo_reviewed").length,
            totalCount: batch.items.length,
          };
          if (!this.store.update(job.id, { result: partialResult })) throw new OperationServiceError(404, "ジョブが見つかりません。");
        };
        savePrepareProgress();
        for (let inputIndex = items.length; inputIndex < batch.items.length; inputIndex += 1) {
          items.push({ inputIndex });
        }
        for (const [inputIndex, item] of items.entries()) {
          if (item.status === "seo_reviewed") continue;
          if (!item.proposalId) {
            const proposal = await this.content.createProposal(principal, batch.items[inputIndex]!);
            item.proposalId = proposal.id;
            item.status = "proposed";
            savePrepareProgress();
          }
          if (!item.contentId) {
            const draft = await this.content.createDraft(principal, item.proposalId);
            item.contentId = draft.id;
            item.status = "drafted";
            savePrepareProgress();
          }
          if (item.status !== "polished") {
            const polished = await this.content.polishContent(principal, item.contentId, batch.instructions);
            item.contentId = polished.id;
            item.status = "polished";
            savePrepareProgress();
          }
          if (item.factCheckPassed === undefined) {
            const factCheck = this.content.factCheck(principal, item.contentId);
            item.factCheckPassed = factCheck.passed;
            savePrepareProgress();
          }
          if (item.status !== "seo_reviewed") {
            const seoAudit = this.content.auditSeo(principal, item.contentId);
            item.seoScore = seoAudit.score;
            const hasSeoErrors = seoAudit.issues.some((issue) => issue.severity === "error");
            item.status = item.factCheckPassed && !hasSeoErrors ? "seo_reviewed" : "polished";
            savePrepareProgress();
          }
        }
        result = { items, itemCount: items.length };
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
