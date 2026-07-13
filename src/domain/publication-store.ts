import { randomUUID } from "node:crypto";
import type { StateStore } from "../infrastructure/json-state-store.js";
import type { PublicationHistoryRecord, PublicationScheduleRecord } from "./types.js";

export class PublicationStore {
  private readonly records: PublicationHistoryRecord[];
  private readonly schedules: PublicationScheduleRecord[];

  public constructor(private readonly stateStore?: StateStore) {
    this.records = stateStore?.load<PublicationHistoryRecord[]>("publication-history.json", []) ?? [];
    this.schedules = stateStore?.load<PublicationScheduleRecord[]>("publication-schedules.json", []) ?? [];
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

  public createSchedule(input: Omit<PublicationScheduleRecord, "id" | "createdAt" | "updatedAt"> & { id?: string }): PublicationScheduleRecord {
    const now = new Date().toISOString();
    const record: PublicationScheduleRecord = {
      ...input,
      id: input.id ?? `publication-schedule-${randomUUID()}`,
      contentIds: [...input.contentIds],
      createdAt: now,
      updatedAt: now,
    };
    this.schedules.push(record);
    this.stateStore?.save("publication-schedules.json", this.schedules);
    return record;
  }

  public getSchedule(scheduleId: string): PublicationScheduleRecord | undefined {
    return this.schedules.find((schedule) => schedule.id === scheduleId);
  }

  public listSchedules(
    category: PublicationScheduleRecord["category"],
    providerId: string,
  ): PublicationScheduleRecord[] {
    return this.schedules
      .filter((schedule) => schedule.category === category && schedule.providerId === providerId)
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
  }

  public updateSchedule(scheduleId: string, patch: Partial<PublicationScheduleRecord>): PublicationScheduleRecord | undefined {
    const schedule = this.getSchedule(scheduleId);
    if (!schedule) return undefined;
    Object.assign(schedule, patch, { updatedAt: new Date().toISOString() });
    this.stateStore?.save("publication-schedules.json", this.schedules);
    return schedule;
  }
}
