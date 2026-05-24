export interface RateLimitConfig {
  maxActionsPerWindow: number;
  windowMs: number;
  maxObservePerWindow: number;
}

export const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  maxActionsPerWindow: 30,
  windowMs: 60_000,
  maxObservePerWindow: 60,
};

interface RateBucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private config: RateLimitConfig;
  private actionBuckets: Map<string, RateBucket> = new Map();
  private observeBuckets: Map<string, RateBucket> = new Map();

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.config = { ...DEFAULT_RATE_LIMIT_CONFIG, ...config };
  }

  check(citizenId: string, action: string): { allowed: boolean; retryAfterMs: number } {
    if (action === "observe" || action === "look_at") {
      return this.checkBucket(this.observeBuckets, citizenId, this.config.maxObservePerWindow);
    }
    return this.checkBucket(this.actionBuckets, citizenId, this.config.maxActionsPerWindow);
  }

  private checkBucket(buckets: Map<string, RateBucket>, key: string, max: number): { allowed: boolean; retryAfterMs: number } {
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + this.config.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      return { allowed: false, retryAfterMs: bucket.resetAt - now };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(citizenId: string): void {
    this.actionBuckets.delete(citizenId);
    this.observeBuckets.delete(citizenId);
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, bucket] of this.actionBuckets) {
      if (now >= bucket.resetAt) this.actionBuckets.delete(key);
    }
    for (const [key, bucket] of this.observeBuckets) {
      if (now >= bucket.resetAt) this.observeBuckets.delete(key);
    }
  }
}
