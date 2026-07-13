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
  });
});
