import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";

let server: Server;
let baseUrl: string;
let legalProviderToken: string;
let legalOrdererToken: string;
const previousOperatorKey = process.env.CMS_OS_OPERATOR_KEY;

before(async () => {
  process.env.CMS_OS_OPERATOR_KEY = "test-operator-key";
  const auth = new InMemoryAuthService();
  const providerLogin = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
  const ordererLogin = auth.login("orderer@example.com", "demo-password", "legal", "orderer");
  if (!providerLogin || !ordererLogin || !("accessToken" in providerLogin) || !("accessToken" in ordererLogin)) throw new Error("テスト用の事業者トークンを作成できません。");
  legalProviderToken = providerLogin.accessToken;
  legalOrdererToken = ordererLogin.accessToken;
  const portal = new PortalService(auth);
  server = createHttpServer(auth, portal);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("テストサーバーのポートを取得できません。");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (previousOperatorKey === undefined) delete process.env.CMS_OS_OPERATOR_KEY;
  else process.env.CMS_OS_OPERATOR_KEY = previousOperatorKey;
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
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "provider.get"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "provider.update"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "provider.listing_submit"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "provider.listing_review"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "job.create"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "job.update"));
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
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "request.update_status"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "inquiry.create"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "inquiry.list"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "inquiry.update_status"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "application.update_status"));

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

    const closedRequest = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 5,
        method: "tools/call",
        params: { name: "request.update_status", arguments: { requestId: mcpRequest.body.result.structuredContent.id, status: "closed" } },
      }),
    });
    assert.equal(closedRequest.status, 200);
    assert.equal(closedRequest.body.result.structuredContent.status, "closed");

    const applicationTools = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/list", params: {} }),
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
    const requestId = requests.body.items[0].id as string;
    const accepted = await request(`/api/v1/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ status: "accepted" }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.item.status, "accepted");

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
    const screening = await request(`/api/v1/applications/${providerApplications.body.items[0].id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ status: "screening" }),
    });
    assert.equal(screening.status, 200);
    assert.equal(screening.body.item.status, "screening");
  });

  it("ログインユーザーは公開事業者へ問い合わせでき、送信者と事業者だけが状態を更新できる", async () => {
    const created = await request("/api/v1/inquiries", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({
        category: "legal",
        providerId: "provider-legal-demo",
        subject: "対応エリアについて確認したい",
        message: "オンライン相談に対応している地域と時間帯を確認したいです。",
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.status, "open");

    const providerInquiries = await request("/api/v1/inquiries", {
      headers: { authorization: `Bearer ${legalProviderToken}` },
    });
    assert.equal(providerInquiries.status, 200);
    assert.ok(providerInquiries.body.items.some((item: { id: string }) => item.id === created.body.item.id));

    const responded = await request(`/api/v1/inquiries/${created.body.item.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({ status: "responded" }),
    });
    assert.equal(responded.status, 200);
    assert.equal(responded.body.item.status, "responded");

    const closed = await request(`/api/v1/inquiries/${created.body.item.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ status: "closed" }),
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.item.status, "closed");

    const mcpCreated = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: {
          name: "inquiry.create",
          arguments: {
            category: "legal",
            providerId: "provider-legal-demo",
            subject: "MCPから問い合わせを送る",
            message: "MCP経由の問い合わせ導線が利用できるか確認します。",
          },
        },
      }),
    });
    assert.equal(mcpCreated.status, 200);
    assert.equal(mcpCreated.body.result.structuredContent.status, "open");
  });

  it("掲載情報を審査待ちへ送り、運営審査後に公開へ戻せる", async () => {
    const submitted = await request("/api/v1/providers/provider-legal-demo/listing-submission", {
      method: "POST",
      headers: { authorization: `Bearer ${legalProviderToken}` },
    });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.item.listingStatus, "pending_review");

    const hidden = await request("/api/v1/providers/provider-legal-demo");
    assert.equal(hidden.status, 404);

    const deniedReview = await request("/api/v1/providers/provider-legal-demo/listing-review", {
      method: "PATCH",
      body: JSON.stringify({ status: "published" }),
    });
    assert.equal(deniedReview.status, 403);

    const reviewed = await request("/api/v1/providers/provider-legal-demo/listing-review", {
      method: "PATCH",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({ status: "published", note: "公開情報と掲載条件を確認しました。" }),
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.body.item.listingStatus, "published");

    const visible = await request("/api/v1/providers/provider-legal-demo");
    assert.equal(visible.status, 200);
  });

  it("莠区･ｭ閠・譛ｬ莠ｺ縺ｮ謗ｲ霈画ュ蝣ｱ縺ｨ蜿｣蜿門ｾ励ｒREST縺ｧ譁ｰ逕滂ｺｺ繧医Μ蜿門ｾ励〒縺阪ｋ", async () => {
    const updated = await request("/api/v1/providers/provider-legal-demo", {
      method: "PATCH",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({ publicFields: { portalTestLabel: "verified" } }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.portalTestLabel, "verified");

    const publicProvider = await request("/api/v1/providers/provider-legal-demo");
    assert.equal(publicProvider.status, 200);
    assert.equal(publicProvider.body.item.portalTestLabel, "verified");

    const protectedUpdate = await request("/api/v1/providers/provider-legal-demo", {
      method: "PATCH",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({ publicFields: { name: "上書き不可" } }),
    });
    assert.equal(protectedUpdate.status, 400);

    const denied = await request("/api/v1/providers/provider-legal-demo", {
      method: "PATCH",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ publicFields: { ordererAttempt: "denied" } }),
    });
    assert.equal(denied.status, 403);
  });

  it("莠区･ｭ閠・譛ｬ莠ｺ縺ｮ豎ゆｺｺ縺ｮ菴懈・縺ｨ繧ｯ繝ｭ繝ｼ繧ｺ縺ｮ迥ｶ諷九ｒREST縺ｧ邂｡逅・〒縺阪ｋ", async () => {
    const created = await request("/api/v1/jobs", {
      method: "POST",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({
        category: "legal",
        title: "CMS-OS求人テスト",
        employmentType: "正社員",
        location: "東京都",
        description: "CMS-OSの求人管理APIを検証するための求人です。",
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.status, "published");

    const closed = await request(`/api/v1/jobs/${created.body.item.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({ status: "closed" }),
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.item.status, "closed");

    const providerJobs = await request("/api/v1/jobs?category=legal", {
      headers: { authorization: `Bearer ${legalProviderToken}` },
    });
    assert.ok(providerJobs.body.items.some((item: { id: string; status: string }) => item.id === created.body.item.id && item.status === "closed"));

    const publicJobs = await request("/api/v1/jobs?category=legal");
    assert.ok(!publicJobs.body.items.some((item: { id: string }) => item.id === created.body.item.id));
  });

  it("MCP縺ｧ莠区･ｭ閠・諠・ｱ縺ｨ豎ゆｺｺ繧貞ｮ溯｡後〒縺阪ｋ", async () => {
    const update = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "provider.update", arguments: { providerId: "provider-legal-demo", publicFields: { mcpTestLabel: "ok" } } },
      }),
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.result.structuredContent.mcpTestLabel, "ok");

    const created = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "job.create",
          arguments: {
            category: "legal",
            title: "MCP求人テスト",
            employmentType: "業務委託",
            location: "オンライン",
            description: "MCP経由で作成する求人の動作確認です。",
          },
        },
      }),
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.result.structuredContent.status, "published");

    const closed = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 12,
        method: "tools/call",
        params: { name: "job.update", arguments: { jobId: created.body.result.structuredContent.id, status: "closed" } },
      }),
    });
    assert.equal(closed.status, 200);
    assert.equal(closed.body.result.structuredContent.status, "closed");
  });
});
