import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContentService, ContentServiceError } from "../src/application/content-service.js";
import { PortalService } from "../src/application/portal-service.js";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { contentAgentAdapterFromEnvironment, HttpContentAgentAdapter, type ContentAgentAdapter } from "../src/integrations/content-agent-adapter.js";

describe("CMS-OS ContentAgentAdapter", () => {
  it("企画・下書き・清書・翻訳を差し替えアダプターへ委譲する", async () => {
    const auth = new InMemoryAuthService();
    const portal = new PortalService(auth);
    const calls: string[] = [];
    const adapter: ContentAgentAdapter = {
      id: "test-external-ai",
      propose(input) {
        calls.push(`propose:${input.topic}`);
        return {
          searchIntent: "カスタム検索意図",
          relatedKeywords: ["カスタムキーワード"],
          outline: ["AIが作成した見出し"],
          rationale: "AIが作成した企画理由です。",
        };
      },
      draft(input) {
        calls.push(`draft:${input.proposal.topic}`);
        return {
          title: "AI生成タイトル",
          summary: "AI生成の要約です。",
          body: "# AI生成タイトル\n\nAI生成の本文です。",
          seo: { keywords: ["AI生成SEO"] },
        };
      },
      polish(input) {
        calls.push(`polish:${input.content.id}`);
        return {
          body: "# 清書済みタイトル\n\n清書済みの本文です。",
          seo: { title: "清書済みSEOタイトル" },
        };
      },
      translate(input) {
        calls.push(`translate:${input.targetLocale}`);
        return {
          title: "Translated title",
          summary: "Translated summary",
          body: "# Translated title\n\nTranslated body",
          seo: { title: "Translated SEO title" },
        };
      },
    };
    const content = new ContentService(portal, undefined, undefined, adapter);
    const login = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
    if (!login || !("accessToken" in login)) throw new Error("テスト用事業者ログインに失敗しました。");
    const principal = auth.authenticate(login.accessToken);
    if (!principal) throw new Error("テスト用事業者セッションを取得できません。");

    const proposal = await content.createProposal(principal, {
      category: "legal",
      contentType: "blog",
      audience: "customer",
      topic: "相続相談の選び方",
    });
    assert.deepEqual(proposal.outline, ["AIが作成した見出し"]);
    assert.equal(proposal.searchIntent, "カスタム検索意図");

    const draft = await content.createDraft(principal, proposal.id);
    assert.equal(draft.title, "AI生成タイトル");
    assert.equal(draft.seo.keywords[0], "AI生成SEO");

    const polished = await content.polishContent(principal, draft.id, "専門用語を減らす");
    assert.equal(polished.body, "# 清書済みタイトル\n\n清書済みの本文です。");
    assert.equal(polished.seo.title, "清書済みSEOタイトル");

    const translated = await content.translateContent(principal, draft.id, { targetLocale: "en" });
    assert.equal(translated.title, "Translated title");
    assert.equal(translated.locale, "en");
    assert.deepEqual(calls, [
      "propose:相続相談の選び方",
      "draft:相続相談の選び方",
      `polish:${draft.id}`,
      "translate:en",
    ]);
  });

  it("HTTPアダプターがCMS-OS Content Agent Protocolへ安全に接続する", async () => {
    let requestUrl = "";
    let requestHeaders: HeadersInit | undefined;
    let requestBody: Record<string, unknown> | undefined;
    const adapter = new HttpContentAgentAdapter({
      endpoint: "https://agent.example.test/generate",
      apiKey: "test-secret",
      model: "test-model",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = init?.headers;
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ output: { title: "HTTP生成", summary: "要約", body: "本文" } }), { status: 200 });
      },
    });
    const result = await adapter.draft({
      proposal: {
        id: "proposal-http",
        category: "legal",
        providerId: "provider-legal-demo",
        contentType: "blog",
        audience: "customer",
        topic: "HTTP接続",
        searchIntent: "確認",
        primaryKeyword: "HTTP接続",
        relatedKeywords: [],
        outline: ["要点"],
        sourceFacts: [],
        rationale: "検証",
        createdAt: new Date().toISOString(),
      },
      audienceLabel: "顧客・発注者",
      audienceIntent: "判断につなげる",
      contentTypeLabel: "Blog記事",
      jsonLdType: "BlogPosting",
    });
    assert.equal(requestUrl, "https://agent.example.test/generate");
    assert.equal(new Headers(requestHeaders).get("authorization"), "Bearer test-secret");
    assert.equal(requestBody?.protocol, "cms-os-content-agent/v1");
    assert.equal(requestBody?.operation, "draft");
    assert.equal(requestBody?.model, "test-model");
    assert.equal(result.title, "HTTP生成");
    assert.equal(contentAgentAdapterFromEnvironment({}).id, "deterministic-content-agent");
    assert.equal(contentAgentAdapterFromEnvironment({ CMS_OS_CONTENT_AGENT_ENDPOINT: "https://agent.example.test" }).id, "http-content-agent");
  });

  it("AIプロバイダー障害を502系のサービスエラーへ変換する", async () => {
    const auth = new InMemoryAuthService();
    const portal = new PortalService(auth);
    const login = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
    if (!login || !("accessToken" in login)) throw new Error("障害テスト用ログインに失敗しました。");
    const principal = auth.authenticate(login.accessToken);
    if (!principal) throw new Error("障害テスト用セッションを取得できません。");
    const failingAdapter: ContentAgentAdapter = {
      id: "failing-agent",
      propose() { throw new Error("接続失敗"); },
      draft() { throw new Error("接続失敗"); },
      polish() { throw new Error("接続失敗"); },
      translate() { throw new Error("接続失敗"); },
    };
    const content = new ContentService(portal, undefined, undefined, failingAdapter);
    await assert.rejects(
      () => content.createProposal(principal, { category: "legal", contentType: "blog", audience: "customer", topic: "AI障害確認" }),
      (error: unknown) => error instanceof ContentServiceError && error.statusCode === 502,
    );
  });
});
