import { randomUUID } from "node:crypto";
import type { StateStore } from "../infrastructure/json-state-store.js";
import type { PublicationHistoryRecord } from "./types.js";

export class PublicationStore {
  private readonly records: PublicationHistoryRecord[];

  public constructor(private readonly stateStore?: StateStore) {
    this.records = stateStore?.load<PublicationHistoryRecord[]>("publication-history.json", []) ?? [];
  }

  public create(input: Omit<PublicationHistoryRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): PublicationHistoryRecord {
    const now = new Date().toISOString();
    const record: PublicationHistoryRecord = {
      ...input,
      id: input.id ?? `publication-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.records.push(record);
    this.stateStore?.save("publication-history.json", this.records);
    return record;
  }

  public get(publicationId: string): PublicationHistoryRecord | undefined {
    return this.records.find((record) => record.id === publicationId);
  }

  public list(category: PublicationHistoryRecord["category"], providerId: string): PublicationHistoryRecord[] {
    return this.records
      .filter((record) => record.category === category && record.providerId === providerId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  public update(publicationId: string, patch: Partial<PublicationHistoryRecord>): PublicationHistoryRecord | undefined {
    const record = this.get(publicationId);
    if (!record) return undefined;
    Object.assign(record, patch, { updatedAt: new Date().toISOString() });
    this.stateStore?.save("publication-history.json", this.records);
    return record;
  }
}
