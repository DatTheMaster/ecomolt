export interface RateLimiterConfig {
  rpm: number;
  burst: number;
}

export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  rpm: 40,
  burst: 10,
};

export class RateLimiter {
  private tokens: number;
  private maxTokens: number;
  private refillRate: number;
  private lastRefill: number;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    const rpm = config.rpm ?? DEFAULT_RATE_LIMITER_CONFIG.rpm;
    this.maxTokens = config.burst ?? DEFAULT_RATE_LIMITER_CONFIG.burst;
    this.tokens = this.maxTokens;
    this.refillRate = rpm / 60;
    this.lastRefill = Date.now();
  }

  refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }

  tryConsume(): { allowed: boolean; retryAfterMs: number } {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true, retryAfterMs: 0 };
    }
    const deficit = 1 - this.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillRate) * 1000);
    return { allowed: false, retryAfterMs };
  }

  async waitForToken(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const { allowed, retryAfterMs } = this.tryConsume();
      if (allowed) return;
      await safeSleep(Math.min(retryAfterMs, 5000), signal);
    }
    throw new Error("Aborted while waiting for rate limit token");
  }
}

/**
 * Registry of per-provider rate limiters, keyed by apiBase+apiKey.
 * This prevents agents on different providers from throttling each other.
 */
export class RateLimiterRegistry {
  private limiters = new Map<string, RateLimiter>();

  /** Get or create a rate limiter for a given provider key and RPM. */
  get(apiBase: string, apiKey: string, rpm: number): RateLimiter {
    const key = `${apiBase}::${apiKey.slice(0, 8)}`;
    let limiter = this.limiters.get(key);
    if (!limiter) {
      limiter = new RateLimiter({ rpm, burst: Math.min(rpm / 6, 10) });
      this.limiters.set(key, limiter);
    }
    return limiter;
  }

  /** List all registered limiters (for debugging). */
  list(): Array<{ key: string; rpm: number }> {
    return [...this.limiters.entries()].map(([key, lim]) => ({
      key,
      rpm: Math.round(lim["refillRate"] * 60), // eslint-disable-line
    }));
  }
}

/**
 * Sleep that properly cleans up abort listeners to prevent EventTarget memory leaks.
 */
export function safeSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("Aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
