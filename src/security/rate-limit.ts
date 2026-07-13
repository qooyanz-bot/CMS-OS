export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitBucket {
  startedAt: number;
  count: number;
}

/** 認証エンドポイント用の固定ウィンドウレート制限。 */
export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, RateLimitBucket>();

  public constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("レート制限値は正の整数で指定してください。");
    if (!Number.isInteger(windowMs) || windowMs <= 0) throw new Error("レート制限期間は正の整数で指定してください。");
  }

  public consume(key: string, now = Date.now()): RateLimitResult {
    const current = this.buckets.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.buckets.set(key, { startedAt: now, count: 1 });
      this.prune(now);
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.startedAt + this.windowMs - now) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number): void {
    if (this.buckets.size < 256) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.startedAt >= this.windowMs) this.buckets.delete(key);
    }
  }
}
