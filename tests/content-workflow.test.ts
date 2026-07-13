import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";

let server: Server;
let baseUrl: string;

before(async () => {
  const auth = new InMemoryAuthService();
  const portal = new PortalService(auth);
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

describe("CMS-OS AIコンテンツワークフロー", () => {
  it("対象ポジション別の企画、下書き、清書、SEO監査を実行できる", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const providerToken = providerLogin.body.accessToken;

    const proposal = await request("/api/v1/content/proposals", {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({
        category: "legal",
        contentType: "blog",
        audience: "candidate",
        topic: "弁護士のキャリア",
        primaryKeyword: "弁護士 キャリア",
        relatedKeywords: ["法律事務所 採用"],
        sourceFacts: ["弁護士とパラリーガルの募集があります。", "専門性とチームワークを重視します。"],
      }),
    });
    assert.equal(proposal.status, 201);
    assert.equal(proposal.body.item.audience, "candidate");
    assert.ok(proposal.body.item.outline.includes("仕事内容と成長機会"));

    const userLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "demo-password", category: "legal", role: "user" }),
    });
    const denied = await request("/api/v1/content/proposals", {
      method: "POST",
      headers: { authorization: `Bearer ${userLogin.body.accessToken}` },
      body: JSON.stringify({ category: "legal", contentType: "blog", audience: "customer", topic: "相談ガイド" }),
    });
    assert.equal(denied.status, 403);

    const draft = await request("/api/v1/content/drafts", {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ proposalId: proposal.body.item.id }),
    });
    assert.equal(draft.status, 201);
    assert.equal(draft.body.item.status, "drafted");
    assert.equal(draft.body.item.seo.jsonLdType, "BlogPosting");
    assert.ok(draft.body.item.body.includes("仕事内容と成長機会"));

    const polished = await request(`/api/v1/content/${draft.body.item.id}/polish`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ instructions: "候補者が次の行動を判断しやすい文章にする" }),
    });
    assert.equal(polished.status, 200);
    assert.equal(polished.body.item.status, "polished");
    assert.equal(polished.body.item.version, 2);

    const audit = await request(`/api/v1/content/${draft.body.item.id}/seo-audit`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.item.contentId, draft.body.item.id);
    assert.equal(typeof audit.body.item.score, "number");
    assert.ok(Array.isArray(audit.body.item.issues));
  });

  it("主要なAI編集操作をMCPから発見でき、事業者自身のコンテンツだけ取得できる", async () => {
    const tools = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const names = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("content.propose"));
    assert.ok(names.includes("content.list"));
    assert.ok(names.includes("content.draft"));
    assert.ok(names.includes("content.polish"));
    assert.ok(names.includes("seo.audit"));

    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "beauty@example.com", password: "demo-password", category: "beauty", role: "provider" }),
    });
    const list = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "content.list", arguments: {} } }),
    });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.result.structuredContent.items));
    assert.ok(Array.isArray(list.body.result.structuredContent.proposals));
  });
});
