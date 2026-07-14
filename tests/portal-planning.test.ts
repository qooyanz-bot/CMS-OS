import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { PortalPlanningService } from "../src/application/portal-planning-service.js";
import { createHttpServer } from "../src/api/http-server.js";
import { JsonStateStore } from "../src/infrastructure/json-state-store.js";

let server: Server;
let baseUrl: string;
let providerToken: string;
let ordererToken: string;
let auth: InMemoryAuthService;
let portal: PortalService;

before(async () => {
  auth = new InMemoryAuthService();
  const provider = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
  const orderer = auth.login("orderer@example.com", "demo-password", "legal", "orderer");
  if (!provider || !orderer || !("accessToken" in provider) || !("accessToken" in orderer)) throw new Error("テスト用の認証トークンを作成できません。");
  providerToken = provider.accessToken;
  ordererToken = orderer.accessToken;
  portal = new PortalService(auth);
  server = createHttpServer(auth, portal);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("テストサーバーのポートを取得できません。");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
}

describe("CMS-OS Portal Planning Agent", () => {
  it("RESTでテーマ・地域・目的から計画を生成し、所有者だけが一覧・取得できる", async () => {
    const created = await request("/api/v1/portal-plans", {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ category: "legal", theme: "企業法務", region: "東京", audience: "customer", goal: "conversion" }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.category, "legal");
    assert.equal(created.body.item.region, "東京");
    assert.ok(created.body.item.searchIntents.some((item: { kind: string }) => item.kind === "local"));
    assert.ok(created.body.item.pageIdeas.some((item: { id: string }) => item.id === "region-guide"));
    assert.ok(created.body.item.pageIdeas.some((item: { id: string }) => item.id === "request"));
    assert.ok(created.body.item.gaps.some((item: { code: string }) => item.code === "source_fact_review"));

    const listed = await request("/api/v1/portal-plans?limit=10", { headers: { authorization: `Bearer ${providerToken}` } });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 1);
    const planId = listed.body.items[0].id as string;
    const fetched = await request(`/api/v1/portal-plans/${planId}`, { headers: { authorization: `Bearer ${providerToken}` } });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.item.id, planId);

    const orderer = await request("/api/v1/portal-plans", {
      method: "POST",
      headers: { authorization: `Bearer ${ordererToken}` },
      body: JSON.stringify({ category: "legal", theme: "企業法務", audience: "customer" }),
    });
    assert.equal(orderer.status, 403);
  });

  it("MCPで応募意思のある人向けの求人計画を生成できる", async () => {
    const tools = await request("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
    const names = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("portal.plan"));
    assert.ok(names.includes("portal.plan.list"));
    assert.ok(names.includes("portal.plan.get"));

    const result = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "portal.plan", arguments: { category: "legal", theme: "企業法務", audience: "candidate", goal: "recruiting" } } }),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.result.structuredContent.goal, "recruiting");
    assert.ok(result.body.result.structuredContent.searchIntents.some((item: { kind: string }) => item.kind === "recruiting"));
    assert.ok(result.body.result.structuredContent.pageIdeas.some((item: { id: string }) => item.id === "jobs"));
  });

  it("PortalPlanStoreはStateStoreから計画を復元できる", async () => {
    const directory = await mkdtemp(`${tmpdir()}\\cms-os-portal-plan-`);
    try {
      const stateStore = new JsonStateStore(directory);
      const provider = auth.authenticate(providerToken);
      const first = new PortalPlanningService(portal, stateStore);
      const created = first.create(provider, { category: "legal", theme: "相続", audience: "customer" });
      const second = new PortalPlanningService(portal, stateStore);
      assert.equal(second.get(provider, created.id).theme, "相続");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
