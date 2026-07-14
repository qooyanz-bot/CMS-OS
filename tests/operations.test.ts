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

  it("同一カテゴリのコンテンツを最大50件まで一括ジョブで作成できる", async () => {
    const submitted = await request("/api/v1/operations", {
      method: "POST",
      headers: { "Idempotency-Key": "operation-test-content-batch-1" },
      body: JSON.stringify({
        operation: "content.create_batch",
        input: {
          category: "legal",
          items: [
            { ...contentInput, title: "一括作成・相談案内" },
            { ...contentInput, title: "一括作成・採用案内", audience: "candidate" },
          ],
        },
      }),
    });
    assert.equal(submitted.status, 202);
    assert.equal(submitted.body.item.operation, "content.create_batch");

    const executed = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "operation.execute", arguments: { operationId: submitted.body.item.id } },
      }),
    });
    assert.equal(executed.status, 200);
    const result = executed.body.result.structuredContent.result;
    assert.equal(executed.body.result.structuredContent.status, "succeeded");
    assert.equal(result.itemCount, 2);
    assert.equal(result.contentIds.length, 2);

    const oversized = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({
        operation: "content.create_batch",
        input: { category: "legal", items: Array.from({ length: 51 }, () => ({ ...contentInput })) },
      }),
    });
    assert.equal(oversized.status, 400);
  });

  it("対象ポジション別の企画案・下書き・清書を非同期で一括生成できる", async () => {
    const proposed = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({
        operation: "content.propose_batch",
        input: {
          category: "legal",
          items: [
            { category: "legal", contentType: "blog", audience: "customer", topic: "相談前の準備" },
            { category: "legal", contentType: "blog", audience: "candidate", topic: "法律事務所の働き方" },
          ],
        },
      }),
    });
    assert.equal(proposed.status, 202);
    assert.equal(proposed.body.item.operation, "content.propose_batch");

    const proposedResult = await request(`/api/v1/operations/${proposed.body.item.id}/execute`, { method: "POST" });
    assert.equal(proposedResult.status, 200);
    assert.equal(proposedResult.body.item.status, "succeeded");
    assert.equal(proposedResult.body.item.result.proposalIds.length, 2);

    const drafted = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({
        operation: "content.draft_batch",
        input: { category: "legal", proposalIds: proposedResult.body.item.result.proposalIds },
      }),
    });
    assert.equal(drafted.status, 202);
    const draftedResult = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "operation.execute", arguments: { operationId: drafted.body.item.id } } }),
    });
    assert.equal(draftedResult.status, 200);
    assert.equal(draftedResult.body.result.structuredContent.status, "succeeded");
    assert.equal(draftedResult.body.result.structuredContent.result.contentIds.length, 2);

    const polished = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({
        operation: "content.polish_batch",
        input: {
          category: "legal",
          contentIds: draftedResult.body.result.structuredContent.result.contentIds,
          instructions: "見出しと段落の読みやすさを優先してください。",
        },
      }),
    });
    assert.equal(polished.status, 202);
    assert.equal(polished.body.item.operation, "content.polish_batch");
    const polishedResult = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "operation.execute", arguments: { operationId: polished.body.item.id } } }),
    });
    assert.equal(polishedResult.status, 200);
    assert.equal(polishedResult.body.result.structuredContent.status, "succeeded");
    assert.equal(polishedResult.body.result.structuredContent.result.contentIds.length, 2);

    const polishedContent = await request(`/api/v1/content/${polishedResult.body.result.structuredContent.result.contentIds[0]}`);
    assert.equal(polishedContent.status, 200);
    assert.equal(polishedContent.body.item.status, "polished");
    assert.match(polishedContent.body.item.body, /清書方針/);

    const prepared = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({
        operation: "content.prepare_batch",
        input: {
          category: "legal",
          items: [{
            category: "legal",
            contentType: "blog",
            audience: "customer",
            topic: "相続相談の初回準備ガイド",
            sourceFacts: ["相談前に必要書類を確認できます。"],
          }],
          instructions: "相談者が次の行動へ進みやすい順序で整えてください。",
        },
      }),
    });
    assert.equal(prepared.status, 202);
    assert.equal(prepared.body.item.operation, "content.prepare_batch");
    const preparedResult = await request(`/api/v1/operations/${prepared.body.item.id}/execute`, { method: "POST" });
    assert.equal(preparedResult.status, 200);
    assert.equal(preparedResult.body.item.status, "succeeded");
    assert.equal(preparedResult.body.item.result.items.length, 1);
    assert.equal(preparedResult.body.item.result.items[0].factCheckPassed, true);
    assert.equal(preparedResult.body.item.result.items[0].status, "seo_reviewed");
    const preparedContent = await request(`/api/v1/content/${preparedResult.body.item.result.items[0].contentId}`);
    assert.equal(preparedContent.body.item.status, "seo_reviewed");
    assert.ok(preparedContent.body.item.lastFactCheck);
    assert.ok(preparedContent.body.item.lastSeoAudit);

    const partial = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({
        operation: "content.draft_batch",
        input: { category: "legal", proposalIds: [proposedResult.body.item.result.proposalIds[0], "proposal-does-not-exist"] },
      }),
    });
    const partialResult = await request(`/api/v1/operations/${partial.body.item.id}/execute`, { method: "POST" });
    assert.equal(partialResult.status, 200);
    assert.equal(partialResult.body.item.status, "failed");
    assert.equal(partialResult.body.item.result.completedCount, 1);
    assert.equal(partialResult.body.item.result.contentIds.length, 1);
    const retriedPartial = await request(`/api/v1/operations/${partial.body.item.id}/execute`, { method: "POST" });
    assert.equal(retriedPartial.status, 200);
    assert.equal(retriedPartial.body.item.status, "failed");
    assert.deepEqual(retriedPartial.body.item.result.contentIds, partialResult.body.item.result.contentIds);
    assert.equal(retriedPartial.body.item.result.completedCount, 1);

    const oversized = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({ operation: "content.propose_batch", input: { category: "legal", items: Array.from({ length: 51 }, () => ({ category: "legal", contentType: "blog", audience: "customer", topic: "大量企画" })) } }),
    });
    assert.equal(oversized.status, 400);

    const mixedCategory = await request("/api/v1/operations", {
      method: "POST",
      body: JSON.stringify({
        operation: "content.propose_batch",
        input: { category: "legal", items: [{ category: "beauty", contentType: "blog", audience: "customer", topic: "カテゴリ境界" }] },
      }),
    });
    assert.equal(mixedCategory.status, 400);
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
