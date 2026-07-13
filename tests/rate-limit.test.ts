import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixedWindowRateLimiter } from "../src/security/rate-limit.js";

describe("認証レート制限", () => {
  it("上限到達後は拒否し、期間終了後に再開できる", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);
    assert.equal(limiter.consume("client", 0).allowed, true);
    assert.equal(limiter.consume("client", 100).allowed, true);
    const blocked = limiter.consume("client", 200);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterSeconds, 1);
    assert.equal(limiter.consume("client", 1_000).allowed, true);
  });
});
