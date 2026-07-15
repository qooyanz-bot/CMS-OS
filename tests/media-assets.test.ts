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

    const assetAudit = await request(`/api/v1/media/${assetId}/seo-audit`, { method: "POST", body: JSON.stringify({}) });
    assert.equal(assetAudit.status, 200);
    assert.equal(assetAudit.body.item.assetId, assetId);
    assert.ok(assetAudit.body.item.score < 100);
    assert.ok(assetAudit.body.item.issues.some((issue: { code: string }) => issue.code === "MEDIA_DIMENSIONS_MISSING"));

    const fetched = await request(`/api/v1/media/${assetId}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.item.lastSeoAudit.assetId, assetId);

    const siteAudit = await request("/api/v1/media/seo-audit", { method: "POST", body: JSON.stringify({}) });
    assert.equal(siteAudit.status, 200);
    assert.ok(siteAudit.body.item.assetCount >= 1);
    assert.ok(siteAudit.body.item.issues.some((issue: { assetId?: string }) => issue.assetId === assetId));

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

    const siteAudit = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "media.seo_audit", arguments: {} } }),
    });
    assert.equal(siteAudit.status, 200);
    assert.ok(siteAudit.body.result.structuredContent.assetCount >= 1);
    const assetId = registered.body.result.structuredContent.id as string;
    const assetAudit = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "media.asset_seo_audit", arguments: { assetId } } }),
    });
    assert.equal(assetAudit.status, 200);
    assert.equal(assetAudit.body.result.structuredContent.assetId, assetId);
  });

  it("RESTとMCPのコンテンツ操作へメディアIDを渡せる", async () => {
    const asset = await request("/api/v1/media", {
      method: "POST",
      body: JSON.stringify({
        category: "legal",
        name: "コンテンツ関連付け用画像",
        storageKey: "legal/content-reference.webp",
        publicUrl: "https://cdn.example.com/legal/content-reference.webp",
        mediaType: "image",
        mimeType: "image/webp",
        sizeBytes: 9000,
        altText: "法律相談の記事に関連する案内画像",
        status: "published",
        rightsStatus: "owned",
      }),
    });
    assert.equal(asset.status, 201);
    const assetId = asset.body.item.id as string;

    const proposal = await request("/api/v1/content/proposals", {
      method: "POST",
      body: JSON.stringify({ category: "legal", contentType: "blog", audience: "customer", topic: "メディア付き相談案内", mediaIds: [assetId] }),
    });
    assert.equal(proposal.status, 201);
    assert.deepEqual(proposal.body.item.mediaIds, [assetId]);

    const mcpProposal = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "content.propose", arguments: { category: "legal", contentType: "blog", audience: "customer", topic: "MCPメディア付き案内", mediaIds: [assetId] } } }),
    });
    assert.equal(mcpProposal.status, 200);
    assert.deepEqual(mcpProposal.body.result.structuredContent.mediaIds, [assetId]);

    const created = await request("/api/v1/content", {
      method: "POST",
      body: JSON.stringify({
        category: "legal",
        contentType: "blog",
        audience: "customer",
        mediaIds: [assetId],
        title: "メディア付き法律相談案内",
        summary: "メディアを関連付けた法律相談の案内です。",
        body: "# メディア付き法律相談案内\n\n相談前に確認できる情報を整理します。",
        sourceFacts: ["事業者が確認した案内情報です。"],
      }),
    });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.item.mediaIds, [assetId]);

    const cleared = await request(`/api/v1/content/${created.body.item.id}`, {
      method: "PATCH",
      body: JSON.stringify({ mediaIds: [] }),
    });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.body.item.mediaIds, []);
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
    const audit = { assetId: item.id, category: item.category, providerId: item.providerId, score: 90, issues: [{ code: "MEDIA_TEST", severity: "info" as const, field: "title", message: "テスト", recommendation: "テスト" }], auditedAt: new Date().toISOString() };
    const auditIssue = audit.issues[0];
    if (!auditIssue) throw new Error("テスト用監査項目がありません。");
    first.saveSeoAudit(item.id, audit);
    first.saveSiteSeoAudit({ category: item.category, providerId: item.providerId, assetCount: 1, score: 90, issues: [{ ...auditIssue, assetId: item.id }], auditedAt: audit.auditedAt });
    const second = new MediaStore(stateStore);
    assert.equal(second.getAsset(item.id)?.storageKey, "beauty/a.jpg");
    assert.equal(second.getAsset(item.id)?.lastSeoAudit?.score, 90);
    assert.equal(second.getLatestSiteSeoAudit(item.category, item.providerId)?.score, 90);
  });
});
