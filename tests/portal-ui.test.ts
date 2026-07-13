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

it("CMS-OS Portalの静的UIを配信する", async () => {
  const html = await fetch(`${baseUrl}/`);
  const body = await html.text();
  assert.equal(html.status, 200);
  assert.match(body, /CMS-OS Portal/);
  assert.match(body, /content-editor-panel/);
  assert.match(body, /provider-management-panel/);
  assert.match(body, /job-management-panel/);
  assert.match(body, /request-inbox-panel/);
  assert.match(body, /application-panel/);
  assert.match(body, /inquiry-panel/);
  assert.match(body, /inquiry-management-panel/);
  assert.match(body, /listing-submit-button/);
  assert.match(body, /login-form/);
  assert.match(body, /mfa-panel/);

  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(script.status, 200);
  const scriptBody = await script.text();
  assert.match(scriptBody, /category-select/);
  assert.match(scriptBody, /api\/v1\/auth\/config/);
  assert.match(scriptBody, /api\/v1\/auth\/oidc\/start/);
  assert.match(scriptBody, /api\/v1\/auth\/mfa\/complete/);
  assert.match(scriptBody, /api\/v1\/content\/proposals/);
  assert.match(scriptBody, /api\/v1\/publications\/build/);
  assert.match(scriptBody, /api\/v1\/providers\//);
  assert.match(scriptBody, /api\/v1\/jobs/);
  assert.match(scriptBody, /job-status-button/);
  assert.match(scriptBody, /api\/v1\/requests/);
  assert.match(scriptBody, /api\/v1\/applications/);
  assert.match(scriptBody, /api\/v1\/inquiries/);
  assert.match(scriptBody, /listing-submission/);
  assert.match(scriptBody, /role-status-button/);
});
