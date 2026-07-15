import assert from "node:assert/strict";
import { after, before, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";
import type { CategorySlug } from "../src/domain/types.js";

const categories: CategorySlug[] = [
  "legal",
  "beauty",
  "ai-business",
  "labor-shortage",
  "tourism",
  "mobility-dx",
  "gx",
  "regional-revitalization",
];

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

it("全カテゴリにリクルーターが確認できる初期求人を提供する", async () => {
  const login = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "candidate@example.com", password: "demo-password", category: "legal", role: "recruiter" }),
  });
  assert.equal(login.status, 200);
  const token = login.body.accessToken as string;

  for (const category of categories) {
    const context = await request("/api/v1/auth/context", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ category, role: "recruiter" }),
    });
    assert.equal(context.status, 200, `${category}のリクルーター文脈を切り替えられません。`);

    const jobs = await request(`/api/v1/jobs?category=${encodeURIComponent(category)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(jobs.status, 200, `${category}の求人一覧を取得できません。`);
    assert.ok(jobs.body.items.some((job: { category: string; status: string }) => job.category === category && job.status === "published"), `${category}の公開求人がありません。`);
  }
});
