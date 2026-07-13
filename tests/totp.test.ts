import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTotpUri, generateTotpSecret, verifyTotp } from "../src/security/totp.js";

describe("CMS-OS TOTP MFA", () => {
  it("RFC 6238のSHA-1ベクトルを検証できる", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    assert.equal(verifyTotp(secret, "287082", 59_000, 0), true);
    assert.equal(verifyTotp(secret, "287083", 59_000, 0), false);
  });

  it("登録用シークレットとotpauth URIを生成できる", () => {
    const secret = generateTotpSecret();
    const uri = createTotpUri(secret, "CMS-OS", "user@example.com");
    assert.match(secret, /^[A-Z2-7]+$/);
    assert.match(uri, /^otpauth:\/\/totp\//);
    assert.match(uri, /issuer=CMS-OS/);
  });
});
