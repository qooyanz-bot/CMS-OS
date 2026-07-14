import { randomUUID } from "node:crypto";
import type { StateStore } from "../infrastructure/json-state-store.js";
import type { WebhookDelivery, WebhookSubscription } from "./types.js";

interface WebhookSubscriptionRecord extends WebhookSubscription {
  secretCiphertext: string;
}

export type WebhookDeliveryPatch = Omit<Partial<WebhookDelivery>, "error" | "nextRetryAt" | "deliveredAt"> & {
  error?: string | undefined;
  nextRetryAt?: string | undefined;
  deliveredAt?: string | undefined;
};

function cloneSubscription(subscription: WebhookSubscription): WebhookSubscription {
  return { ...subscription, events: [...subscription.events] };
}

function cloneDeliverySafely(delivery: WebhookDelivery): WebhookDelivery {
  return { ...delivery, payload: JSON.parse(JSON.stringify(delivery.payload)) as Record<string, unknown> };
}

export class WebhookStore {
  private readonly subscriptions: WebhookSubscriptionRecord[];
  private readonly deliveries: WebhookDelivery[];

  public constructor(private readonly stateStore?: StateStore) {
    this.subscriptions = (stateStore?.load<WebhookSubscriptionRecord[]>("webhook-subscriptions.json", []) ?? []).map((subscription) => ({
      ...subscription,
      events: [...subscription.events],
    }));
    this.deliveries = (stateStore?.load<WebhookDelivery[]>("webhook-deliveries.json", []) ?? []).map(cloneDeliverySafely);
  }

  public listSubscriptions(): WebhookSubscription[] {
    return this.subscriptions.map(cloneSubscription);
  }

  public getSubscription(subscriptionId: string): WebhookSubscriptionRecord | undefined {
    const subscription = this.subscriptions.find((candidate) => candidate.id === subscriptionId);
    return subscription ? { ...subscription, events: [...subscription.events] } : undefined;
  }

  public createSubscription(input: Omit<WebhookSubscriptionRecord, "id" | "createdAt" | "updatedAt">): WebhookSubscription {
    const now = new Date().toISOString();
    const subscription: WebhookSubscriptionRecord = {
      ...input,
      id: `webhook-${randomUUID()}`,
      createdAt: now,
      updatedAt: now,
    };
    this.subscriptions.push(subscription);
    this.persistSubscriptions();
    return cloneSubscription(subscription);
  }

  public updateSubscription(
    subscriptionId: string,
    patch: Partial<Pick<WebhookSubscriptionRecord, "endpointUrl" | "events" | "description" | "status">>,
  ): WebhookSubscription | undefined {
    const subscription = this.subscriptions.find((candidate) => candidate.id === subscriptionId);
    if (!subscription) return undefined;
    Object.assign(subscription, patch, { updatedAt: new Date().toISOString() });
    this.persistSubscriptions();
    return cloneSubscription(subscription);
  }

  public createDelivery(input: Omit<WebhookDelivery, "id" | "createdAt" | "updatedAt">): WebhookDelivery {
    const now = new Date().toISOString();
    const delivery: WebhookDelivery = { ...input, id: `delivery-${randomUUID()}`, createdAt: now, updatedAt: now };
    this.deliveries.push(delivery);
    this.persistDeliveries();
    return cloneDeliverySafely(delivery);
  }

  public listDeliveries(): WebhookDelivery[] {
    return this.deliveries.map(cloneDeliverySafely);
  }

  public getDelivery(deliveryId: string): WebhookDelivery | undefined {
    const delivery = this.deliveries.find((candidate) => candidate.id === deliveryId);
    return delivery ? cloneDeliverySafely(delivery) : undefined;
  }

  public updateDelivery(deliveryId: string, patch: WebhookDeliveryPatch): WebhookDelivery | undefined {
    const delivery = this.deliveries.find((candidate) => candidate.id === deliveryId);
    if (!delivery) return undefined;
    Object.assign(delivery, patch, { updatedAt: new Date().toISOString() });
    this.persistDeliveries();
    return cloneDeliverySafely(delivery);
  }

  public findPendingDeliveries(now: string, limit: number): WebhookDelivery[] {
    return this.deliveries
      .filter((delivery) => (delivery.status === "pending" || delivery.status === "retrying") && (!delivery.nextRetryAt || delivery.nextRetryAt <= now))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit)
      .map(cloneDeliverySafely);
  }

  private persistSubscriptions(): void {
    this.stateStore?.save("webhook-subscriptions.json", this.subscriptions);
  }

  private persistDeliveries(): void {
    this.stateStore?.save("webhook-deliveries.json", this.deliveries);
  }
}
