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

    const updated = await request(`/api/v1/content/${draft.body.item.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ summary: "候補者が仕事内容と成長機会を確認できる紹介文です。" }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.summary, "候補者が仕事内容と成長機会を確認できる紹介文です。");
    assert.equal(updated.body.item.version, 2);

    const versionsAfterUpdate = await request(`/api/v1/content/${draft.body.item.id}/versions`, {
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(versionsAfterUpdate.status, 200);
    assert.deepEqual(versionsAfterUpdate.body.items.map((item: { version: number }) => item.version), [2, 1]);
    const initialVersion = await request(`/api/v1/content/${draft.body.item.id}/versions/1`, {
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(initialVersion.status, 200);
    assert.equal(initialVersion.body.item.version, 1);

    const factCheck = await request(`/api/v1/content/${draft.body.item.id}/fact-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(factCheck.status, 200);
    assert.equal(factCheck.body.item.passed, true);
    assert.equal(factCheck.body.item.scope, "source_presence_only");

    const polished = await request(`/api/v1/content/${draft.body.item.id}/polish`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ instructions: "候補者が次の行動を判断しやすい文章にする" }),
    });
    assert.equal(polished.status, 200);
    assert.equal(polished.body.item.status, "polished");
    assert.equal(polished.body.item.version, 3);

    const audit = await request(`/api/v1/content/${draft.body.item.id}/seo-audit`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(audit.status, 200);
    assert.equal(audit.body.item.contentId, draft.body.item.id);
    assert.equal(typeof audit.body.item.score, "number");
    assert.ok(Array.isArray(audit.body.item.issues));

    const changedAfterAudit = await request(`/api/v1/content/${draft.body.item.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ summary: "監査後に更新された候補者向け紹介文です。" }),
    });
    assert.equal(changedAfterAudit.status, 200);

    const refreshedAudit = await request(`/api/v1/content/${draft.body.item.id}/seo-audit`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(refreshedAudit.status, 200);

    const staleFactCheckApproval = await request(`/api/v1/content/${draft.body.item.id}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(staleFactCheckApproval.status, 409);

    const refreshedFactCheck = await request(`/api/v1/content/${draft.body.item.id}/fact-check`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(refreshedFactCheck.status, 200);

    const approved = await request(`/api/v1/content/${draft.body.item.id}/approve`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.item.status, "approved");

    const duplicate = await request(`/api/v1/content/${draft.body.item.id}/duplicate`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(duplicate.status, 201);
    assert.equal(duplicate.body.item.status, "drafted");
    assert.notEqual(duplicate.body.item.id, draft.body.item.id);

    const restoredVersion = await request(`/api/v1/content/${duplicate.body.item.id}/versions/1/restore`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({}),
    });
    assert.equal(restoredVersion.status, 200);
    assert.equal(restoredVersion.body.item.status, "drafted");
    assert.equal(restoredVersion.body.item.version, 2);
    assert.equal(restoredVersion.body.item.lastSeoAudit, undefined);
    assert.equal(restoredVersion.body.item.lastFactCheck, undefined);

    const archived = await request(`/api/v1/content/${duplicate.body.item.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.item.status, "archived");

    const restored = await request(`/api/v1/content/${duplicate.body.item.id}/restore`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.item.status, "drafted");
  });

  it("主要なAI編集操作をMCPから発見でき、事業者自身のコンテンツだけ取得できる", async () => {
    const tools = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const names = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("content.propose"));
    assert.ok(names.includes("content.list"));
    assert.ok(names.includes("content.versions"));
    assert.ok(names.includes("content.version_get"));
    assert.ok(names.includes("content.version_restore"));
    assert.ok(names.includes("workflow.reviews"));
    assert.ok(names.includes("workflow.request_review"));
    assert.ok(names.includes("workflow.request_changes"));
    assert.ok(names.includes("content.draft"));
    assert.ok(names.includes("content.update"));
    assert.ok(names.includes("content.duplicate"));
    assert.ok(names.includes("content.archive"));
    assert.ok(names.includes("content.restore"));
    assert.ok(names.includes("content.polish"));
    assert.ok(names.includes("content.fact_check"));
    assert.ok(names.includes("seo.audit"));
    assert.ok(names.includes("publication.publish"));
    assert.ok(names.includes("publication.unpublish"));

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

    const proposal = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "content.propose", arguments: { category: "beauty", contentType: "blog", audience: "customer", topic: "美容メニューの選び方" } },
      }),
    });
    const draft = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "content.draft", arguments: { proposalId: proposal.body.result.structuredContent.id } } }),
    });
    const updated = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "content.update", arguments: { contentId: draft.body.result.structuredContent.id, summary: "メニュー選びを支援する紹介文です。" } } }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.result.structuredContent.summary, "メニュー選びを支援する紹介文です。");

    const versions = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "content.versions", arguments: { contentId: draft.body.result.structuredContent.id } } }),
    });
    assert.equal(versions.status, 200);
    assert.ok(Array.isArray(versions.body.result.structuredContent.items));
  });

  it("レビュー依頼、差し戻し、再監査、再承認を履歴付きで実行できる", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const providerToken = providerLogin.body.accessToken;
    const headers = { authorization: `Bearer ${providerToken}` };
    const proposal = await request("/api/v1/content/proposals", {
      method: "POST",
      headers,
      body: JSON.stringify({ category: "legal", contentType: "blog", audience: "customer", topic: "レビュー運用の検証", sourceFacts: ["確認済みのレビュー運用"] }),
    });
    const draft = await request("/api/v1/content/drafts", { method: "POST", headers, body: JSON.stringify({ proposalId: proposal.body.item.id }) });
    const contentId = draft.body.item.id;

    await request(`/api/v1/content/${contentId}/polish`, { method: "POST", headers, body: JSON.stringify({}) });
    await request(`/api/v1/content/${contentId}/seo-audit`, { method: "POST", headers });
    await request(`/api/v1/content/${contentId}/fact-check`, { method: "POST", headers });
    const reviewRequest = await request(`/api/v1/content/${contentId}/review-request`, {
      method: "POST",
      headers,
      body: JSON.stringify({ note: "公開前レビューをお願いします" }),
    });
    assert.equal(reviewRequest.status, 201);
    assert.equal(reviewRequest.body.item.content.status, "review_requested");
    assert.equal(reviewRequest.body.item.review.status, "requested");
    assert.equal(reviewRequest.body.item.review.contentVersion, reviewRequest.body.item.content.version);

    const blockedEdit = await request(`/api/v1/content/${contentId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ summary: "レビュー中の編集は拒否されます。" }),
    });
    assert.equal(blockedEdit.status, 409);

    const changes = await request(`/api/v1/content/${contentId}/request-changes`, {
      method: "POST",
      headers,
      body: JSON.stringify({ note: "一次情報の説明を補足してください" }),
    });
    assert.equal(changes.status, 200);
    assert.equal(changes.body.item.content.status, "changes_requested");
    assert.equal(changes.body.item.review.status, "changes_requested");

    const edited = await request(`/api/v1/content/${contentId}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ summary: "差し戻し後に補足した紹介文です。" }),
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.item.status, "drafted");
    await request(`/api/v1/content/${contentId}/polish`, { method: "POST", headers, body: JSON.stringify({}) });
    await request(`/api/v1/content/${contentId}/seo-audit`, { method: "POST", headers });
    await request(`/api/v1/content/${contentId}/fact-check`, { method: "POST", headers });

    const secondReview = await request(`/api/v1/content/${contentId}/review-request`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(secondReview.status, 201);
    assert.equal(secondReview.body.item.content.status, "review_requested");

    const approved = await request(`/api/v1/content/${contentId}/approve`, { method: "POST", headers });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.item.status, "approved");
    const reviews = await request(`/api/v1/content/${contentId}/reviews`, { headers });
    assert.equal(reviews.status, 200);
    assert.equal(reviews.body.items.length, 2);
    assert.equal(reviews.body.items[0].status, "approved");
    assert.equal(reviews.body.items[1].status, "changes_requested");
  });

  it("レビュー依頼と差し戻しをMCPから実行できる", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "beauty@example.com", password: "demo-password", category: "beauty", role: "provider" }),
    });
    const providerToken = providerLogin.body.accessToken;
    const headers = { authorization: `Bearer ${providerToken}` };
    const proposal = await request("/api/v1/content/proposals", {
      method: "POST",
      headers,
      body: JSON.stringify({ category: "beauty", contentType: "blog", audience: "customer", topic: "MCPレビュー運用", sourceFacts: ["MCPで確認済み"] }),
    });
    const draft = await request("/api/v1/content/drafts", { method: "POST", headers, body: JSON.stringify({ proposalId: proposal.body.item.id }) });
    await request(`/api/v1/content/${draft.body.item.id}/polish`, { method: "POST", headers, body: JSON.stringify({}) });
    await request(`/api/v1/content/${draft.body.item.id}/seo-audit`, { method: "POST", headers });
    await request(`/api/v1/content/${draft.body.item.id}/fact-check`, { method: "POST", headers });

    const reviewRequest = await request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "workflow.request_review", arguments: { contentId: draft.body.item.id, note: "MCPレビューをお願いします" } } }),
    });
    assert.equal(reviewRequest.body.result.structuredContent.content.status, "review_requested");
    const reviews = await request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "workflow.reviews", arguments: { contentId: draft.body.item.id } } }),
    });
    assert.equal(reviews.body.result.structuredContent.items[0].status, "requested");
    const changes = await request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "workflow.request_changes", arguments: { contentId: draft.body.item.id, note: "MCPから補足を依頼します" } } }),
    });
    assert.equal(changes.body.result.structuredContent.content.status, "changes_requested");
    assert.equal(changes.body.result.structuredContent.review.status, "changes_requested");
  });
});
