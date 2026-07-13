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

describe("CMS-OSカテゴリ別アクセス制御", () => {
  it("追加テーマカテゴリをRESTとカテゴリ別ポリシーから取得できる", async () => {
    const categories = await request("/api/v1/categories");
    const slugs = categories.body.items.map((item: { slug: string }) => item.slug);

    assert.equal(categories.status, 200);
    assert.ok(slugs.includes("ai-business"));
    assert.ok(slugs.includes("tourism"));
    assert.ok(slugs.includes("gx"));

    const experience = await request("/api/v1/categories/ai-business/experience");
    const providers = await request("/api/v1/providers?category=ai-business");

    assert.equal(experience.status, 200);
    assert.ok(experience.body.experience.visibleModules.includes("providerSearch"));
    assert.ok(!experience.body.experience.visibleModules.includes("legalDisclaimer"));
    assert.equal(providers.status, 200);
    assert.equal(providers.body.items[0].id, "provider-ai-business-demo");
    assert.equal(providers.body.items[0].contactOptions, undefined);
  });

  it("未ログインのユーザーにカテゴリごとの表示モジュールを返す", async () => {
    const legal = await request("/api/v1/categories/legal/experience");
    const beauty = await request("/api/v1/categories/beauty/experience");

    assert.equal(legal.status, 200);
    assert.equal(beauty.status, 200);
    assert.ok(legal.body.experience.visibleModules.includes("legalDisclaimer"));
    assert.ok(!legal.body.experience.visibleModules.includes("booking"));
    assert.ok(beauty.body.experience.visibleModules.includes("styleGallery"));
    assert.ok(!beauty.body.experience.visibleModules.includes("legalDisclaimer"));
  });

  it("発注者は注文者向けの情報を取得でき、一般ユーザーには取得できない", async () => {
    const userLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "demo-password", category: "legal", role: "user" }),
    });
    const ordererLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "orderer@example.com", password: "demo-password", category: "legal", role: "orderer" }),
    });

    const userProviders = await request("/api/v1/providers?category=legal", {
      headers: { authorization: `Bearer ${userLogin.body.accessToken}` },
    });
    const ordererProviders = await request("/api/v1/providers?category=legal", {
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
    });

    assert.equal(userProviders.status, 200);
    assert.equal(ordererProviders.status, 200);
    assert.equal(userProviders.body.items[0].contactOptions, undefined);
    assert.deepEqual(ordererProviders.body.items[0].contactOptions, ["相談予約", "案件相談"]);
  });

  it("事業者は割り当てられていないカテゴリの事業者ロールへ切り替えられない", async () => {
    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "beauty@example.com", password: "demo-password", category: "beauty", role: "provider" }),
    });

    const response = await request("/api/v1/auth/context", {
      method: "POST",
      headers: { authorization: `Bearer ${login.body.accessToken}` },
      body: JSON.stringify({ category: "legal", role: "provider" }),
    });

    assert.equal(response.status, 403);
  });

  it("MCPからカテゴリ表示と事業者検索を実行できる", async () => {
    const tools = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    assert.equal(tools.status, 200);
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "provider.search"));
    const providerSearchTool = tools.body.result.tools.find((tool: { name: string }) => tool.name === "provider.search");
    assert.ok(providerSearchTool.inputSchema.properties.category.enum.includes("ai-business"));

    const search = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "provider.search", arguments: { category: "beauty", theme: "カラー" } },
      }),
    });
    assert.equal(search.status, 200);
    assert.equal(search.body.result.structuredContent[0].name, "CMS-OS美容室（サンプル）");
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "request.create"));

    const ordererLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "orderer@example.com", password: "demo-password", category: "beauty", role: "orderer" }),
    });
    const mcpRequest = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "request.create",
          arguments: {
            category: "beauty",
            providerId: "provider-beauty-demo",
            title: "カラーの予約について相談したい",
            description: "希望するカラーと予約可能な日時を相談したいです。",
          },
        },
      }),
    });
    assert.equal(mcpRequest.status, 200);
    assert.equal(mcpRequest.body.result.structuredContent.providerId, "provider-beauty-demo");

    const applicationTools = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list", params: {} }),
    });
    assert.ok(applicationTools.body.result.tools.some((tool: { name: string }) => tool.name === "application.list"));
  });

  it("発注者は依頼を作成でき、一般ユーザーは作成できない", async () => {
    const ordererLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "orderer@example.com", password: "demo-password", category: "legal", role: "orderer" }),
    });
    const created = await request("/api/v1/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
      body: JSON.stringify({
        category: "legal",
        providerId: "provider-legal-demo",
        title: "相続案件について相談したい",
        description: "相続人が複数いるため、初回相談の進め方を確認したいです。",
      }),
    });
    assert.equal(created.status, 201);

    const userLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "demo-password", category: "legal", role: "user" }),
    });
    const denied = await request("/api/v1/requests", {
      method: "POST",
      headers: { authorization: `Bearer ${userLogin.body.accessToken}` },
      body: JSON.stringify({
        category: "legal",
        providerId: "provider-legal-demo",
        title: "依頼",
        description: "権限のないユーザーからの依頼作成です。",
      }),
    });
    assert.equal(denied.status, 403);
  });

  it("担当事業者だけが依頼を確認できる", async () => {
    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const requests = await request("/api/v1/requests", {
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
    });
    assert.equal(requests.status, 200);
    assert.ok(requests.body.items.some((item: { providerId: string }) => item.providerId === "provider-legal-demo"));

    const beautyProviderLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "beauty@example.com", password: "demo-password", category: "beauty", role: "provider" }),
    });
    const unrelated = await request("/api/v1/requests", {
      headers: { authorization: `Bearer ${beautyProviderLogin.body.accessToken}` },
    });
    assert.equal(unrelated.status, 200);
    assert.ok(unrelated.body.items.every((item: { category: string }) => item.category === "beauty"));
    assert.ok(!unrelated.body.items.some((item: { providerId: string }) => item.providerId === "provider-legal-demo"));
  });

  it("リクルーターは求人に応募でき、応募情報は本人と事業者に限定される", async () => {
    const publicJobs = await request("/api/v1/jobs?category=legal");
    assert.equal(publicJobs.status, 200);
    assert.equal(publicJobs.body.items[0].providerId, "非公開");

    const candidateLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "candidate@example.com", password: "demo-password", category: "legal", role: "candidate" }),
    });
    const application = await request("/api/v1/jobs/job-legal-demo/applications", {
      method: "POST",
      headers: { authorization: `Bearer ${candidateLogin.body.accessToken}` },
      body: JSON.stringify({ message: "企業法務の経験があり、チームでの業務に関心があります。" }),
    });
    assert.equal(application.status, 201);

    const providerLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    const providerApplications = await request("/api/v1/applications", {
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
    });
    assert.equal(providerApplications.status, 200);
    assert.equal(providerApplications.body.items[0].jobId, "job-legal-demo");
  });
});
