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
    assert.equal(proposal.body.item.generationAudit.adapterId, "deterministic-content-agent");
    assert.equal(proposal.body.item.generationAudit.operation, "proposal");

    const direct = await request("/api/v1/content", {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({
        category: "legal",
        contentType: "pr",
        audience: "media",
        title: "法律相談の新しい取り組み",
        summary: "報道関係者向けに新しい取り組みの要点を説明します。",
        body: "# 法律相談の新しい取り組み\n\n確認済み情報に基づく本文です。",
        slug: "legal-consultation-news",
        sourceFacts: ["2026年7月に開始しました。"],
        seo: { keywords: ["法律相談", "新しい取り組み"] },
      }),
    });
    assert.equal(direct.status, 201);
    assert.equal(direct.body.item.status, "drafted");
    assert.equal(direct.body.item.slug, "legal-consultation-news");
    assert.equal(direct.body.item.proposalId.startsWith("proposal-"), true);

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
    assert.equal(draft.body.item.locale, "ja");
    assert.equal(draft.body.item.generationAudit.operation, "draft");
    assert.equal(draft.body.item.generationAudit.model, "deterministic");
    const translation = await request(`/api/v1/content/${draft.body.item.id}/translate`, {
      method: "POST",
      headers: { authorization: `Bearer ${providerToken}` },
      body: JSON.stringify({ targetLocale: "en", instructions: "英語の読者向けに自然な表現へ翻訳する" }),
    });
    assert.equal(translation.status, 201);
    assert.equal(translation.body.item.locale, "en");
    assert.equal(translation.body.item.translationOf.contentId, draft.body.item.id);
    assert.equal(translation.body.item.translationOf.sourceVersion, 1);
    assert.match(translation.body.item.seo.canonicalPath, /^\/en\//);
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

  it("Blogの著者、シリーズ、タグ、公開メタデータを版管理し、検索条件へ反映する", async () => {
    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const headers = { authorization: `Bearer ${login.body.accessToken}` };
    const created = await request("/api/v1/content", {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "legal",
        contentType: "blog",
        audience: "customer",
        title: "法律相談の選び方",
        summary: "相談前に確認すべきポイントを整理します。",
        body: "# 法律相談の選び方\n\n相談内容と必要な準備を確認します。",
        tags: ["法律相談", "初心者"],
        series: "はじめての法律相談",
        authors: [{ name: "山田 太郎", credentials: ["弁護士"], profileUrl: "/authors/yamada" }],
        featured: true,
        visibility: "public",
        expiresAt: "2099-12-31T00:00:00.000Z",
        sourceFacts: ["公式案内に基づく検証用情報です。"],
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.visibility, "public");
    assert.deepEqual(created.body.item.tags, ["法律相談", "初心者"]);
    assert.equal(created.body.item.series, "はじめての法律相談");
    assert.equal(created.body.item.authors[0].name, "山田 太郎");
    assert.equal(created.body.item.featured, true);
    assert.match(created.body.item.currentVersionId, /^content-version-/);
    assert.equal(created.body.item.createdBy, "account-legal-provider-demo");
    assert.ok(created.body.item.readingTimeMinutes >= 1);

    const listed = await request("/api/v1/content?tags=%E6%B3%95%E5%BE%8B%E7%9B%B8%E8%AB%87&series=%E3%81%AF%E3%81%98%E3%82%81%E3%81%A6%E3%81%AE%E6%B3%95%E5%BE%8B%E7%9B%B8%E8%AB%87&featured=true", { headers });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.items.some((item: { id: string }) => item.id === created.body.item.id));

    const updated = await request(`/api/v1/content/${created.body.item.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ tags: ["法律相談", "更新"], featured: false, authors: [{ name: "山田 太郎", bio: "公式プロフィール" }] }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.featured, false);
    assert.deepEqual(updated.body.item.tags, ["法律相談", "更新"]);
    assert.equal(updated.body.item.generationAudit, undefined);
    assert.equal(updated.body.item.version, 2);
    assert.notEqual(updated.body.item.currentVersionId, created.body.item.currentVersionId);

    const version = await request(`/api/v1/content/${created.body.item.id}/versions/2`, { headers });
    assert.equal(version.status, 200);
    assert.deepEqual(version.body.item.tags, ["法律相談", "更新"]);
    assert.equal(version.body.item.authors[0].bio, "公式プロフィール");
  });

  it("ページSEO監査がH1重複、薄い本文、FAQ構造化データ欠落を検出する", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    assert.equal(providerLogin.status, 200);
    const headers = { authorization: `Bearer ${providerLogin.body.accessToken}` };
    const content = await request("/api/v1/content", {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "legal",
        contentType: "blog",
        audience: "customer",
        title: "相談ガイド",
        summary: "相談前に確認するための短い案内です。",
        body: "# 主見出し\n\n短い本文です。\n\n# 重複見出し",
        slug: "seo-audit-rule-check",
        sourceFacts: ["監査ルール検証用の一次情報です。"],
        seo: { keywords: ["法律相談"], jsonLdType: "FAQPage", faq: [] },
      }),
    });
    assert.equal(content.status, 201);

    const audit = await request(`/api/v1/content/${content.body.item.id}/seo-audit`, { method: "POST", headers });
    assert.equal(audit.status, 200);
    const codes = audit.body.item.issues.map((issue: { code: string }) => issue.code);
    assert.ok(codes.includes("H1_MULTIPLE"));
    assert.ok(codes.includes("SEO_BODY_THIN"));
    assert.ok(codes.includes("FAQ_JSONLD_EMPTY"));
    assert.ok(codes.includes("PRIMARY_KEYWORD_NOT_IN_TITLE"));
  });

  it("主要なAI編集操作をMCPから発見でき、事業者自身のコンテンツだけ取得できる", async () => {
    const tools = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const names = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("content.propose"));
    assert.ok(names.includes("content.create"));
    assert.ok(names.includes("content.proposals"));
    assert.ok(names.includes("content.list"));
    assert.ok(names.includes("content.get"));
    assert.ok(names.includes("content.versions"));
    assert.ok(names.includes("content.version_get"));
    assert.ok(names.includes("content.version_restore"));
    assert.ok(names.includes("workflow.reviews"));
    assert.ok(names.includes("workflow.request_review"));
    assert.ok(names.includes("workflow.request_changes"));
    assert.ok(names.includes("content.draft"));
    assert.ok(names.includes("content.update"));
    assert.ok(names.includes("content.translate"));
    assert.ok(names.includes("content.duplicate"));
    assert.ok(names.includes("content.archive"));
    assert.ok(names.includes("content.restore"));
    assert.ok(names.includes("content.polish"));
    assert.ok(names.includes("content.fact_check"));
    assert.ok(names.includes("seo.audit"));
    assert.ok(names.includes("seo.site_audit"));
    assert.ok(names.includes("publication.publish"));
    assert.ok(names.includes("publication.unpublish"));

    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "beauty@example.com", password: "demo-password", category: "beauty", role: "provider" }),
    });
    const providerHeaders = { authorization: `Bearer ${providerLogin.body.accessToken}` };
    for (const suffix of ["A", "B"]) {
      const proposal = await request("/api/v1/content/proposals", {
        method: "POST",
        headers: providerHeaders,
        body: JSON.stringify({ category: "beauty", contentType: "blog", audience: "customer", topic: `企画一覧フィルター ${suffix}` }),
      });
      assert.equal(proposal.status, 201);
    }
    const proposalPage = await request(`/api/v1/content/proposals?search=${encodeURIComponent("企画一覧フィルター")}&audience=customer&contentType=blog&sort=topic_asc&limit=1`, { headers: providerHeaders });
    assert.equal(proposalPage.status, 200);
    assert.equal(proposalPage.body.items.length, 1);
    assert.equal(proposalPage.body.page.limit, 1);
    assert.equal(proposalPage.body.page.nextCursor, "1");
    const list = await request("/mcp", {
      method: "POST",
      headers: providerHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "content.list", arguments: {} } }),
    });
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(list.body.result.structuredContent.items));
    assert.ok(Array.isArray(list.body.result.structuredContent.proposals));

    const proposalMcp = await request("/mcp", {
      method: "POST",
      headers: providerHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "content.proposals", arguments: { search: "企画一覧フィルター", audience: "customer", contentType: "blog", limit: 10 } } }),
    });
    assert.equal(proposalMcp.status, 200);
    assert.equal(proposalMcp.body.result.structuredContent.items.length, 2);
    assert.equal(proposalMcp.body.result.structuredContent.page.limit, 10);

    const siteAudit = await request("/api/v1/seo/audit", {
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
    });
    assert.equal(siteAudit.status, 200);
    assert.equal(siteAudit.body.item.category, "beauty");
    assert.equal(siteAudit.body.item.providerId, "provider-beauty-demo");
    assert.equal(typeof siteAudit.body.item.score, "number");
    assert.ok(Array.isArray(siteAudit.body.item.issues));

    const siteAuditMcp = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "seo.site_audit", arguments: {} } }),
    });
    assert.equal(siteAuditMcp.status, 200);
    assert.equal(siteAuditMcp.body.result.structuredContent.category, "beauty");

    const direct = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 13,
        method: "tools/call",
        params: {
          name: "content.create",
          arguments: {
            category: "beauty",
            contentType: "blog",
            audience: "customer",
            title: "美容メニューの選び方ガイド",
            summary: "初めての方が美容メニューを比較できるガイドです。",
            body: "# 美容メニューの選び方ガイド\n\n確認済み情報をもとにした下書きです。",
            sourceFacts: ["料金と施術時間を確認済みです。"],
          },
        },
      }),
    });
    assert.equal(direct.status, 200);
    assert.equal(direct.body.result.structuredContent.status, "drafted");

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
    const fetched = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "content.get", arguments: { contentId: draft.body.result.structuredContent.id } } }),
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.result.structuredContent.id, draft.body.result.structuredContent.id);
    const translated = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "content.translate", arguments: { contentId: draft.body.result.structuredContent.id, targetLocale: "fr", title: "Présentation des services" } } }),
    });
    assert.equal(translated.status, 200);
    assert.equal(translated.body.result.structuredContent.locale, "fr");
    assert.equal(translated.body.result.structuredContent.translationOf.contentId, draft.body.result.structuredContent.id);
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

  it("コンテンツ一覧を対象ポジション・言語・状態で検索しページングできる", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "beauty@example.com", password: "demo-password", category: "beauty", role: "provider" }),
    });
    const headers = { authorization: `Bearer ${providerLogin.body.accessToken}` };
    for (const [suffix, locale] of [["A", "ja"], ["B", "en"]] as const) {
      const created = await request("/api/v1/content", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category: "beauty",
          contentType: "blog",
          audience: "candidate",
          title: `一覧フィルター検証 ${suffix}`,
          summary: "対象ポジションと翻訳版を検索するための検証コンテンツです。",
          body: "# 一覧フィルター検証\n\n確認済み情報に基づく本文です。",
          locale,
          sourceFacts: ["テスト用に確認済みの情報です。"],
        }),
      });
      assert.equal(created.status, 201);
    }

    const first = await request(`/api/v1/content?search=${encodeURIComponent("一覧フィルター検証")}&audience=candidate&contentType=blog&status=drafted&sort=title_asc&limit=1`, { headers });
    assert.equal(first.status, 200);
    assert.equal(first.body.page.limit, 1);
    assert.equal(first.body.items.length, 1);
    assert.equal(first.body.items[0].audience, "candidate");
    assert.equal(first.body.items[0].status, "drafted");
    assert.equal(first.body.page.nextCursor, "1");

    const second = await request(`/api/v1/content?search=${encodeURIComponent("一覧フィルター検証")}&audience=candidate&contentType=blog&status=drafted&sort=title_asc&limit=1&cursor=${first.body.page.nextCursor}`, { headers });
    assert.equal(second.status, 200);
    assert.equal(second.body.items.length, 1);
    assert.equal(second.body.page.nextCursor, undefined);

    const localized = await request(`/api/v1/content?search=${encodeURIComponent("一覧フィルター検証")}&locale=en`, { headers });
    assert.equal(localized.status, 200);
    assert.equal(localized.body.items.length, 1);
    assert.equal(localized.body.items[0].locale, "en");

    const mcp = await request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 44,
        method: "tools/call",
        params: {
          name: "content.list",
          arguments: { search: "一覧フィルター検証", audience: "candidate", contentType: "blog", status: "drafted", limit: 10 },
        },
      }),
    });
    assert.equal(mcp.status, 200);
    assert.equal(mcp.body.result.structuredContent.items.length, 2);
    assert.equal(mcp.body.result.structuredContent.page.limit, 10);

    const invalid = await request("/api/v1/content?status=unknown", { headers });
    assert.equal(invalid.status, 400);
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
    const siteAudit = await request("/api/v1/seo/audit", { headers });
    assert.equal(siteAudit.status, 200);
    assert.ok(siteAudit.body.item.publicContentCount >= 1);
    assert.equal(siteAudit.body.item.issues.some((issue: { code: string; contentId?: string }) => issue.contentId === contentId && ["SEO_AUDIT_STALE", "FACT_CHECK_STALE"].includes(issue.code)), false);
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

  it("note型ブロックをRESTとMCPで保存し、版履歴から復元できる", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const headers = { authorization: `Bearer ${providerLogin.body.accessToken}` };
    const blocks = [
      { type: "heading", level: 1, text: "相談前の準備" },
      { type: "paragraph", text: "相談の目的と期限を先に整理します。" },
      { type: "table", headers: ["項目", "確認内容"], rows: [["目的", "相談したいこと"], ["期限", "いつまでに必要か"]] },
      { type: "cta", label: "事業者一覧を見る", url: "/categories/legal/providers/" },
    ];
    const created = await request("/api/v1/content", {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "legal",
        contentType: "blog",
        audience: "beginner",
        title: "相談前に確認したいこと",
        summary: "相談前の準備を整理します。",
        blocks,
        sourceFacts: ["事業者が確認した一次情報"],
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.blocks.length, 4);
    assert.match(created.body.item.body, /^# 相談前の準備/m);
    assert.match(created.body.item.body, /\| 項目 \| 確認内容 \|/);

    const updated = await request(`/api/v1/content/${created.body.item.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ blocks: [{ type: "heading", level: 1, text: "更新後の見出し" }, { type: "paragraph", text: "更新された本文です。" }] }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.version, 2);
    assert.match(updated.body.item.body, /^# 更新後の見出し/m);

    const restored = await request(`/api/v1/content/${created.body.item.id}/versions/1/restore`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.item.version, 3);
    assert.equal(restored.body.item.blocks[0].text, "相談前の準備");
    assert.match(restored.body.item.body, /\| 項目 \| 確認内容 \|/);

    const unsafe = await request("/api/v1/content", {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "legal",
        contentType: "blog",
        audience: "beginner",
        title: "不正URL",
        summary: "不正URLの確認",
        blocks: [{ type: "image", url: "javascript:alert(1)", alt: "危険" }],
      }),
    });
    assert.equal(unsafe.status, 400);

    const mcpCreated = await request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 31,
        method: "tools/call",
        params: {
          name: "content.create",
          arguments: {
            category: "legal",
            contentType: "blog",
            audience: "beginner",
            title: "MCPブロック",
            summary: "MCPから登録",
            blocks: [{ type: "paragraph", text: "MCPから登録された本文です。" }],
          },
        },
      }),
    });
    assert.equal(mcpCreated.status, 200);
    assert.equal(mcpCreated.body.result.structuredContent.blocks[0].type, "paragraph");
  });

  it("採用・PR・IRの構造化データをREST/MCPと版履歴で保持する", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const headers = { authorization: `Bearer ${providerLogin.body.accessToken}` };
    const created = await request("/api/v1/content", {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "legal",
        contentType: "ir",
        audience: "investor",
        title: "2026年3月期 決算説明資料",
        summary: "投資家向けの決算説明資料を案内します。",
        body: "# 決算説明資料\n\n確認済みのIR情報です。",
        structuredData: {
          type: "ir",
          publicationDate: "2026-07-16",
          documentType: "presentation",
          fiscalPeriod: "2026年3月期",
          sourceDocumentUrl: "https://example.com/ir/presentation.pdf",
        },
        sourceEvidence: [{
          title: "決算説明資料",
          url: "https://example.com/ir/presentation.pdf",
          publisher: "サンプル事業者",
          checkedAt: "2026-07-16",
        }],
        sourceFacts: ["決算資料の公開日を確認しました。"],
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.structuredData.documentType, "presentation");
    assert.equal(created.body.item.sourceEvidence[0].url, "https://example.com/ir/presentation.pdf");

    const updated = await request("/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: {
          name: "content.update",
          arguments: {
            contentId: created.body.item.id,
            structuredData: {
              type: "ir",
              publicationDate: "2026-07-16",
              documentType: "financial_results",
              fiscalPeriod: "2026年3月期",
            },
          },
        },
      }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.result.structuredContent.structuredData.documentType, "financial_results");

    const version = await request(`/api/v1/content/${created.body.item.id}/versions/1`, { headers });
    assert.equal(version.status, 200);
    assert.equal(version.body.item.structuredData.sourceDocumentUrl, "https://example.com/ir/presentation.pdf");
    assert.equal(version.body.item.sourceEvidence[0].publisher, "サンプル事業者");

    const mismatch = await request("/api/v1/content", {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "legal",
        contentType: "pr",
        audience: "media",
        title: "構造化データ不一致",
        summary: "contentTypeとtypeの不一致を検証します。",
        body: "# 不一致\n\n検証用本文です。",
        structuredData: { type: "ir", publicationDate: "2026-07-16", documentType: "notice" },
      }),
    });
    assert.equal(mismatch.status, 400);

    const unsafeEvidence = await request("/api/v1/content", {
      method: "POST",
      headers,
      body: JSON.stringify({
        category: "legal",
        contentType: "ir",
        audience: "investor",
        title: "出典URL検証",
        summary: "HTTPS以外の出典を拒否します。",
        body: "# 出典URL検証\n\n検証用本文です。",
        sourceEvidence: [{ title: "危険な出典", url: "http://example.com/source", checkedAt: "2026-07-16" }],
      }),
    });
    assert.equal(unsafeEvidence.status, 400);
  });
});
