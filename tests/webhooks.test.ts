import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";
import { WebhookStore } from "../src/domain/webhook-store.js";
import type { StateStore } from "../src/infrastructure/json-state-store.js";

let server: Server;
let baseUrl: string;
let token: string;

before(async () => {
  const auth = new InMemoryAuthService();
  const portal = new PortalService(auth);
  server = createHttpServer(auth, portal);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("テストサーバーのポートを取得できません");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const login = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
  });
  assert.equal(login.status, 200);
  token = login.body.accessToken;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl ?? "http://127.0.0.1"}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
}

describe("CMS-OS Webhook購読と配信アウトボックス", () => {
  it("RESTで購読を作成し、コンテンツ作成イベントを署名付きアウトボックスへ保存できる", async () => {
    const created = await request("/api/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({
        category: "legal",
        endpointUrl: "https://hooks.example.com/cms-os",
        events: ["content.created"],
        description: "顧客システム連携",
        secret: "webhook-secret-for-test-123456",
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.status, "active");
    assert.equal(created.body.secret, "webhook-secret-for-test-123456");
    assert.equal(created.body.item.secret, undefined);

    const content = await request("/api/v1/content", {
      method: "POST",
      body: JSON.stringify({
        category: "legal",
        contentType: "blog",
        audience: "customer",
        title: "相続相談ガイド",
        summary: "相談前に確認したい情報をまとめます。",
        body: "# 相続相談ガイド\n\n確認済み情報をもとにした本文です。",
        sourceFacts: ["相談窓口の情報は確認済みです。"],
      }),
    });
    assert.equal(content.status, 201);

    const deliveries = await request("/api/v1/webhooks/deliveries?eventType=content.created");
    assert.equal(deliveries.status, 200);
    assert.equal(deliveries.body.items.length, 1);
    assert.equal(deliveries.body.items[0].status, "pending");
    assert.match(deliveries.body.items[0].signature, /^sha256=/);
    assert.equal(deliveries.body.items[0].payload.data.contentId, content.body.item.id);

    const listed = await request("/api/v1/webhooks");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items[0].secret, undefined);
  });

  it("MCPで購読・配信一覧を取得し、購読を停止できる", async () => {
    const listed = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "webhook.list", arguments: {} } }),
    });
    assert.equal(listed.status, 200);
    const subscriptionId = listed.body.result.structuredContent.items[0].id as string;
    assert.ok(subscriptionId);

    const deliveries = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "webhook.deliveries", arguments: { eventType: "content.created" } } }),
    });
    assert.equal(deliveries.status, 200);
    assert.ok(deliveries.body.result.structuredContent.items.length >= 1);

    const updated = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "webhook.update", arguments: { subscriptionId, status: "paused" } } }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.result.structuredContent.status, "paused");

    const ordererLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "orderer@example.com", password: "demo-password", category: "legal", role: "orderer" }),
    });
    const denied = await request("/api/v1/webhooks", {
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
    });
    assert.equal(denied.status, 403);
  });

  it("購読と配信アウトボックスをStateStoreから再ロードできる", () => {
    const values = new Map<string, unknown>();
    const stateStore: StateStore = {
      load<T>(name: string, fallback: T): T { return (values.get(name) as T | undefined) ?? fallback; },
      save<T>(name: string, value: T): void { values.set(name, value); },
    };
    const first = new WebhookStore(stateStore);
    const subscription = first.createSubscription({ category: "beauty", providerId: "provider-beauty-demo", endpointUrl: "https://hooks.example.com/beauty", events: ["media.created"], secretHint: "1234", status: "active", secretCiphertext: "sealed-secret" });
    const delivery = first.createDelivery({ subscriptionId: subscription.id, category: "beauty", providerId: "provider-beauty-demo", eventType: "media.created", payload: { id: "event-1" }, signature: "sha256=test", status: "pending", attempts: 0 });
    const second = new WebhookStore(stateStore);
    assert.equal(second.getSubscription(subscription.id)?.secretCiphertext, "sealed-secret");
    assert.equal(second.getDelivery(delivery.id)?.payload.id, "event-1");
  });
});
