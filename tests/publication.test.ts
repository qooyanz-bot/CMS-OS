import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { ContentService } from "../src/application/content-service.js";
import { PublicationService } from "../src/application/publication-service.js";
import { BuilderOSAdapter } from "../src/integrations/builderos-adapter.js";
import { createHttpServer } from "../src/api/http-server.js";

let server: Server;
let baseUrl: string;

before(async () => {
  const auth = new InMemoryAuthService();
  const portal = new PortalService(auth);
  const content = new ContentService(portal);
  const publication = new PublicationService(portal, content, new BuilderOSAdapter(), () => ({
    accountId: "account-test",
    projectName: "cms-os-test",
    dryRun: true,
  }));
  server = createHttpServer(auth, portal, content, publication);
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

describe("CMS-OS承認済み静的公開", () => {
  it("承認前の公開を拒否し、SEOアセット付きCloudflare向けファイルを生成する", async () => {
    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const token = login.body.accessToken;
    const authHeaders = { authorization: `Bearer ${token}` };

    const proposal = await request("/api/v1/content/proposals", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        category: "legal",
        contentType: "pr",
        audience: "media",
        topic: "新サービスのお知らせ",
        sourceFacts: ["2026年7月に新サービスを開始しました。"],
      }),
    });
    const draft = await request("/api/v1/content/drafts", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ proposalId: proposal.body.item.id }),
    });

    const beforeApproval = await request("/api/v1/publications/build", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ contentIds: [draft.body.item.id], baseUrl: "https://www.example.com" }),
    });
    assert.equal(beforeApproval.status, 409);

    const polished = await request(`/api/v1/content/${draft.body.item.id}/polish`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ instructions: "\n\n| 比較項目 | 選択肢A | 選択肢B |\n| --- | --- | --- |\n| 対象 | 顧客 | 求職者 |\n\n[関連情報](/categories/legal/)" }),
    });
    assert.equal(polished.body.item.status, "polished");

    const audited = await request(`/api/v1/content/${draft.body.item.id}/seo-audit`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(audited.status, 200);

    const missingFactCheck = await request(`/api/v1/content/${draft.body.item.id}/approve`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(missingFactCheck.status, 409);

    const factChecked = await request(`/api/v1/content/${draft.body.item.id}/fact-check`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(factChecked.status, 200);
    assert.equal(factChecked.body.item.contentVersion, audited.body.item.contentVersion);

    const approved = await request(`/api/v1/content/${draft.body.item.id}/approve`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.item.status, "approved");

    const built = await request("/api/v1/publications/build", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ contentIds: [draft.body.item.id], baseUrl: "https://www.example.com" }),
    });
    assert.equal(built.status, 201);
    assert.equal(built.body.item.baseUrl, "https://www.example.com");
    const files = built.body.item.files as Array<{ path: string; content: string }>;
    const fileMap = new Map(files.map((file) => [file.path, file.content]));
    const pagePath = `content/${draft.body.item.slug}/index.html`;
    assert.ok(fileMap.has("index.html"));
    assert.ok(fileMap.has(pagePath));
    assert.ok(fileMap.has("sitemap.xml"));
    assert.ok(fileMap.has("robots.txt"));
    assert.ok(fileMap.has("llms.txt"));
    assert.ok(fileMap.has("categories/legal/index.html"));
    assert.ok(fileMap.has("categories/legal/providers/index.html"));
    assert.ok(fileMap.has("categories/legal/providers/provider-legal-demo/index.html"));
    const legalThemePath = `categories/legal/themes/${encodeURIComponent("相続")}/index.html`;
    const legalRegionPath = `categories/legal/regions/${encodeURIComponent("東京都")}/index.html`;
    assert.ok(fileMap.has(legalThemePath));
    assert.ok(fileMap.has(legalRegionPath));
    assert.ok(fileMap.has("categories/ai-business/index.html"));
    assert.ok(fileMap.has("categories/ai-business/providers/provider-ai-business-demo/index.html"));
    assert.match(fileMap.get(pagePath) ?? "", /application\/ld\+json/);
    assert.match(fileMap.get(pagePath) ?? "", /<table>/);
    assert.match(fileMap.get(pagePath) ?? "", /<a href="\/categories\/legal\/">関連情報<\/a>/);
    assert.match(fileMap.get(pagePath) ?? "", /FAQPage/);
    assert.match(fileMap.get(pagePath) ?? "", /BreadcrumbList/);
    assert.match(fileMap.get(pagePath) ?? "", /<link rel="canonical"/);
    assert.match(fileMap.get(pagePath) ?? "", /hreflang="ja"/);
    assert.match(fileMap.get("sitemap.xml") ?? "", /https:\/\/www\.example\.com/);
    assert.match(fileMap.get("sitemap.xml") ?? "", /categories\/legal\/providers\/provider-legal-demo/);
    assert.match(fileMap.get("sitemap.xml") ?? "", /categories\/legal\/themes\//);
    assert.match(fileMap.get("robots.txt") ?? "", /Sitemap: https:\/\/www\.example\.com\/sitemap\.xml/);
    assert.match(fileMap.get("robots.txt") ?? "", /GPTBot/);
    assert.match(fileMap.get("robots.txt") ?? "", /Disallow: \/api\//);
    assert.match(fileMap.get("llms.txt") ?? "", /Provider/);
    assert.match(fileMap.get("llms.txt") ?? "", /Themes and Regions/);
    assert.match(fileMap.get("llms.txt") ?? "", /ai-business/);
    assert.match(fileMap.get("categories/legal/index.html") ?? "", /弁護士ドットコム/);
    assert.match(fileMap.get("categories/legal/index.html") ?? "", /テーマ別案内/);
    assert.match(fileMap.get(legalThemePath) ?? "", /CollectionPage/);
    assert.match(fileMap.get(legalThemePath) ?? "", /相続/);
    assert.match(fileMap.get(legalThemePath) ?? "", /<link rel="canonical" href="https:\/\/www\.example\.com\/categories\/legal\/themes\//);
    assert.doesNotMatch(fileMap.get(legalThemePath) ?? "", /%25E7/);
    assert.match(fileMap.get("categories\/legal\/providers\/provider-legal-demo\/index.html") ?? "", /Organization/);

    const scheduledFor = new Date(Date.now() + 60_000).toISOString();
    const scheduled = await request("/api/v1/publications/schedules", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ contentIds: [draft.body.item.id], baseUrl: "https://www.example.com", scheduledFor }),
    });
    assert.equal(scheduled.status, 201);
    assert.equal(scheduled.body.item.status, "scheduled");
    const schedules = await request("/api/v1/publications/schedules", { headers: authHeaders });
    assert.equal(schedules.status, 200);
    assert.ok(schedules.body.items.some((item: { id: string }) => item.id === scheduled.body.item.id));
    const dryRunSchedules = await request("/api/v1/publications/schedules/execute", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ before: new Date(Date.now() + 120_000).toISOString() }),
    });
    assert.equal(dryRunSchedules.status, 200);
    assert.equal(dryRunSchedules.body.items[0].status, "dry_run");
    assert.equal(dryRunSchedules.body.items[0].schedule.status, "scheduled");
    const cancelledSchedule = await request(`/api/v1/publications/schedules/${scheduled.body.item.id}/cancel`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(cancelledSchedule.status, 200);
    assert.equal(cancelledSchedule.body.item.status, "cancelled");
    const mcpScheduled = await request("/mcp", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "publication.schedule",
          arguments: { contentIds: [draft.body.item.id], baseUrl: "https://www.example.com", scheduledFor: new Date(Date.now() + 180_000).toISOString() },
        },
      }),
    });
    const mcpSchedule = mcpScheduled.body.result.structuredContent.item;
    assert.equal(mcpSchedule.status, "scheduled");
    const mcpCancelled = await request("/mcp", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "publication.schedule_cancel", arguments: { scheduleId: mcpSchedule.id } } }),
    });
    assert.equal(mcpCancelled.body.result.structuredContent.item.status, "cancelled");

    const submitted = await request("/api/v1/providers/provider-legal-demo/listing-submission", {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.item.listingStatus, "pending_review");
    const filteredBuild = await request("/api/v1/publications/build", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ contentIds: [draft.body.item.id], baseUrl: "https://www.example.com" }),
    });
    assert.equal(filteredBuild.status, 201);
    const filteredFiles = new Map((filteredBuild.body.item.files as Array<{ path: string; content: string }>).map((file) => [file.path, file.content]));
    assert.equal(filteredFiles.has("categories/legal/providers/provider-legal-demo/index.html"), false);
    assert.doesNotMatch(filteredFiles.get("sitemap.xml") ?? "", /categories\/legal\/providers\/provider-legal-demo/);

    const deployed = await request("/api/v1/publications/deploy", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ contentIds: [draft.body.item.id], baseUrl: "https://www.example.com" }),
    });
    assert.equal(deployed.status, 202);
    assert.equal(deployed.body.item.deployment.status, "dry_run");

    const published = await request("/api/v1/publications/publish", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ contentIds: [draft.body.item.id], baseUrl: "https://www.example.com" }),
    });
    assert.equal(published.status, 202);
    assert.equal(published.body.item.deployment.status, "dry_run");
    assert.deepEqual(published.body.item.publishedContentIds, []);

    const history = await request("/api/v1/publications", { headers: authHeaders });
    assert.equal(history.status, 200);
    assert.ok(history.body.items.length >= 1);
    assert.ok(history.body.items.every((item: { fileCount: number; files?: unknown }) => item.fileCount > 0 && item.files === undefined));

    const historyMcp = await request("/mcp", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "publication.history", arguments: {} } }),
    });
    assert.ok(historyMcp.body.result.structuredContent.items.length >= 1);

    const dryRunRollback = await request(`/api/v1/publications/${published.body.item.publication.publicationId}/rollback`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({}),
    });
    assert.equal(dryRunRollback.status, 409);
  });

  it("FAQPageのJSON-LDをFAQ構造として1つだけ出力する", async () => {
    const auth = new InMemoryAuthService();
    const portal = new PortalService(auth);
    const content = new ContentService(portal);
    const publication = new PublicationService(portal, content);
    const login = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
    if (!login || !("accessToken" in login)) throw new Error("FAQ構造化データ用ログインに失敗しました。");

    const created = content.createContent(login.principal, {
      category: "legal",
      contentType: "blog",
      audience: "customer",
      title: "法律相談のよくある質問",
      summary: "法律相談を検討する方が確認したい質問と回答を整理した案内です。",
      body: "# 法律相談のよくある質問\n\n相談前に確認できる情報を掲載しています。",
      sourceFacts: ["事業者が確認したFAQ情報です。"],
      seo: {
        title: "法律相談のよくある質問と回答",
        description: "法律相談を検討する前に確認したい質問と回答を整理した案内です。",
        keywords: ["法律相談"],
        canonicalPath: "/content/legal-faq/",
        ogTitle: "法律相談のよくある質問と回答",
        ogDescription: "法律相談を検討する前に確認したい質問と回答を整理した案内です。",
        jsonLdType: "FAQPage",
        faq: [{ question: "初回相談で何を準備しますか？", answer: "相談内容と関係資料を整理してお持ちください。" }],
      },
    });
    await content.polishContent(login.principal, created.id);
    content.auditSeo(login.principal, created.id);
    content.factCheck(login.principal, created.id);
    content.approveContent(login.principal, created.id);

    const built = publication.build(login.principal, [created.id], "https://www.example.com");
    const page = built.files.find((file) => file.path.startsWith("content/") && file.path.endsWith("/index.html"))?.content ?? "";
    const jsonLdText = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(jsonLdText);
    const graph = JSON.parse(jsonLdText) as { "@graph": Array<Record<string, any>> };
    const faqNodes = graph["@graph"].filter((node) => node["@type"] === "FAQPage");
    assert.equal(faqNodes.length, 1);
    assert.equal(faqNodes[0]?.headline, undefined);
    assert.equal(faqNodes[0]?.mainEntity[0]?.acceptedAnswer?.text, "相談内容と関係資料を整理してお持ちください。");
  });

  it("静的公開の主要操作をMCPから利用できる", async () => {
    const tools = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const names = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    assert.ok(names.includes("workflow.approve"));
    assert.ok(names.includes("publication.build"));
    assert.ok(names.includes("publication.deploy"));
    assert.ok(names.includes("publication.publish"));
    assert.ok(names.includes("publication.unpublish"));
    assert.ok(names.includes("publication.schedule"));
    assert.ok(names.includes("publication.schedule_list"));
    assert.ok(names.includes("publication.schedule_cancel"));
    assert.ok(names.includes("publication.schedule_execute"));
    assert.ok(names.includes("publication.history"));
    assert.ok(names.includes("publication.rollback"));
  });

  it("サイトSEO監査に重大エラーがある公開を拒否する", async () => {
    const auth = new InMemoryAuthService();
    const portal = new PortalService(auth);
    const content = new ContentService(portal);
    const publication = new PublicationService(portal, content, new BuilderOSAdapter(), () => ({
      accountId: "account-seo-gate",
      projectName: "cms-os-seo-gate",
      dryRun: true,
    }));
    const login = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
    if (!login || !("accessToken" in login)) throw new Error("SEOゲート用ログインに失敗しました。");

    const createApprovedContent = async (title: string) => {
      const draft = content.createContent(login.principal, {
        category: "legal",
        contentType: "blog",
        audience: "customer",
        title,
        summary: "検索意図に沿った相談案内の概要です。",
        body: `# ${title}\n\n確認済み情報をもとにした本文です。`,
        sourceFacts: ["事業者が確認した一次情報です。"],
        seo: {
          canonicalPath: "/content/seo-canonical-duplicate",
          title: `${title}の詳しい相談案内`,
          description: "相談前に確認すべき情報と具体的な次の行動を整理した案内です。",
        },
      });
      await content.polishContent(login.principal, draft.id);
      content.auditSeo(login.principal, draft.id);
      content.factCheck(login.principal, draft.id);
      return content.approveContent(login.principal, draft.id);
    };

    const first = await createApprovedContent("SEO重複検証・相続相談");
    const second = await createApprovedContent("SEO重複検証・遺言相談");
    await assert.rejects(
      () => publication.publish(login.principal, [first.id, second.id], "https://www.example.com"),
      (error: unknown) => error instanceof Error && error.message.includes("サイトSEO監査に重大な問題"),
    );
    assert.equal(content.getContent(login.principal, first.id).status, "approved");
    assert.equal(content.getContent(login.principal, second.id).status, "approved");
  });

  it("Cloudflare公開受付が成功したときだけコンテンツを公開状態へ進める", async () => {
    const auth = new InMemoryAuthService();
    const portal = new PortalService(auth);
    const content = new ContentService(portal);
    const login = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
    if (!login || !("accessToken" in login)) throw new Error("テスト用事業者ログインに失敗しました。");

    const adapter = new BuilderOSAdapter();
    adapter.deployToCloudflarePages = async (build) => ({
      status: "submitted",
      provider: "cloudflare-pages",
      projectName: "cms-os-test",
      requestId: "request-test",
      publicationId: build.publicationId,
      fileCount: build.files.length,
      uploadedFileCount: build.files.length,
    });
    const publication = new PublicationService(portal, content, adapter, () => ({
      accountId: "account-test",
      projectName: "cms-os-test",
    }));

    const proposal = await content.createProposal(login.principal, {
      category: "legal",
      contentType: "blog",
      audience: "customer",
      topic: "公開状態の検証",
      sourceFacts: ["確認済みの事実"],
    });
    const draft = await content.createDraft(login.principal, proposal.id);
    await content.polishContent(login.principal, draft.id);
    content.auditSeo(login.principal, draft.id);
    content.factCheck(login.principal, draft.id);
    content.approveContent(login.principal, draft.id);

    const result = await publication.publish(login.principal, [draft.id], "https://www.example.com");
    assert.equal(result.deployment.status, "submitted");
    assert.deepEqual(result.publishedContentIds, [draft.id]);
    assert.equal(content.getContent(login.principal, draft.id).status, "published");

    const history = publication.listHistory(login.principal);
    const publishedHistory = history.find((item) => item.id === result.publication.publicationId);
    assert.equal(publishedHistory?.status, "published");
    assert.ok((publishedHistory?.fileCount ?? 0) > 0);

    const rollback = await publication.rollback(login.principal, result.publication.publicationId, "https://www.example.com");
    assert.equal(rollback.deployment.status, "submitted");
    assert.equal(rollback.rolledBackPublicationId, result.publication.publicationId);
    const rollbackHistory = publication.listHistory(login.principal).find((item) => item.id === rollback.publication.publicationId);
    assert.equal(rollbackHistory?.status, "rolled_back");
    assert.equal(rollbackHistory?.rollbackOf, result.publication.publicationId);

    const pendingUnpublishSchedule = publication.schedule(
      login.principal,
      new Date(Date.now() + 300_000).toISOString(),
      [draft.id],
      "https://www.example.com",
    );
    const apiServer = createHttpServer(auth, portal, content, publication);
    await new Promise<void>((resolve) => apiServer.listen(0, "127.0.0.1", resolve));
    const apiAddress = apiServer.address();
    if (!apiAddress || typeof apiAddress === "string") throw new Error("公開取消APIテスト用サーバーのポートを取得できません。");
    let unpublished: any;
    try {
      const unpublishResponse = await fetch(`http://127.0.0.1:${apiAddress.port}/api/v1/publications/unpublish`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${login.accessToken}` },
        body: JSON.stringify({ contentIds: [draft.id], baseUrl: "https://www.example.com" }),
      });
      assert.equal(unpublishResponse.status, 202);
      unpublished = (await unpublishResponse.json()).item;
    } finally {
      await new Promise<void>((resolve, reject) => apiServer.close((error) => (error ? reject(error) : resolve())));
    }
    assert.equal(unpublished.deployment.status, "submitted");
    assert.deepEqual(unpublished.unpublishedContentIds, [draft.id]);
    assert.equal((unpublished.publication.files as Array<{ path: string }>).some((file) => file.path === `content/${draft.slug}/index.html`), false);
    assert.ok(unpublished.cancelledScheduleIds.includes(pendingUnpublishSchedule.id));
    assert.equal(content.getContent(login.principal, draft.id).status, "archived");
    assert.equal(publication.listSchedules(login.principal).find((item) => item.id === pendingUnpublishSchedule.id)?.status, "cancelled");

    const scheduledProposal = await content.createProposal(login.principal, {
      category: "legal",
      contentType: "blog",
      audience: "customer",
      topic: "予約公開の実行確認",
      sourceFacts: ["予約公開の実行確認に使用する一次情報"],
    });
    const scheduledDraft = await content.createDraft(login.principal, scheduledProposal.id);
    await content.polishContent(login.principal, scheduledDraft.id);
    content.auditSeo(login.principal, scheduledDraft.id);
    content.factCheck(login.principal, scheduledDraft.id);
    content.approveContent(login.principal, scheduledDraft.id);
    const schedule = publication.schedule(
      login.principal,
      new Date(Date.now() + 60_000).toISOString(),
      [scheduledDraft.id],
      "https://www.example.com",
    );
    const executed = await publication.executeSchedulesAsOperator(new Date(Date.now() + 120_000).toISOString());
    assert.equal(executed.length, 1);
    assert.equal(executed[0]?.status, "executed");
    assert.equal(executed[0]?.schedule.id, schedule.id);
    assert.equal(content.getContent(login.principal, scheduledDraft.id).status, "published");
  });
});
