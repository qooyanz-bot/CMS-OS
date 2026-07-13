import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { authOptionsFromEnvironment, AuthServiceError, InMemoryAuthService } from "../src/domain/auth.js";
import type { StateStore } from "../src/infrastructure/json-state-store.js";

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 255);
      buffer &= bits === 0 ? 0 : (1 << bits) - 1;
    }
  }
  return Buffer.from(output);
}

function currentTotpCode(secret: string, now = Date.now()): string {
  const counter = BigInt(Math.floor(now / 30_000));
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

describe("CMS-OS認証セキュリティ", () => {
  it("TOTP MFAの登録、チャレンジ、セッション発行を実行できる", () => {
    const auth = new InMemoryAuthService(undefined, { authEncryptionKey: "test-encryption-key-32-characters-long" });
    const initial = auth.login("orderer@example.com", "demo-password", "legal", "orderer");
    if (!initial || !("accessToken" in initial)) throw new Error("初回ログインに失敗しました。");

    const enrollment = auth.enrollMfa(initial.accessToken);
    assert.match(enrollment.otpauthUrl, /^otpauth:\/\/totp\//);
    assert.deepEqual(auth.confirmMfaEnrollment(initial.accessToken, currentTotpCode(enrollment.secret)), { enabled: true });

    auth.logout(initial.accessToken);
    const challenged = auth.login("orderer@example.com", "demo-password", "legal", "orderer");
    if (!challenged || !("mfaRequired" in challenged)) throw new Error("MFAチャレンジが発行されませんでした。");
    const completed = auth.completeMfa(challenged.mfaChallengeToken, currentTotpCode(enrollment.secret));
    if (!("accessToken" in completed)) throw new Error("MFA完了後のセッションが発行されませんでした。");
    assert.equal(auth.authenticate(completed.accessToken)?.accountId, "account-orderer-demo");
  });

  it("OIDC Authorization Code + PKCEを検証して自動プロビジョニングできる", async () => {
    const calls: string[] = [];
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/.well-known/openid-configuration")) {
        return new Response(JSON.stringify({
          issuer: "https://id.example.com",
          authorization_endpoint: "https://id.example.com/authorize",
          token_endpoint: "https://id.example.com/token",
          userinfo_endpoint: "https://id.example.com/userinfo",
        }), { status: 200 });
      }
      if (url.endsWith("/token")) {
        return new Response(JSON.stringify({ access_token: "provider-access-token" }), { status: 200 });
      }
      if (url.endsWith("/userinfo")) {
        return new Response(JSON.stringify({ sub: "oidc-user-1", email: "oidc@example.com", email_verified: true, name: "OIDC User" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 404 });
    };
    const auth = new InMemoryAuthService(undefined, {
      allowDemoAccounts: false,
      allowPasswordLogin: false,
      oidc: {
        issuer: "https://id.example.com",
        clientId: "cms-os-client",
        redirectUri: "https://cms.example.com/api/v1/auth/oidc/callback",
        autoProvisionUsers: true,
      },
      fetchImplementation,
    });

    const started = await auth.startOidc("legal", "user");
    const authorizationUrl = new URL(started.authorizationUrl);
    assert.equal(authorizationUrl.searchParams.get("state"), started.state);
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    const completed = await auth.completeOidc(started.state, "authorization-code");
    if (!("accessToken" in completed)) throw new Error("OIDCログイン後のセッションが発行されませんでした。");
    assert.equal(completed.principal.email, "oidc@example.com");
    assert.equal(auth.authenticate(completed.accessToken)?.displayName, "OIDC User");
    assert.equal(calls.length, 3);
    await assert.rejects(() => auth.completeOidc(started.state, "authorization-code"), (error: unknown) => error instanceof AuthServiceError && error.statusCode === 400);
  });

  it("本番想定の設定ではデモパスワードを受け付けない", () => {
    const auth = new InMemoryAuthService(undefined, { allowDemoAccounts: false, allowPasswordLogin: false });
    assert.equal(auth.login("user@example.com", "demo-password", "legal", "user"), null);
  });

  it("本番環境の既定値はOIDCで、設定不足を起動前に検出する", () => {
    assert.throws(() => authOptionsFromEnvironment({ NODE_ENV: "production" }), /OIDC/);
    const options = authOptionsFromEnvironment({
      NODE_ENV: "production",
      CMS_OS_OIDC_ISSUER: "https://id.example.com",
      CMS_OS_OIDC_CLIENT_ID: "cms-os-client",
      CMS_OS_OIDC_REDIRECT_URI: "https://cms.example.com/api/v1/auth/oidc/callback",
    });
    assert.equal(options.allowPasswordLogin, false);
    assert.equal(options.allowDemoAccounts, false);
    assert.equal(options.oidc?.issuer, "https://id.example.com");
  });

  it("認証監査ログに成否だけを永続化し、秘密情報を含めない", () => {
    const values = new Map<string, unknown>();
    const stateStore: StateStore = {
      load<T>(name: string, fallback: T): T {
        return (values.get(name) as T | undefined) ?? fallback;
      },
      save<T>(name: string, value: T): void {
        values.set(name, value);
      },
    };
    const auth = new InMemoryAuthService(stateStore);
    auth.login("unknown@example.com", "wrong-password", "legal", "user");
    const successful = auth.login("user@example.com", "demo-password", "legal", "user");
    if (!successful || !("accessToken" in successful)) throw new Error("監査ログ用のログインに失敗しました。");

    const events = values.get("auth-audit-log.json") as Array<Record<string, unknown>> | undefined;
    assert.ok(events);
    assert.equal(events.some((event) => event.type === "auth.login" && event.outcome === "failure"), true);
    assert.equal(events.some((event) => event.type === "auth.login" && event.outcome === "success"), true);
    assert.equal(JSON.stringify(events).includes("wrong-password"), false);
    assert.equal(JSON.stringify(events).includes("demo-password"), false);
  });
});
