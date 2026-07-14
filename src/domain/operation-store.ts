import { randomUUID } from "node:crypto";
import type { StateStore } from "../infrastructure/json-state-store.js";
import type { CategorySlug } from "./types.js";

export const operationTypes = ["content.create", "content.create_batch", "content.propose_batch", "content.draft_batch", "content.polish_batch", "content.prepare_batch"] as const;
export type OperationType = (typeof operationTypes)[number];

export const operationStatuses = ["queued", "running", "succeeded", "failed"] as const;
export type OperationStatus = (typeof operationStatuses)[number];

export interface OperationJob {
  id: string;
  category: CategorySlug;
  providerId: string;
  operation: OperationType;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
  result?: Record<string, unknown> | undefined;
  error?: string | undefined;
}

export interface OperationJobRecord extends OperationJob {
  input: Record<string, unknown>;
  idempotencyKey?: string | undefined;
  inputFingerprint: string;
}

export type OperationJobPatch = Partial<Pick<OperationJobRecord, "status" | "startedAt" | "completedAt" | "result" | "error">>;

function cloneJob(job: OperationJobRecord): OperationJobRecord {
  return {
    ...job,
    input: JSON.parse(JSON.stringify(job.input)) as Record<string, unknown>,
    ...(job.result ? { result: JSON.parse(JSON.stringify(job.result)) as Record<string, unknown> } : {}),
  };
}

export class OperationStore {
  private readonly jobs: OperationJobRecord[];

  public constructor(private readonly stateStore?: StateStore) {
    this.jobs = (stateStore?.load<OperationJobRecord[]>("operation-jobs.json", []) ?? []).map(cloneJob);
  }

  public list(): OperationJobRecord[] {
    return this.jobs.map(cloneJob);
  }

  public get(operationId: string): OperationJobRecord | undefined {
    const job = this.jobs.find((candidate) => candidate.id === operationId);
    return job ? cloneJob(job) : undefined;
  }

  public findByIdempotencyKey(providerId: string, operation: OperationType, idempotencyKey: string): OperationJobRecord | undefined {
    const job = this.jobs.find((candidate) => candidate.providerId === providerId && candidate.operation === operation && candidate.idempotencyKey === idempotencyKey);
    return job ? cloneJob(job) : undefined;
  }

  public create(input: Omit<OperationJobRecord, "id" | "createdAt" | "updatedAt">): OperationJobRecord {
    const now = new Date().toISOString();
    const job: OperationJobRecord = { ...input, id: `operation-${randomUUID()}`, createdAt: now, updatedAt: now };
    this.jobs.push(job);
    this.persist();
    return cloneJob(job);
  }

  public update(operationId: string, patch: OperationJobPatch): OperationJobRecord | undefined {
    const job = this.jobs.find((candidate) => candidate.id === operationId);
    if (!job) return undefined;
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    this.persist();
    return cloneJob(job);
  }

  private persist(): void {
    this.stateStore?.save("operation-jobs.json", this.jobs);
  }
}
