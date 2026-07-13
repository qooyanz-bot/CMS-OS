import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";
import { MediaStore } from "../src/domain/media-store.js";
import type { StateStore } from "../src/infrastructure/json-state-store.js";

let server: Server;
let baseUrl: string;
let token: string;

before(async () => {
  const auth = new InMemoryAuthService();
  const portal = new PortalService(auth);
  server = createHttpServer(auth, portal);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("テストサーバーのポートを取得できません。");
  baseUrl = `http://127.0.0.1:${address.port}`;
  const login = await request("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
  });
  assert.equal(login.status, 200);
  token = login.body.accessToken;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl ?? "http://127.0.0.1"}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
}

describe("CMS-OSメディアアセット", () => {
  it("RESTで登録・検索・変換・更新・アーカイブを行える", async () => {
    const created = await request("/api/v1/media", {
      method: "POST",
      body: JSON.stringify({
        category: "legal",
        name: "事務所トップ画像",
        storageKey: "providers/legal/hero.jpg",
        publicUrl: "https://cdn.example.com/legal/hero.jpg",
        mediaType: "image",
        mimeType: "image/jpeg",
        sizeBytes: 120000,
        altText: "法律相談を受ける事務所スタッフ",
        tags: ["hero", "office"],
        rightsStatus: "owned",
        status: "published",
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.item.mediaType, "image");
    assert.equal(created.body.item.status, "published");

    const assetId = created.body.item.id as string;
    const listed = await request("/api/v1/media?mediaType=image&rightsStatus=owned&limit=1");
    assert.equal(listed.status, 200);
    assert.equal(listed.body.items[0].id, assetId);

    const transformed = await request(`/api/v1/media/${assetId}/transform`, {
      method: "POST",
      body: JSON.stringify({ format: "webp", width: 1200, quality: 80 }),
    });
    assert.equal(transformed.status, 201);
    assert.equal(transformed.body.item.derivedFromAssetId, assetId);
    assert.equal(transformed.body.item.mimeType, "image/webp");
    assert.equal(transformed.body.item.transform.width, 1200);

    const updated = await request(`/api/v1/media/${assetId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "法律相談の事務所案内", altText: "更新済みの画像説明" }),
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.item.title, "法律相談の事務所案内");

    const archived = await request(`/api/v1/media/${assetId}`, { method: "DELETE" });
    assert.equal(archived.status, 200);
    assert.equal(archived.body.item.status, "archived");
  });

  it("画像のaltTextを必須にし、別ロールからの管理を拒否する", async () => {
    const invalid = await request("/api/v1/media", {
      method: "POST",
      body: JSON.stringify({ category: "legal", name: "altなし", storageKey: "invalid.jpg", mediaType: "image", mimeType: "image/jpeg", sizeBytes: 10, altText: "" }),
    });
    assert.equal(invalid.status, 400);

    const logout = await request("/api/v1/auth/logout", { method: "POST" });
    assert.equal(logout.status, 200);
    const ordererLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "orderer@example.com", password: "demo-password", category: "legal", role: "orderer" }),
    });
    assert.equal(ordererLogin.status, 200);
    token = ordererLogin.body.accessToken;
    const denied = await request("/api/v1/media");
    assert.equal(denied.status, 403);
  });

  it("MCPから登録と一覧取得を実行できる", async () => {
    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "lawyer@example.com", password: "demo-password", category: "legal", role: "provider" }),
    });
    assert.equal(login.status, 200);
    token = login.body.accessToken;
    const registered = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "media.register", arguments: { category: "legal", name: "MCP PDF", storageKey: "legal/guide.pdf", mediaType: "pdf", mimeType: "application/pdf", sizeBytes: 5000, altText: "法律相談ガイドPDF", status: "draft" } } }),
    });
    assert.equal(registered.status, 200);
    assert.equal(registered.body.result.structuredContent.mediaType, "pdf");

    const listed = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "media.list", arguments: { mediaType: "pdf" } } }),
    });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.result.structuredContent.items.some((item: { name: string }) => item.name === "MCP PDF"));
  });
});

describe("MediaStore永続化", () => {
  it("portal-media-assets.jsonの状態を再ロードできる", () => {
    const values = new Map<string, unknown>();
    const stateStore: StateStore = {
      load<T>(name: string, fallback: T): T { return (values.get(name) as T | undefined) ?? fallback; },
      save<T>(name: string, value: T): void { values.set(name, value); },
    };
    const first = new MediaStore(stateStore);
    const item = first.createAsset({ category: "beauty", providerId: "provider-beauty-demo", name: "画像", storageKey: "beauty/a.jpg", mediaType: "image", mimeType: "image/jpeg", sizeBytes: 100, altText: "画像", title: "画像", tags: [], rightsStatus: "owned", status: "draft" });
    const second = new MediaStore(stateStore);
    assert.equal(second.getAsset(item.id)?.storageKey, "beauty/a.jpg");
  });
});
