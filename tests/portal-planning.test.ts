import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { ContentService } from "../src/application/content-service.js";
import { PortalPlanningService } from "../src/application/portal-planning-service.js";
import { createHttpServer } from "../src/api/http-server.js";
import { JsonStateStore } from "../src/infrastructure/json-state-store.js";
import { DeterministicContentAgentAdapter, type ContentAgentAdapter } from "../src/integrations/content-agent-adapter.js";

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
    assert.equal(created.body.item.coverage.contentCount, 0);
    assert.equal(created.body.item.coverage.publishedContentCount, 0);
    assert.equal(created.body.item.coverage.matchingContentCount, 0);
    assert.ok(created.body.item.gaps.some((item: { code: string }) => item.code === "content_theme_coverage_missing"));

    const listed = await request("/api/v1/portal-plans?limit=10", { headers: { authorization: `Bearer ${providerToken}` } });
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items.length, 1);
    const planId = listed.body.items[0].id as string;
    const fetched = await request(`/api/v1/portal-plans/${planId}`, { headers: { authorization: `Bearer ${providerToken}` } });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.item.id, planId);

    const applied = await request(`/api/v1/portal-plans/${planId}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(applied.status, 201);
    assert.equal(applied.body.plan.appliedProposalIds.length, applied.body.proposals.length);
    assert.ok(applied.body.proposals.some((proposal: { audience: string; contentType: string }) => proposal.audience === "customer" && proposal.contentType === "blog"));
    const reapplied = await request(`/api/v1/portal-plans/${planId}/apply`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(reapplied.status, 201);
    assert.deepEqual(reapplied.body.plan.appliedProposalIds, applied.body.plan.appliedProposalIds);
    assert.deepEqual(reapplied.body.proposals.map((proposal: { id: string }) => proposal.id), applied.body.proposals.map((proposal: { id: string }) => proposal.id));

    const drafted = await request(`/api/v1/portal-plans/${planId}/draft`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(drafted.status, 201);
    assert.equal(drafted.body.plan.draftIds.length, drafted.body.drafts.length);
    assert.ok(drafted.body.drafts.every((draft: { status: string }) => draft.status === "drafted"));
    const redrafted = await request(`/api/v1/portal-plans/${planId}/draft`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(redrafted.status, 201);
    assert.deepEqual(redrafted.body.plan.draftIds, drafted.body.plan.draftIds);
    assert.deepEqual(redrafted.body.drafts.map((draft: { id: string }) => draft.id), drafted.body.drafts.map((draft: { id: string }) => draft.id));

    const draft = await request("/api/v1/content/drafts", {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ proposalId: applied.body.proposals[1].id }),
    });
    assert.equal(draft.status, 201);
    const covered = await request("/api/v1/portal-plans", {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ category: "legal", theme: "企業法務", audience: "customer" }),
    });
    assert.equal(covered.status, 201);
    assert.equal(covered.body.item.coverage.contentCount, drafted.body.drafts.length + 1);
    assert.equal(covered.body.item.coverage.matchingContentCount, covered.body.item.coverage.contentCount);
    assert.equal(covered.body.item.coverage.publishedContentCount, 0);
    assert.ok(covered.body.item.gaps.some((item: { code: string }) => item.code === "content_theme_not_published"));
    assert.ok(!covered.body.item.gaps.some((item: { code: string }) => item.code === "content_theme_coverage_missing"));

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
    assert.ok(names.includes("portal.plan.apply"));
    assert.ok(names.includes("portal.plan.draft"));

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

  it("外部AIアダプターでポータル計画の下書きを差し替えられる", async () => {
    const provider = auth.authenticate(providerToken);
    if (!provider) throw new Error("テスト用事業者セッションを取得できません。");
    const deterministic = new DeterministicContentAgentAdapter();
    let called = false;
    const adapter: ContentAgentAdapter = {
      id: "portal-plan-test-agent",
      propose: (input) => deterministic.propose(input),
      draft: (input) => deterministic.draft(input),
      polish: (input) => deterministic.polish(input),
      translate: (input) => deterministic.translate(input),
      planPortal(input) {
        called = true;
        return {
          ...input.baseline,
          nextActions: ["外部AIが提案した次のアクション"],
        };
      },
    };
    const planning = new PortalPlanningService(portal, undefined, undefined, new ContentService(portal), adapter);
    const created = await planning.create(provider, { category: "legal", theme: "AI計画接続", audience: "customer" });
    assert.equal(called, true);
    assert.deepEqual(created.nextActions, ["外部AIが提案した次のアクション"]);
  });

  it("PortalPlanStoreはStateStoreから計画を復元できる", async () => {
    const directory = await mkdtemp(`${tmpdir()}\\cms-os-portal-plan-`);
    try {
      const stateStore = new JsonStateStore(directory);
      const provider = auth.authenticate(providerToken);
      const content = new ContentService(portal);
      const first = new PortalPlanningService(portal, stateStore, undefined, content);
      const created = await first.create(provider, { category: "legal", theme: "相続", audience: "customer" });
      const applied = await first.apply(provider, created.id);
      const drafted = await first.draft(provider, created.id);
      const second = new PortalPlanningService(portal, stateStore, undefined, content);
      const restored = second.get(provider, created.id);
      assert.equal(restored.theme, "相続");
      assert.deepEqual(restored.appliedProposalIds, applied.proposals.map((proposal) => proposal.id));
      assert.deepEqual(restored.draftIds, drafted.drafts.map((draft) => draft.id));
      assert.deepEqual((await second.apply(provider, created.id)).proposals.map((proposal) => proposal.id), applied.proposals.map((proposal) => proposal.id));
      assert.deepEqual((await second.draft(provider, created.id)).drafts.map((draft) => draft.id), drafted.drafts.map((draft) => draft.id));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
