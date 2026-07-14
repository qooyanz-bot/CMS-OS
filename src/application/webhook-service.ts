import { createHmac, randomBytes } from "node:crypto";
import { WebhookStore } from "../domain/webhook-store.js";
import { webhookDeliveryStatuses, webhookEventTypes, webhookSubscriptionStatuses, type AuthenticatedPrincipal, type CategorySlug, type WebhookDelivery, type WebhookDeliveryStatus, type WebhookEventType, type WebhookSubscription } from "../domain/types.js";
import type { StateStore } from "../infrastructure/json-state-store.js";
import { openSecret, sealSecret } from "../security/secret-box.js";
import type { PortalPage, PortalService } from "./portal-service.js";

export class WebhookServiceError extends Error {
  public constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "WebhookServiceError";
  }
}

export type WebhookSubscriptionCreateInput = {
  category: CategorySlug;
  endpointUrl: string;
  events: WebhookEventType[];
  description?: string | undefined;
  secret?: string | undefined;
};

export type WebhookSubscriptionUpdateInput = Partial<Pick<WebhookSubscription, "endpointUrl" | "events" | "description" | "status">>;

export type WebhookSubscriptionCreateResult = {
  subscription: WebhookSubscription;
  secret: string;
};

export const webhookDeliverySortValues = ["createdAt_asc", "createdAt_desc"] as const;

const defaultWebhookEncryptionKey = "cms-os-development-webhook-encryption-key-please-change";
const maxDeliveryAttempts = 5;

function clonePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(payload)) as Record<string, unknown>;
}

function isSafeEndpointUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "169.254.169.254" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    return true;
  } catch {
    return false;
  }
}

export class WebhookService {
  private readonly store: WebhookStore;
  private readonly encryptionKey: string;

  public constructor(
    private readonly portal: PortalService,
    store?: WebhookStore,
    stateStore?: StateStore,
    encryptionKey = process.env.CMS_OS_WEBHOOK_ENCRYPTION_KEY ?? process.env.CMS_OS_AUTH_ENCRYPTION_KEY ?? defaultWebhookEncryptionKey,
  ) {
    this.store = store ?? new WebhookStore(stateStore);
    this.encryptionKey = encryptionKey;
  }

  public listSubscriptions(principal: AuthenticatedPrincipal | null): WebhookSubscription[] {
    this.assertProvider(principal, "webhook.read");
    return this.store.listSubscriptions().filter((subscription) => subscription.category === principal.category && subscription.providerId === principal.providerId);
  }

  public createSubscription(principal: AuthenticatedPrincipal | null, input: WebhookSubscriptionCreateInput): WebhookSubscriptionCreateResult {
    this.assertProvider(principal, "webhook.manage");
    if (input.category !== principal.category) throw new WebhookServiceError(403, "現在のカテゴリ以外にはWebhookを登録できません。");
    const endpointUrl = this.validateEndpointUrl(input.endpointUrl);
    const events = this.validateEvents(input.events);
    const description = this.validateDescription(input.description);
    const secret = input.secret?.trim() || randomBytes(32).toString("base64url");
    if (secret.length < 16 || secret.length > 200) throw new WebhookServiceError(400, "secretは16〜200文字で指定してください。");
    const existing = this.listSubscriptions(principal);
    if (existing.length >= 20) throw new WebhookServiceError(409, "Webhook購読は1事業者あたり20件まで登録できます。");
    const subscription = this.store.createSubscription({
      category: input.category,
      providerId: principal.providerId,
      endpointUrl,
      events,
      ...(description ? { description } : {}),
      secretHint: secret.slice(-4),
      status: "active",
      secretCiphertext: this.seal(secret),
    });
    return { subscription, secret };
  }

  public updateSubscription(principal: AuthenticatedPrincipal | null, subscriptionId: string, input: WebhookSubscriptionUpdateInput): WebhookSubscription {
    this.assertProvider(principal, "webhook.manage");
    const subscription = this.getOwnedSubscription(principal, subscriptionId);
    if (Object.keys(input).length === 0) throw new WebhookServiceError(400, "更新項目を1つ以上指定してください。");
    const patch: WebhookSubscriptionUpdateInput = {};
    if (input.endpointUrl !== undefined) patch.endpointUrl = this.validateEndpointUrl(input.endpointUrl);
    if (input.events !== undefined) patch.events = this.validateEvents(input.events);
    if (input.description !== undefined) patch.description = this.validateDescription(input.description);
    if (input.status !== undefined) {
      if (!webhookSubscriptionStatuses.includes(input.status)) throw new WebhookServiceError(400, "statusが不正です。");
      patch.status = input.status;
    }
    const updated = this.store.updateSubscription(subscription.id, patch);
    if (!updated) throw new WebhookServiceError(404, "Webhook購読が見つかりません。");
    return updated;
  }

  public revokeSubscription(principal: AuthenticatedPrincipal | null, subscriptionId: string): WebhookSubscription {
    return this.updateSubscription(principal, subscriptionId, { status: "revoked" });
  }

