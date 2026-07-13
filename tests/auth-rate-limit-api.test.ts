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
  server = createHttpServer(auth, new PortalService(auth));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("テストサーバーのポートを取得できません。");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

it("RESTログインを短時間に繰り返すと429で制限する", async () => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "attacker@example.com", password: "wrong-password", category: "legal", role: "user" }),
    });
    assert.equal(response.status, 401);
  }

  const blocked = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "attacker@example.com", password: "wrong-password", category: "legal", role: "user" }),
  });
  const body = await blocked.json() as { retryAfterSeconds?: number };
  assert.equal(blocked.status, 429);
  assert.equal(typeof body.retryAfterSeconds, "number");
  assert.ok(blocked.headers.get("retry-after"));
});
