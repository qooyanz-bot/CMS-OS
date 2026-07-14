import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";
import type { CategorySlug } from "../src/domain/types.js";

let server: Server;
let baseUrl: string;
let legalProviderToken: string;
let legalOrdererToken: string;
let beautyProviderToken: string;
let genericProviderTokens: Array<[string, string]>;
const previousOperatorKey = process.env.CMS_OS_OPERATOR_KEY;

before(async () => {
  process.env.CMS_OS_OPERATOR_KEY = "test-operator-key";
  const auth = new InMemoryAuthService();
  const providerLogin = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
  const ordererLogin = auth.login("orderer@example.com", "demo-password", "legal", "orderer");
  const beautyProviderLogin = auth.login("beauty@example.com", "demo-password", "beauty", "provider");
  if (!providerLogin || !ordererLogin || !beautyProviderLogin || !("accessToken" in providerLogin) || !("accessToken" in ordererLogin) || !("accessToken" in beautyProviderLogin)) throw new Error("テスト用の事業者トークンを作成できません。");
  legalProviderToken = providerLogin.accessToken;
  legalOrdererToken = ordererLogin.accessToken;
  beautyProviderToken = beautyProviderLogin.accessToken;
  genericProviderTokens = [];
  const genericProviderDemos: Array<[CategorySlug, string]> = [
    ["ai-business", "ai-business@example.com"],
    ["labor-shortage", "labor-shortage@example.com"],
    ["tourism", "tourism@example.com"],
    ["mobility-dx", "mobility-dx@example.com"],
    ["gx", "gx@example.com"],
    ["regional-revitalization", "regional@example.com"],
  ];
  for (const [category, email] of genericProviderDemos) {
    const genericProviderLogin = auth.login(email, "demo-password", category, "provider");
    if (!genericProviderLogin || !("accessToken" in genericProviderLogin)) throw new Error(`${category}のテスト用事業者トークンを作成できません。`);
    genericProviderTokens.push([category, genericProviderLogin.accessToken]);
  }
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
    const tourism = await request("/api/v1/categories/tourism/experience");
    const gx = await request("/api/v1/categories/gx/experience");
    const providers = await request("/api/v1/providers?category=ai-business");

    assert.equal(experience.status, 200);
    assert.equal(tourism.status, 200);
    assert.equal(gx.status, 200);
    assert.ok(experience.body.experience.visibleModules.includes("providerSearch"));
    assert.ok(experience.body.experience.visibleModules.includes("aiUseCases"));
    assert.ok(tourism.body.experience.visibleModules.includes("destinationGuide"));
    assert.ok(gx.body.experience.visibleModules.includes("decarbonizationGuide"));
    assert.notDeepEqual(experience.body.experience.visibleModules, tourism.body.experience.visibleModules);
    assert.notDeepEqual(tourism.body.experience.visibleModules, gx.body.experience.visibleModules);
    assert.ok(!experience.body.experience.visibleModules.includes("legalDisclaimer"));
    assert.equal(providers.status, 200);
    assert.equal(providers.body.items[0].id, "provider-ai-business-demo");
    assert.equal(providers.body.items[0].contactOptions, undefined);
  });

  it("カテゴリ別事業者ログイン後に専用表示モジュールを返す", async () => {
    const expectedModules: Record<string, string> = {
      "ai-business": "aiSolutionManagement",
      "labor-shortage": "recruitmentManagement",
      tourism: "tourismExperienceManagement",
      "mobility-dx": "fleetManagement",
      gx: "gxManagement",
      "regional-revitalization": "regionalProjectManagement",
    };
    for (const [category, token] of genericProviderTokens) {
      const context = await request(`/api/v1/categories/${category}`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(context.status, 200);
      assert.equal(context.body.item.experience.role, "provider");
      assert.ok(context.body.item.experience.visibleModules.includes(expectedModules[category]), `${category}の専用モジュールがありません。`);
    }
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

  it("カテゴリ別外部案内をRESTとMCPでロール別に返す", async () => {
    const legal = await request("/api/v1/categories/legal/directories");
    const beauty = await request("/api/v1/categories/beauty/directories");
    assert.equal(legal.status, 200);
    assert.equal(beauty.status, 200);
    assert.equal(legal.body.items[0].name, "弁護士ドットコム");
    assert.ok(legal.body.items.some((item: { id: string; name: string }) => item.id === "directory-legal-sigyo-net" && item.name === "士業ねっと！"));
    assert.equal(beauty.body.items[0].name, "ホットペッパービューティー");
    assert.equal(beauty.body.items.some((item: { kind: string }) => item.kind === "provider_resource"), false);
    const themeCategories = ["ai-business", "labor-shortage", "tourism", "mobility-dx", "gx", "regional-revitalization"];
    for (const category of themeCategories) {
      const guides = await request(`/api/v1/categories/${category}/directories`);
      assert.equal(guides.status, 200);
      assert.ok(guides.body.items.length > 0, `${category}の外部案内が空です。`);
    }

    const providerGuides = await request("/api/v1/categories/beauty/directories", {
      headers: { authorization: `Bearer ${beautyProviderToken}` },
    });
    assert.equal(providerGuides.status, 200);
    assert.equal(providerGuides.body.items.length, 1);
    assert.equal(providerGuides.body.items[0].kind, "provider_resource");

    const tools = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 41, method: "tools/list" }),
    });
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "directory.list"));
    const mcpGuides = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "directory.list", arguments: { category: "legal" } } }),
    });
    assert.equal(mcpGuides.status, 200);
    assert.equal(mcpGuides.body.result.structuredContent.items[0].id, "directory-legal-bengo4");
    assert.ok(mcpGuides.body.result.structuredContent.items.some((item: { id: string }) => item.id === "directory-legal-sigyo-net"));
  });

  it("カテゴリ文脈をRESTとMCPからロール別に取得できる", async () => {
    const legal = await request("/api/v1/categories/legal");
    const beauty = await request("/api/v1/categories/beauty");
    const invalid = await request("/api/v1/categories/not-real");

    assert.equal(legal.status, 200);
    assert.equal(beauty.status, 200);
    assert.equal(invalid.status, 404);
    assert.equal(legal.body.item.slug, "legal");
    assert.ok(legal.body.item.experience.visibleModules.includes("legalDisclaimer"));
    assert.ok(beauty.body.item.experience.visibleModules.includes("styleGallery"));
    assert.ok(legal.body.item.directoryGuides.length > 0);

    const orderer = await request("/api/v1/categories/legal", { headers: { authorization: `Bearer ${legalOrdererToken}` } });
    assert.equal(orderer.body.item.experience.role, "orderer");
    assert.ok(orderer.body.item.experience.allowedActions.includes("request.create"));

    const tools = await request("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 46, method: "tools/list" }) });
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "category.list"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "category.get"));
    const mcpCategories = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 45, method: "tools/call", params: { name: "category.list", arguments: {} } }),
    });
    assert.equal(mcpCategories.status, 200);
    assert.ok(mcpCategories.body.result.structuredContent.items.some((item: { slug: string }) => item.slug === "legal"));
    const mcpCategory = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 47, method: "tools/call", params: { name: "category.get", arguments: { category: "legal" } } }),
    });
    assert.equal(mcpCategory.status, 200);
    assert.equal(mcpCategory.body.result.structuredContent.item.experience.role, "orderer");
  });

  it("MCP Resourceからカテゴリ別・ロール別の表示コンテキストを取得できる", async () => {
    const initialize = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 48, method: "initialize" }),
    });
    assert.deepEqual(initialize.body.result.capabilities.resources, {});

    const listed = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 49, method: "resources/list" }),
    });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.result.resources.some((resource: { uri: string }) => resource.uri === "cms-os://categories/beauty/context"));

    const ordererExperience = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 52, method: "resources/read", params: { uri: "cms-os://categories/legal/experience" } }),
    });
    const ordererExperienceValue = JSON.parse(ordererExperience.body.result.contents[0].text) as { item: { role: string; allowedActions: string[] } };
    assert.equal(ordererExperienceValue.item.role, "orderer");
    assert.equal(ordererExperienceValue.item.allowedActions.includes("request.create"), true);

    const publicDirectories = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 50, method: "resources/read", params: { uri: "cms-os://categories/legal/directories" } }),
    });
    const publicDirectoryValue = JSON.parse(publicDirectories.body.result.contents[0].text) as { items: Array<{ kind: string }> };
    assert.equal(publicDirectories.status, 200);
    assert.equal(publicDirectoryValue.items.some((item) => item.kind === "provider_resource"), false);

    const providerDirectories = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${beautyProviderToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 51, method: "resources/read", params: { uri: "cms-os://categories/beauty/directories" } }),
    });
    const providerDirectoryValue = JSON.parse(providerDirectories.body.result.contents[0].text) as { items: Array<{ kind: string }> };
    assert.equal(providerDirectories.status, 200);
    assert.equal(providerDirectoryValue.items.some((item) => item.kind === "provider_resource"), true);
  });

  it("運営キーで外部案内をRESTとMCPから管理できる", async () => {
    const denied = await request("/api/v1/directories", {
      method: "POST",
      body: JSON.stringify({ category: "legal", name: "管理対象案内", kind: "directory", description: "運営管理APIのテスト用外部案内です。", url: "https://example.com/managed", targetRoles: ["user"], verifiedAt: "2026-07-14" }),
    });
    assert.equal(denied.status, 403);

    const created = await request("/api/v1/directories", {
      method: "POST",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({ category: "legal", name: "管理対象案内", kind: "directory", description: "運営管理APIのテスト用外部案内です。", url: "https://example.com/managed", targetRoles: ["user"], verifiedAt: "2026-07-14" }),
    });
    assert.equal(created.status, 201);

    const updated = await request(`/api/v1/directories/${created.body.item.id}`, {
      method: "PATCH",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({ targetRoles: ["provider"], name: "更新済み案内" }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.name, "更新済み案内");

    const userGuides = await request("/api/v1/categories/legal/directories");
    assert.equal(userGuides.body.items.some((item: { id: string }) => item.id === created.body.item.id), false);
    const providerGuides = await request("/api/v1/categories/legal/directories", { headers: { authorization: `Bearer ${legalProviderToken}` } });
    assert.equal(providerGuides.body.items.some((item: { id: string }) => item.id === created.body.item.id), true);

    const tools = await request("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 43, method: "tools/list" }) });
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "directory.create"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "directory.update"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "directory.delete"));

    const mcpCreated = await request("/mcp", {
      method: "POST",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 44, method: "tools/call", params: { name: "directory.create", arguments: { category: "legal", name: "MCP管理案内", kind: "directory", description: "MCP経由で追加するテスト用外部案内です。", url: "https://example.com/mcp-managed", targetRoles: ["user"], verifiedAt: "2026-07-14" } } }),
    });
    assert.equal(mcpCreated.status, 200);
    assert.match(mcpCreated.body.result.structuredContent.id, /^directory-/);

    const deleted = await request(`/api/v1/directories/${created.body.item.id}`, {
      method: "DELETE",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
    });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.deleted, true);

    const mcpDeleted = await request("/mcp", {
      method: "POST",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 45, method: "tools/call", params: { name: "directory.delete", arguments: { directoryId: mcpCreated.body.result.structuredContent.id } } }),
    });
    assert.equal(mcpDeleted.status, 200);
    assert.equal(mcpDeleted.body.result.structuredContent.deleted, true);
  });

  it("運営キーで全カテゴリの予約公開実行をRESTとMCPから起動できる", async () => {
    const denied = await request("/api/v1/publications/schedules/execute", {
      method: "POST",
      body: JSON.stringify({ before: new Date(Date.now() + 60_000).toISOString() }),
    });
    assert.equal(denied.status, 401);

    const executed = await request("/api/v1/publications/schedules/execute", {
      method: "POST",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({ before: new Date(Date.now() + 60_000).toISOString() }),
    });
    assert.equal(executed.status, 200);
    assert.deepEqual(executed.body.items, []);

    const mcpExecuted = await request("/mcp", {
      method: "POST",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 46,
        method: "tools/call",
        params: { name: "publication.schedule_execute", arguments: { before: new Date(Date.now() + 60_000).toISOString() } },
      }),
    });
    assert.deepEqual(mcpExecuted.body.result.structuredContent.items, []);
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

  it("事業者プロフィール詳細はカテゴリとログインロールに応じて投影される", async () => {
    const publicProfile = await request("/api/v1/providers/provider-legal-demo");
    assert.equal(publicProfile.status, 200);
    assert.ok(publicProfile.body.item.practiceAreas);
    assert.equal(publicProfile.body.item.contactOptions, undefined);
    assert.equal(publicProfile.body.item.internalStatus, undefined);

    const ordererProfile = await request("/api/v1/providers/provider-legal-demo", {
      headers: { authorization: `Bearer ${legalOrdererToken}` },
    });
    assert.equal(ordererProfile.status, 200);
    assert.ok(ordererProfile.body.item.contactOptions);
    assert.equal(ordererProfile.body.item.internalStatus, undefined);

    const providerProfile = await request("/api/v1/providers/provider-legal-demo", {
      headers: { authorization: `Bearer ${legalProviderToken}` },
    });
    assert.equal(providerProfile.status, 200);
    assert.ok(providerProfile.body.item.internalStatus);
    assert.equal(providerProfile.body.item.contactOptions, undefined);
  });

  it("発注者はカテゴリ別の公開事業者をお気に入りへ保存・解除でき、MCPと同じ所有者境界を使う", async () => {
    const denied = await request("/api/v1/favorites", {
      method: "POST",
      headers: { authorization: `Bearer ${legalProviderToken}` },
      body: JSON.stringify({ providerId: "provider-legal-demo" }),
    });
    assert.equal(denied.status, 403);

    const added = await request("/api/v1/favorites", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ providerId: "provider-legal-demo" }),
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.created, true);
    assert.equal(added.body.item.providerId, "provider-legal-demo");
    assert.equal(added.body.item.accountId, undefined);

    const duplicate = await request("/api/v1/favorites", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ providerId: "provider-legal-demo" }),
    });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.body.created, false);
    assert.equal(duplicate.body.item.id, added.body.item.id);

    const listed = await request("/api/v1/favorites", { headers: { authorization: `Bearer ${legalOrdererToken}` } });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.items.some((item: { providerId: string }) => item.providerId === "provider-legal-demo"));

    const mcp = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 60, method: "tools/call", params: { name: "favorite.list", arguments: {} } }),
    });
    assert.equal(mcp.status, 200);
    assert.ok(mcp.body.result.structuredContent.items.some((item: { id: string }) => item.id === added.body.item.id));

    const removed = await request(`/api/v1/favorites/${added.body.item.id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
    });
    assert.deepEqual(removed.body, { ok: true });
    const after = await request("/api/v1/favorites", { headers: { authorization: `Bearer ${legalOrdererToken}` } });
    assert.equal(after.body.items.some((item: { id: string }) => item.id === added.body.item.id), false);
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
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "provider.listing_review_queue"));
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
        params: { name: "provider.search", arguments: { category: "beauty", theme: "カラー", sort: "name_asc", limit: 1 } },
      }),
    });
    assert.equal(search.status, 200);
    assert.equal(search.body.result.structuredContent.items[0].name, "CMS-OS美容室（サンプル）");
    assert.equal(search.body.result.structuredContent.page.limit, 1);

    const filteredProviders = await request("/api/v1/providers?category=beauty&theme=%E3%82%AB%E3%83%A9%E3%83%BC&sort=name_asc&limit=1");
    assert.equal(filteredProviders.status, 200);
    assert.equal(filteredProviders.body.page.limit, 1);
    assert.equal(filteredProviders.body.items.length, 1);
    assert.ok(filteredProviders.body.items[0].themes.includes("カラー"));
    const invalidProviderSort = await request("/api/v1/providers?category=beauty&sort=unknown");
    assert.equal(invalidProviderSort.status, 400);
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "request.create"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "request.update_status"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "inquiry.create"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "inquiry.list"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "inquiry.update_status"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "notification.list"));
    assert.ok(tools.body.result.tools.some((tool: { name: string }) => tool.name === "notification.mark_read"));
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

    const providerNotifications = await request("/api/v1/notifications?limit=10", {
      headers: { authorization: `Bearer ${legalProviderToken}` },
    });
    assert.ok(providerNotifications.body.items.some((item: { resourceId: string; type: string }) => item.resourceId === created.body.item.id && item.type === "request_received"));

    const mcpRequests = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 7,
        method: "tools/call",
        params: { name: "request.list", arguments: { limit: 1 } },
      }),
    });
    assert.equal(mcpRequests.body.result.structuredContent.page.limit, 1);

    const filteredRequests = await request("/api/v1/requests?status=submitted&sort=createdAt_asc&limit=1", {
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
    });
    assert.equal(filteredRequests.status, 200);
    assert.equal(filteredRequests.body.page.limit, 1);
    assert.ok(filteredRequests.body.items.every((item: { status: string }) => item.status === "submitted"));
    const invalidRequestLimit = await request("/api/v1/requests?limit=101", {
      headers: { authorization: `Bearer ${ordererLogin.body.accessToken}` },
    });
    assert.equal(invalidRequestLimit.status, 400);

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
    assert.equal(requests.body.page.limit, 50);
    assert.ok(requests.body.items.some((item: { providerId: string }) => item.providerId === "provider-legal-demo"));
    const requestId = requests.body.items[0].id as string;
    const accepted = await request(`/api/v1/requests/${requestId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ status: "accepted" }),
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.item.status, "accepted");
    const ordererNotifications = await request("/api/v1/notifications?limit=10", {
      headers: { authorization: `Bearer ${legalOrdererToken}` },
    });
    assert.ok(ordererNotifications.body.items.some((item: { resourceId: string; type: string }) => item.resourceId === requestId && item.type === "request_status_changed"));

    const unrelated = await request("/api/v1/requests", {
      headers: { authorization: `Bearer ${beautyProviderToken}` },
    });
    assert.equal(unrelated.status, 200);
    assert.ok(unrelated.body.items.every((item: { category: string }) => item.category === "beauty"));
    assert.ok(!unrelated.body.items.some((item: { providerId: string }) => item.providerId === "provider-legal-demo"));
  });

  it("リクルーターは求人に応募でき、応募情報は本人と事業者に限定される", async () => {
    const publicJobs = await request("/api/v1/jobs?category=legal");
    assert.equal(publicJobs.status, 200);
    assert.equal(publicJobs.body.page.limit, 50);
    assert.equal(publicJobs.body.items[0].providerId, "非公開");

    const mcpJobs = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 8,
        method: "tools/call",
        params: { name: "job.search", arguments: { category: "legal", limit: 1 } },
      }),
    });
    assert.equal(mcpJobs.body.result.structuredContent.page.limit, 1);

    const filteredJobs = await request("/api/v1/jobs?category=legal&location=%E6%9D%B1%E4%BA%AC&sort=location_asc&limit=1");
    assert.equal(filteredJobs.status, 200);
    assert.equal(filteredJobs.body.page.limit, 1);
    assert.ok(filteredJobs.body.items.every((item: { location: string }) => item.location.includes("東京")));

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
    assert.equal(providerApplications.body.page.limit, 50);
    assert.equal(providerApplications.body.items[0].jobId, "job-legal-demo");
    const filteredApplications = await request("/api/v1/applications?jobId=job-legal-demo&status=submitted&sort=createdAt_asc&limit=1", {
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
    });
    assert.equal(filteredApplications.status, 200);
    assert.equal(filteredApplications.body.page.limit, 1);
    assert.ok(filteredApplications.body.items.every((item: { status: string }) => item.status === "submitted"));
    const applicationNotifications = await request("/api/v1/notifications?limit=10", {
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
    });
    assert.ok(applicationNotifications.body.items.some((item: { resourceId: string; type: string }) => item.resourceId === application.body.item.id && item.type === "application_received"));
    const screening = await request(`/api/v1/applications/${providerApplications.body.items[0].id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({ status: "screening" }),
    });
    assert.equal(screening.status, 200);
    assert.equal(screening.body.item.status, "screening");
    const candidateNotifications = await request("/api/v1/notifications?limit=10", {
      headers: { authorization: `Bearer ${candidateLogin.body.accessToken}` },
    });
    assert.ok(candidateNotifications.body.items.some((item: { resourceId: string; type: string }) => item.resourceId === providerApplications.body.items[0].id && item.type === "application_status_changed"));

    const mcpApplications = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${providerLogin.body.accessToken}` },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "application.list", arguments: { status: "screening", sort: "status", limit: 1 } },
      }),
    });
    assert.equal(mcpApplications.body.result.structuredContent.page.limit, 1);
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

    const notifications = await request("/api/v1/notifications?limit=10", {
      headers: { authorization: `Bearer ${legalOrdererToken}` },
    });
    assert.equal(notifications.status, 200);
    assert.ok(notifications.body.items.some((item: { resourceId: string; type: string }) => item.resourceId === created.body.item.id && item.type === "inquiry_status_changed"));
    assert.equal(notifications.body.page.limit, 10);
    const unread = notifications.body.items.find((item: { resourceId: string; readAt?: string }) => item.resourceId === created.body.item.id && !item.readAt);
    if (!unread) throw new Error("テスト用未読通知が見つかりません。");
    const marked = await request(`/api/v1/notifications/${unread.id}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ read: true }),
    });
    assert.equal(marked.status, 200);
    assert.ok(marked.body.item.readAt);

    const mcpNotifications = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 21, method: "tools/call", params: { name: "notification.list", arguments: { limit: 1 } } }),
    });
    assert.equal(mcpNotifications.status, 200);
    assert.equal(mcpNotifications.body.result.structuredContent.page.limit, 1);
    const mcpMarked = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${legalOrdererToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 22, method: "tools/call", params: { name: "notification.mark_read", arguments: { notificationId: marked.body.item.id, read: false } } }),
    });
    assert.equal(mcpMarked.status, 200);
    assert.equal(mcpMarked.body.result.structuredContent.readAt, undefined);

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

    const reviewQueue = await request("/api/v1/provider-listing-reviews?category=legal&limit=1", {
      headers: { "x-cms-os-operator-key": "test-operator-key" },
    });
    assert.equal(reviewQueue.status, 200);
    assert.equal(reviewQueue.body.page.limit, 1);
    assert.ok(reviewQueue.body.items.some((item: { id: string; listingStatus: string }) => item.id === "provider-legal-demo" && item.listingStatus === "pending_review"));

    const mcpReviewQueue = await request("/mcp", {
      method: "POST",
      headers: { "x-cms-os-operator-key": "test-operator-key" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 30,
        method: "tools/call",
        params: { name: "provider.listing_review_queue", arguments: { category: "legal", limit: 1 } },
      }),
    });
    assert.equal(mcpReviewQueue.status, 200);
    assert.equal(mcpReviewQueue.body.result.structuredContent.page.limit, 1);

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
