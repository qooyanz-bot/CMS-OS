import assert from "node:assert/strict";
import { after, before, it } from "node:test";
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

it("ログイン前にカテゴリ別の対象ロールと表示モジュールを取得できる", async () => {
  const response = await fetch(`${baseUrl}/api/v1/auth/login-options`);
  const body = await response.json() as { items: Array<{ category: string; roles: Array<{ role: string; visibleModules: string[] }> }> };

  assert.equal(response.status, 200);
  assert.equal(body.items.length, 8);

  const legal = body.items.find((item) => item.category === "legal");
  const beauty = body.items.find((item) => item.category === "beauty");
  const aiBusiness = body.items.find((item) => item.category === "ai-business");
  assert.ok(legal && beauty && aiBusiness);
  assert.deepEqual(legal.roles.map((role) => role.role), ["user", "orderer", "provider", "recruiter"]);

  const legalOrderer = legal.roles.find((role) => role.role === "orderer");
  const beautyOrderer = beauty.roles.find((role) => role.role === "orderer");
  const aiUser = aiBusiness.roles.find((role) => role.role === "user");
  const aiProvider = aiBusiness.roles.find((role) => role.role === "provider");
  assert.ok(legalOrderer && beautyOrderer && aiUser && aiProvider);
  assert.ok(legalOrderer.visibleModules.includes("requestCase"));
  assert.ok(beautyOrderer.visibleModules.includes("booking"));
  assert.ok(aiUser.visibleModules.includes("aiUseCases"));
  assert.ok(aiProvider.visibleModules.includes("aiSolutionManagement"));
  assert.notDeepEqual(legalOrderer.visibleModules, beautyOrderer.visibleModules);

  const mcp = await fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "auth.login_options", arguments: {} } }),
  });
  const mcpBody = await mcp.json() as { result: { structuredContent: { items: unknown[] } } };
  assert.equal(mcp.status, 200);
  assert.equal(mcpBody.result.structuredContent.items.length, body.items.length);
});