  public listDeliveries(
    principal: AuthenticatedPrincipal | null,
    filters: { status?: WebhookDeliveryStatus; eventType?: WebhookEventType; sort?: (typeof webhookDeliverySortValues)[number] } = {},
    pagination: { limit?: number; cursor?: number } = {},
  ): PortalPage<WebhookDelivery> {
    this.assertProvider(principal, "webhook.read");
    const limit = pagination.limit ?? 50;
    const cursor = pagination.cursor ?? 0;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new WebhookServiceError(400, "limitは1〜100で指定してください。");
    if (!Number.isSafeInteger(cursor) || cursor < 0) throw new WebhookServiceError(400, "cursorは0以上の整数で指定してください。");
    if (filters.status !== undefined && !webhookDeliveryStatuses.includes(filters.status)) throw new WebhookServiceError(400, "statusが不正です。");
    if (filters.eventType !== undefined && !webhookEventTypes.includes(filters.eventType)) throw new WebhookServiceError(400, "eventTypeが不正です。");
    if (filters.sort !== undefined && !webhookDeliverySortValues.includes(filters.sort)) throw new WebhookServiceError(400, "sortが不正です。");
    const items = this.store.listDeliveries()
      .filter((delivery) => delivery.category === principal.category && delivery.providerId === principal.providerId)
      .filter((delivery) => !filters.status || delivery.status === filters.status)
      .filter((delivery) => !filters.eventType || delivery.eventType === filters.eventType);
    items.sort((left, right) => filters.sort === "createdAt_asc" ? left.createdAt.localeCompare(right.createdAt) : right.createdAt.localeCompare(left.createdAt));
    const pageItems = items.slice(cursor, cursor + limit);
    const nextCursor = cursor + pageItems.length < items.length ? String(cursor + pageItems.length) : undefined;
    return { items: pageItems, page: { limit, ...(nextCursor ? { nextCursor } : {}) } };
  }

  public retryDelivery(principal: AuthenticatedPrincipal | null, deliveryId: string): WebhookDelivery {
    this.assertProvider(principal, "webhook.manage");
    const delivery = this.getOwnedDelivery(principal, deliveryId);
    if (delivery.status === "delivered") throw new WebhookServiceError(409, "配信済みWebhookは再試行できません。");
    const subscription = this.getOwnedSubscription(principal, delivery.subscriptionId);
    if (subscription.status !== "active") throw new WebhookServiceError(409, "有効なWebhook購読だけ再試行できます。");
    const updated = this.store.updateDelivery(delivery.id, { status: "pending", error: undefined, nextRetryAt: undefined });
    if (!updated) throw new WebhookServiceError(404, "Webhook配信が見つかりません。");
    return updated;
  }

