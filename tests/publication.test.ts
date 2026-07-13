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
      body: JSON.stringify({ instructions: "\n\n| 比較項目 | 選択肢A | 選択肢B |\n| --- | --- | --- |\n| 対象 | 顧客 | 求職者 |" }),
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
    assert.ok(fileMap.has("categories/ai-business/index.html"));
    assert.ok(fileMap.has("categories/ai-business/providers/provider-ai-business-demo/index.html"));
    assert.match(fileMap.get(pagePath) ?? "", /application\/ld\+json/);
    assert.match(fileMap.get(pagePath) ?? "", /<table>/);
    assert.match(fileMap.get(pagePath) ?? "", /FAQPage/);
    assert.match(fileMap.get(pagePath) ?? "", /BreadcrumbList/);
    assert.match(fileMap.get(pagePath) ?? "", /<link rel="canonical"/);
    assert.match(fileMap.get(pagePath) ?? "", /hreflang="ja"/);
    assert.match(fileMap.get("sitemap.xml") ?? "", /https:\/\/www\.example\.com/);
    assert.match(fileMap.get("sitemap.xml") ?? "", /categories\/legal\/providers\/provider-legal-demo/);
    assert.match(fileMap.get("robots.txt") ?? "", /Sitemap: https:\/\/www\.example\.com\/sitemap\.xml/);
    assert.match(fileMap.get("robots.txt") ?? "", /GPTBot/);
    assert.match(fileMap.get("robots.txt") ?? "", /Disallow: \/api\//);
    assert.match(fileMap.get("llms.txt") ?? "", /Provider/);
    assert.match(fileMap.get("llms.txt") ?? "", /ai-business/);
    assert.match(fileMap.get("categories/legal/index.html") ?? "", /弁護士ドットコム/);
    assert.match(fileMap.get("categories\/legal\/providers\/provider-legal-demo\/index.html") ?? "", /Organization/);

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

    const proposal = content.createProposal(login.principal, {
      category: "legal",
      contentType: "blog",
      audience: "customer",
      topic: "公開状態の検証",
      sourceFacts: ["確認済みの事実"],
    });
    const draft = content.createDraft(login.principal, proposal.id);
    content.polishContent(login.principal, draft.id);
    content.auditSeo(login.principal, draft.id);
    content.factCheck(login.principal, draft.id);
    content.approveContent(login.principal, draft.id);

    const result = await publication.publish(login.principal, [draft.id], "https://www.example.com");
    assert.equal(result.deployment.status, "submitted");
    assert.deepEqual(result.publishedContentIds, [draft.id]);
    assert.equal(content.getContent(login.principal, draft.id).status, "published");
  });
});
