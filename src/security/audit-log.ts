import { randomBytes } from "node:crypto";
import type { StateStore } from "../infrastructure/json-state-store.js";
import type { CategorySlug, PortalRole } from "../domain/types.js";

export type AuditOutcome = "success" | "failure";

export interface AuthAuditEvent {
  id: string;
  occurredAt: string;
  type: string;
  outcome: AuditOutcome;
  accountId?: string;
  category?: CategorySlug;
  role?: PortalRole;
  reason?: string;
}

export interface AuditLogger {
  record(event: Omit<AuthAuditEvent, "id" | "occurredAt">): void;
}

/** 認証の成否だけを保存し、パスワード・アクセストークン・MFAコードは保存しない。 */
export class StateAuditLogger implements AuditLogger {
  private readonly events: AuthAuditEvent[];

  public constructor(
    private readonly stateStore: StateStore,
    private readonly maxEntries = 10_000,
  ) {
    this.events = stateStore.load<AuthAuditEvent[]>("auth-audit-log.json", []);
  }

  public record(event: Omit<AuthAuditEvent, "id" | "occurredAt">): void {
    this.events.push({
      ...event,
      id: `audit-${randomBytes(12).toString("hex")}`,
      occurredAt: new Date().toISOString(),
    });
    if (this.events.length > this.maxEntries) this.events.splice(0, this.events.length - this.maxEntries);
    this.stateStore.save("auth-audit-log.json", this.events);
  }
}