  public async deliverDelivery(principal: AuthenticatedPrincipal | null, deliveryId: string): Promise<WebhookDelivery> {
    this.assertProvider(principal, "webhook.manage");
    const delivery = this.getOwnedDelivery(principal, deliveryId);
    const subscription = this.getOwnedSubscription(principal, delivery.subscriptionId);
    if (subscription.status !== "active") throw new WebhookServiceError(409, "有効なWebhook購読だけ配信できます。");
    if (delivery.status === "delivered") return delivery;
    if (delivery.attempts >= maxDeliveryAttempts) throw new WebhookServiceError(409, "最大試行回数に達したWebhookです。再試行操作で明示的に再開してください。");
    const attemptedAt = new Date().toISOString();
    const attempts = delivery.attempts + 1;
    const body = JSON.stringify(delivery.payload);
    try {
      const response = await fetch(subscription.endpointUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "user-agent": "CMS-OS-Webhook/0.1",
          "x-cms-os-event": delivery.eventType,
          "x-cms-os-delivery": delivery.id,
          "x-cms-os-signature": delivery.signature,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) {
        const updated = this.store.updateDelivery(delivery.id, { status: "delivered", attempts, responseStatus: response.status, lastAttemptAt: attemptedAt, deliveredAt: attemptedAt, error: undefined, nextRetryAt: undefined });
        if (!updated) throw new WebhookServiceError(404, "Webhook配信が見つかりません。");
        return updated;
      }
      return this.saveFailedAttempt(delivery, attempts, attemptedAt, response.status, `HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof WebhookServiceError) throw error;
      return this.saveFailedAttempt(delivery, attempts, attemptedAt, undefined, error instanceof Error ? error.message : "Webhook送信に失敗しました。");
    }
  }

  public async deliverPending(principal: AuthenticatedPrincipal | null, limit = 10): Promise<WebhookDelivery[]> {
    this.assertProvider(principal, "webhook.manage");
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new WebhookServiceError(400, "limitは1〜50で指定してください。");
    const candidates = this.store.findPendingDeliveries(new Date().toISOString(), limit).filter((delivery) => delivery.category === principal.category && delivery.providerId === principal.providerId);
    const results: WebhookDelivery[] = [];
    for (const delivery of candidates) {
      try {
        results.push(await this.deliverDelivery(principal, delivery.id));
      } catch (error) {
        if (error instanceof WebhookServiceError && error.statusCode < 500) throw error;
        const refreshed = this.store.getDelivery(delivery.id);
        if (refreshed) results.push(refreshed);
      }
    }
    return results;
  }

  public emit(category: CategorySlug, providerId: string, eventType: WebhookEventType, data: Record<string, unknown>): WebhookDelivery[] {
    if (!webhookEventTypes.includes(eventType)) throw new WebhookServiceError(400, "eventTypeが不正です。");
    const occurredAt = new Date().toISOString();
    const subscriptions = this.store.listSubscriptions().filter((subscription) => subscription.category === category && subscription.providerId === providerId && subscription.status === "active" && subscription.events.includes(eventType));
    return subscriptions.flatMap((subscription) => {
      const record = this.store.getSubscription(subscription.id);
      if (!record) return [];
      const payload: Record<string, unknown> = { id: `event-${randomBytes(12).toString("hex")}`, type: eventType, category, providerId, occurredAt, data: clonePayload(data) };
      const serialized = JSON.stringify(payload);
      const signature = `sha256=${createHmac("sha256", this.open(record.secretCiphertext)).update(serialized, "utf8").digest("hex")}`;
      return [this.store.createDelivery({ subscriptionId: subscription.id, category, providerId, eventType, payload, signature, status: "pending", attempts: 0 })];
    });
  }

  private saveFailedAttempt(delivery: WebhookDelivery, attempts: number, attemptedAt: string, responseStatus: number | undefined, error: string): WebhookDelivery {
    const status: WebhookDeliveryStatus = attempts < maxDeliveryAttempts ? "retrying" : "failed";
    const nextRetryAt = status === "retrying" ? new Date(Date.now() + Math.min(3_600_000, 30_000 * (2 ** (attempts - 1)))).toISOString() : undefined;
    const updated = this.store.updateDelivery(delivery.id, { status, attempts, ...(responseStatus !== undefined ? { responseStatus } : {}), lastAttemptAt: attemptedAt, error: error.slice(0, 1000), ...(nextRetryAt ? { nextRetryAt } : {}) });
    if (!updated) throw new WebhookServiceError(404, "Webhook配信が見つかりません。");
    return updated;
  }

  private getOwnedSubscription(principal: AuthenticatedPrincipal, subscriptionId: string): WebhookSubscription {
    const subscription = this.store.getSubscription(subscriptionId);
    if (!subscription || subscription.category !== principal.category || subscription.providerId !== principal.providerId) throw new WebhookServiceError(404, "Webhook購読が見つかりません。");
    return { ...subscription, events: [...subscription.events] };
  }

  private getOwnedDelivery(principal: AuthenticatedPrincipal, deliveryId: string): WebhookDelivery {
    const delivery = this.store.getDelivery(deliveryId);
    if (!delivery || delivery.category !== principal.category || delivery.providerId !== principal.providerId) throw new WebhookServiceError(404, "Webhook配信が見つかりません。");
    return delivery;
  }

  private assertProvider(principal: AuthenticatedPrincipal | null, action: "webhook.read" | "webhook.manage"): asserts principal is AuthenticatedPrincipal & { role: "provider"; providerId: string } {
    if (!principal) throw new WebhookServiceError(401, "ログインが必要です。");
    if (principal.role !== "provider" || !principal.providerId) throw new WebhookServiceError(403, "Webhook管理は事業者のみ利用できます。");
    this.portal.assertAction(principal, principal.category, action);
  }

  private validateEndpointUrl(value: string): string {
    const endpointUrl = value.trim();
    if (endpointUrl.length > 500 || !isSafeEndpointUrl(endpointUrl)) throw new WebhookServiceError(400, "endpointUrlは安全なhttpまたはhttpsのURLで指定してください。");
    return endpointUrl;
  }

  private validateEvents(values: WebhookEventType[]): WebhookEventType[] {
    if (!Array.isArray(values) || values.length < 1 || values.length > webhookEventTypes.length || new Set(values).size !== values.length || values.some((value) => !webhookEventTypes.includes(value))) throw new WebhookServiceError(400, "eventsは重複しない有効なイベントを1件以上指定してください。");
    return [...values];
  }

  private validateDescription(value: string | undefined): string {
    if (value === undefined) return "";
    const description = value.trim();
    if (description.length > 200) throw new WebhookServiceError(400, "descriptionは200文字以内で指定してください。");
    return description;
  }

  private seal(value: string): string {
    try {
      return sealSecret(value, this.encryptionKey);
    } catch (error) {
      throw new WebhookServiceError(500, error instanceof Error ? error.message : "Webhook secretを暗号化できません。");
    }
  }

  private open(value: string): string {
    try {
      return openSecret(value, this.encryptionKey);
    } catch {
      throw new WebhookServiceError(500, "Webhook secretを復号できません。暗号化キーを確認してください。");
    }
  }
}
