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
      body: JSON.stringify({}),
    });
    assert.equal(polished.body.item.status, "polished");

    const audited = await request(`/api/v1/content/${draft.body.item.id}/seo-audit`, {
      method: "POST",
      headers: authHeaders,
    });
    assert.equal(audited.status, 200);

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
    assert.match(fileMap.get(pagePath) ?? "", /application\/ld\+json/);
    assert.match(fileMap.get(pagePath) ?? "", /<link rel="canonical"/);
    assert.match(fileMap.get("sitemap.xml") ?? "", /https:\/\/www\.example\.com/);
    assert.match(fileMap.get("robots.txt") ?? "", /Sitemap: https:\/\/www\.example\.com\/sitemap\.xml/);

    const deployed = await request("/api/v1/publications/deploy", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ contentIds: [draft.body.item.id], baseUrl: "https://www.example.com" }),
    });
    assert.equal(deployed.status, 202);
    assert.equal(deployed.body.item.deployment.status, "dry_run");
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
  });
});
