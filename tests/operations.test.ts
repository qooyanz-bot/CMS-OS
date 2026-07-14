import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";
import { OperationStore } from "../src/domain/operation-store.js";
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

const contentInput = {
  category: "legal",
  contentType: "blog",
  audience: "customer",
  title: "相続相談の準備",
  summary: "相談前に確認したい項目をまとめます。",
  body: "# 相続相談の準備\n\n確認済みの情報をもとにした本文です。",
  sourceFacts: ["相談窓口の情報は確認済みです。"],
};

describe("CMS-OS非同期操作ジョブ", () => {
  it("コンテンツ作成ジョブを投入・重複排除・実行できる", async () => {
    const first = await request("/api/v1/operations", {
      method: "POST",
      headers: { "Idempotency-Key": "operation-test-content-1" },
      body: JSON.stringify({ operation: "content.create", input: contentInput }),
    });
    assert.equal(first.status, 202);
    assert.equal(first.body.item.status, "queued");
    const operationId = first.body.item.id as string;

    const repeated = await request("/api/v1/operations", {
      method: "POST",
      headers: { "Idempotency-Key": "operation-test-content-1" },
      body: JSON.stringify({ operation: "content.create", input: contentInput }),
    });
    assert.equal(repeated.status, 202);
    assert.equal(repeated.body.item.id, operationId);

    const conflict = await request("/api/v1/operations", {
      method: "POST",
      headers: { "Idempotency-Key": "operation-test-content-1" },
      body: JSON.stringify({ operation: "content.create", input: { ...contentInput, title: "別の入力" } }),
    });
    assert.equal(conflict.status, 409);

    const queued = await request(`/api/v1/operations/${operationId}`);
    assert.equal(queued.status, 200);
    assert.equal(queued.body.item.status, "queued");
    assert.equal(queued.body.item.input, undefined);

    const executed = await request(`/api/v1/operations/${operationId}/execute`, { method: "POST" });
    assert.equal(executed.status, 200);
    assert.equal(executed.body.item.status, "succeeded");
    assert.ok(executed.body.item.result.contentId);

    const content = await request(`/api/v1/content/${executed.body.item.result.contentId}`);
    assert.equal(content.status, 200);
  });

  it("MCPでジョブ一覧とキュー処理を実行し、別ロールからの取得を拒否する", async () => {
    const submitted = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({ operation: "content.create", input: { ...contentInput, title: "MCPキュー処理" } }),
    });
    assert.equal(submitted.status, 202);

    const listed = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "operation.list", arguments: {} } }),
    });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.result.structuredContent.items.some((item: { id: string }) => item.id === submitted.body.item.id));

    const executed = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "operation.execute_pending", arguments: { limit: 10 } } }),
    });
    assert.equal(executed.status, 200);
    assert.ok(executed.body.result.structuredContent.items.some((item: { id: string; status: string }) => item.id === submitted.body.item.id && item.status === "succeeded"));

    const ordererLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "orderer@example.com", password: "demo-password", category: "legal", role: "orderer" }),
    });
    const denied = await request(`/api/v1/operations/${submitted.body.item.id}`, { headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` } });
    assert.equal(denied.status, 403);
  });

  it("OperationStoreをStateStoreから再ロードできる", () => {
    const values = new Map<string, unknown>();
    const stateStore: StateStore = {
      load<T>(name: string, fallback: T): T { return (values.get(name) as T | undefined) ?? fallback; },
      save<T>(name: string, value: T): void { values.set(name, value); },
    };
    const first = new OperationStore(stateStore);
    const created = first.create({ category: "legal", providerId: "provider-legal-demo", operation: "content.create", status: "queued", input: { category: "legal", title: "保存対象" }, inputFingerprint: "fingerprint" });
    const second = new OperationStore(stateStore);
    assert.equal(second.get(created.id)?.input.title, "保存対象");
  });
});
