import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import { InMemoryAuthService } from "../src/domain/auth.js";
import { PortalService } from "../src/application/portal-service.js";
import { createHttpServer } from "../src/api/http-server.js";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
let server: Server;
let baseUrl: string;

before(async () => {
  const auth = new InMemoryAuthService(undefined, {
    authEncryptionKey: "test-encryption-key-32-characters-long",
  });
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

function decodeBase32(value: string): Buffer {
  let buffer = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/=+$/, "").toUpperCase()) {
    const digit = base32Alphabet.indexOf(character);
    if (digit < 0) throw new Error("テスト用TOTP秘密鍵が不正です。");
    buffer = (buffer << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totpCode(secret: string, timestamp = Date.now()): string {
  const counter = BigInt(Math.floor(timestamp / 1000 / 30));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary =
    (((digest[offset] ?? 0) & 0x7f) << 24) |
    ((digest[offset + 1] ?? 0) << 16) |
    ((digest[offset + 2] ?? 0) << 8) |
    (digest[offset + 3] ?? 0);
  return String(binary % 1_000_000).padStart(6, "0");
}

describe("認証REST APIとMCP", () => {
  it("REST APIで利用可能な認証方式を取得できる", async () => {
    const response = await request("/api/v1/auth/config");
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.item, { passwordLogin: true, oidcLogin: false, mfaEnrollment: true });
  });

  it("全テーマカテゴリの事業者デモアカウントでカテゴリ別ログインできる", async () => {
    const providerAccounts = [
      ["ai-business", "ai-business@example.com"],
      ["labor-shortage", "labor-shortage@example.com"],
      ["tourism", "tourism@example.com"],
      ["mobility-dx", "mobility-dx@example.com"],
      ["gx", "gx@example.com"],
      ["regional-revitalization", "regional@example.com"],
    ];
    for (const [category, email] of providerAccounts) {
      const response = await request("/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: "demo-password", category, role: "provider" }),
      });
      assert.equal(response.status, 200, `${category}の事業者ログインに失敗しました。`);
      assert.equal(response.body.principal.category, category);
      assert.equal(response.body.principal.role, "provider");
    }
  });

  it("REST APIでTOTP MFAの登録・確認・ログインチャレンジを完了できる", async () => {
    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "demo-password", category: "legal", role: "user" }),
    });
    assert.equal(login.status, 200);
    assert.equal(typeof login.body.accessToken, "string");

    const enroll = await request("/api/v1/auth/mfa/enroll", {
      method: "POST",
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });
    assert.equal(enroll.status, 200);
    assert.equal(typeof enroll.body.item.secret, "string");

    const confirm = await request("/api/v1/auth/mfa/confirm", {
      method: "POST",
      headers: { authorization: `Bearer ${login.body.accessToken}` },
      body: JSON.stringify({ code: totpCode(enroll.body.item.secret) }),
    });
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.item.enabled, true);

    await request("/api/v1/auth/logout", {
      method: "POST",
      headers: { authorization: `Bearer ${login.body.accessToken}` },
    });

    const challenged = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com", password: "demo-password", category: "legal", role: "user" }),
    });
    assert.equal(challenged.status, 200);
    assert.equal(challenged.body.mfaRequired, true);

    const completed = await request("/api/v1/auth/mfa/complete", {
      method: "POST",
      body: JSON.stringify({
        challengeToken: challenged.body.mfaChallengeToken,
        code: totpCode(enroll.body.item.secret),
      }),
    });
    assert.equal(completed.status, 200);
    assert.equal(typeof completed.body.accessToken, "string");
  });

  it("MCP tools/listに認証操作を公開する", async () => {
    const response = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    assert.equal(response.status, 200);
    const names = response.body.result.tools.map((tool: { name: string }) => tool.name);
    assert.deepEqual(names.filter((name: string) => name.startsWith("auth.")), [
      "auth.login",
      "auth.me",
      "auth.logout",
      "auth.config",
      "auth.switch_context",
      "auth.oidc_start",
      "auth.oidc_callback",
      "auth.mfa_enroll",
      "auth.mfa_confirm",
      "auth.mfa_complete",
    ]);
  });

  it("MCPからログイン・本人情報取得・ログアウトを実行できる", async () => {
    const login = await request("/mcp", {
      method: "POST",
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "auth.login",
          arguments: { email: "orderer@example.com", password: "demo-password", category: "legal", role: "orderer" },
        },
      }),
    });
    assert.equal(login.status, 200);
    const loginResult = login.body.result.structuredContent;
    assert.equal(typeof loginResult.accessToken, "string");

    const me = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${loginResult.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "auth.me", arguments: {} } }),
    });
    assert.equal(me.status, 200);
    assert.equal(me.body.result.structuredContent.principal.role, "orderer");

    const logout = await request("/mcp", {
      method: "POST",
      headers: { authorization: `Bearer ${loginResult.accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "auth.logout", arguments: {} } }),
    });
    assert.equal(logout.status, 200);
    assert.equal(logout.body.result.structuredContent.ok, true);
  });
});
