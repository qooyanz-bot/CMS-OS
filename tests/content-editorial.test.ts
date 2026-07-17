import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { createHttpServer } from "../src/api/http-server.js";
import { ContentService } from "../src/application/content-service.js";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";

let server: Server;
let baseUrl: string;
let token: string;
let contentId: string;

before(async () => {
  const auth = new InMemoryAuthService();
  const portal = new PortalService(auth);
  const content = new ContentService(portal);
  const login = auth.login("lawyer@example.com", "demo-password", "legal", "provider");
  if (!login || !("accessToken" in login)) throw new Error("編集履歴テスト用ログインに失敗しました。");
  token = login.accessToken;
  const created = content.createContent(login.principal, {
    category: "legal",
    contentType: "ir",
    audience: "investor",
    title: "公開IRのお知らせ",
    summary: "公開済みIRの訂正と撤回履歴を検証します。",
    body: "# 公開IRのお知らせ\n\n確認済みの一次情報をもとにした公開本文です。",
    sourceFacts: ["確認済みのIR一次情報"],
  });
  content.auditSeo(login.principal, created.id);
  content.factCheck(login.principal, created.id);
  content.approveContent(login.principal, created.id);
  content.markPublished(login.principal, created.id);
  contentId = created.id;

  server = createHttpServer(auth, portal, content);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("編集履歴テスト用ポートを取得できません。");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

async function request(path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  return { status: response.status, body: await response.json() };
}

describe("CMS-OS公開コンテンツの訂正・撤回履歴", () => {
  it("公開済みIRを上書きせず訂正前後と撤回をREST/MCPで確認できる", async () => {
    const correction = await request(`/api/v1/content/${contentId}/correction`, {
      method: "POST",
      body: JSON.stringify({
        reason: "数値の訂正",
        body: "# 訂正版IR\n\n訂正後の本文です。",
        structuredData: { type: "ir", publicationDate: "2026-07-16", documentType: "notice", fiscalPeriod: "2026年3月期" },
        sourceEvidence: [{ title: "訂正版IR資料", url: "https://example.com/ir/correction.pdf", checkedAt: "2026-07-16" }],
      }),
    });
    assert.equal(correction.status, 201);
    assert.equal(correction.body.item.kind, "correction");
    assert.match(correction.body.item.beforeBody, /公開本文/);
    assert.match(correction.body.item.afterBody, /訂正後/);
    assert.equal(correction.body.item.afterStructuredData.documentType, "notice");
    assert.equal(correction.body.item.afterSourceEvidence[0].title, "訂正版IR資料");

    const actions = await request(`/api/v1/content/${contentId}/editorial-actions`);
    assert.equal(actions.status, 200);
    assert.equal(actions.body.items.length, 1);

    const withdrawal = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 41,
        method: "tools/call",
        params: { name: "content.withdrawal", arguments: { contentId, reason: "掲載を撤回します" } },
      }),
    });
    assert.equal(withdrawal.status, 200);
    assert.equal(withdrawal.body.result.structuredContent.action.kind, "withdrawal");
    assert.equal(withdrawal.body.result.structuredContent.content.status, "archived");

    const history = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: { name: "content.editorial_actions", arguments: { contentId } },
      }),
    });
    assert.deepEqual(history.body.result.structuredContent.items.map((item: { kind: string }) => item.kind), ["withdrawal", "correction"]);
  });
});
