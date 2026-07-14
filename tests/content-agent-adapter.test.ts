import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ContentService } from "../src/application/content-service.js";
import { PortalService } from "../src/application/portal-service.js";
import { InMemoryAuthService } from "../src/domain/auth.js";
import type { ContentAgentAdapter } from "../src/integrations/content-agent-adapter.js";

describe("CMS-OS ContentAgentAdapter", () => {
  it("企画・下書き・清書・翻訳を差し替えアダプターへ委譲する", () => {
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

    const proposal = content.createProposal(principal, {
      category: "legal",
      contentType: "blog",
      audience: "customer",
      topic: "相続相談の選び方",
    });
    assert.deepEqual(proposal.outline, ["AIが作成した見出し"]);
    assert.equal(proposal.searchIntent, "カスタム検索意図");

    const draft = content.createDraft(principal, proposal.id);
    assert.equal(draft.title, "AI生成タイトル");
    assert.equal(draft.seo.keywords[0], "AI生成SEO");

    const polished = content.polishContent(principal, draft.id, "専門用語を減らす");
    assert.equal(polished.body, "# 清書済みタイトル\n\n清書済みの本文です。");
    assert.equal(polished.seo.title, "清書済みSEOタイトル");

    const translated = content.translateContent(principal, draft.id, { targetLocale: "en" });
    assert.equal(translated.title, "Translated title");
    assert.equal(translated.locale, "en");
    assert.deepEqual(calls, [
      "propose:相続相談の選び方",
      "draft:相続相談の選び方",
      `polish:${draft.id}`,
      "translate:en",
    ]);
  });
});
