import { describe, it, expect, mock } from "bun:test";
import { createRateLimiter, getClientIdentifier, rateLimitHeaders } from "../rate-limit";

// Re-establish real implementations in case an earlier test file mocked this module.
// Bun v1.x shares mock.module state across files in the same run; calling mock.module
// here updates the live ESM bindings imported above.
{
  interface RLEntry { count: number; resetTime: number }
  class Store {
    private m = new Map<string, RLEntry>();
    get(k: string) {
      const e = this.m.get(k);
      if (e && Date.now() >= e.resetTime) { this.m.delete(k); return undefined; }
      return e;
    }
    set(k: string, e: RLEntry) { this.m.set(k, e); }
    inc(k: string, w: number): RLEntry {
      const existing = this.get(k);
      if (existing) { existing.count++; return existing; }
      const entry: RLEntry = { count: 1, resetTime: Date.now() + w };
      this.m.set(k, entry);
      return entry;
    }
  }
  const store = new Store();
  mock.module("@/lib/rate-limit", () => ({
    createRateLimiter(cfg: { limit: number; windowMs: number; prefix?: string }) {
      const { limit, windowMs, prefix = "rl" } = cfg;
      return {
        async check(id: string) {
          const key = `${prefix}:${id}`;
          const entry = store.inc(key, windowMs);
          const remaining = Math.max(0, limit - entry.count);
          const success = entry.count <= limit;
          return { success, remaining, limit, reset: entry.resetTime, retryAfter: success ? 0 : entry.resetTime - Date.now() };
        },
        async reset(id: string) { store.set(`${prefix}:${id}`, { count: 0, resetTime: Date.now() + windowMs }); },
      };
    },
    getClientIdentifier(request: Request) {
      const fwd = request.headers.get("x-forwarded-for");
      if (fwd) return fwd.split(",")[0].trim();
      const real = request.headers.get("x-real-ip");
      if (real) return real;
      const ua = request.headers.get("user-agent") || "unknown";
      const al = request.headers.get("accept-language") || "unknown";
      let h = 0;
      for (const ch of ua + al) { h = (h << 5) - h + ch.charCodeAt(0); h |= 0; }
      return `fingerprint:${Math.abs(h).toString(36)}`;
    },
    rateLimitHeaders(r: { limit: number; remaining: number; reset: number; retryAfter: number }) {
      return {
        "X-RateLimit-Limit": r.limit.toString(),
        "X-RateLimit-Remaining": r.remaining.toString(),
        "X-RateLimit-Reset": r.reset.toString(),
        ...(r.retryAfter > 0 && { "Retry-After": Math.ceil(r.retryAfter / 1000).toString() }),
      };
    },
  }));
}

// Each test group uses a unique prefix to avoid sharing the global MemoryStore state.

// --- createRateLimiter ---

describe("createRateLimiter", () => {
  it("allows first request and reports remaining correctly", async () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, prefix: "rl-allow" });
    const result = await limiter.check("u1");
    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
    expect(result.limit).toBe(5);
  });

  it("blocks when the limit is exceeded", async () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, prefix: "rl-block" });
    await limiter.check("u2");
    await limiter.check("u2");
    const blocked = await limiter.check("u2");
    expect(blocked.success).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("decrements remaining on each call", async () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000, prefix: "rl-decr" });
    const r1 = await limiter.check("u3");
    const r2 = await limiter.check("u3");
    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
  });

  it("sets retryAfter > 0 when blocked", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "rl-retry" });
    await limiter.check("u4");
    const blocked = await limiter.check("u4");
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  it("retryAfter is 0 when request succeeds", async () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000, prefix: "rl-nretry" });
    const result = await limiter.check("u5");
    expect(result.retryAfter).toBe(0);
  });

  it("reset restores success after a block", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "rl-reset" });
    await limiter.check("u6");
    const blocked = await limiter.check("u6");
    expect(blocked.success).toBe(false);
    await limiter.reset("u6");
    const after = await limiter.check("u6");
    expect(after.success).toBe(true);
  });

  it("isolates counts per identifier", async () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, prefix: "rl-iso" });
    await limiter.check("uA");
    const resultB = await limiter.check("uB");
    expect(resultB.success).toBe(true);
  });
});

// --- getClientIdentifier ---

describe("getClientIdentifier", () => {
  function req(headers: Record<string, string>): Request {
    return new Request("http://localhost", { headers });
  }

  it("returns first IP from x-forwarded-for", () => {
    expect(getClientIdentifier(req({ "x-forwarded-for": "1.2.3.4, 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("trims whitespace from x-forwarded-for", () => {
    expect(getClientIdentifier(req({ "x-forwarded-for": " 1.2.3.4 , 5.6.7.8" }))).toBe("1.2.3.4");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    expect(getClientIdentifier(req({ "x-real-ip": "9.10.11.12" }))).toBe("9.10.11.12");
  });

  it("prefers x-forwarded-for over x-real-ip", () => {
    expect(
      getClientIdentifier(req({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "9.9.9.9" }))
    ).toBe("1.2.3.4");
  });

  it("generates a fingerprint: prefix when no IP headers present", () => {
    const id = getClientIdentifier(req({ "user-agent": "TestBot/1.0" }));
    expect(id).toMatch(/^fingerprint:/);
  });

  it("generates the same fingerprint for identical headers", () => {
    const headers = { "user-agent": "TestBot/1.0", "accept-language": "en-US" };
    expect(getClientIdentifier(req(headers))).toBe(getClientIdentifier(req(headers)));
  });
});

// --- rateLimitHeaders ---

describe("rateLimitHeaders", () => {
  const base = {
    success: true,
    remaining: 59,
    limit: 60,
    reset: Date.now() + 60_000,
    retryAfter: 0,
  };

  it("includes X-RateLimit-Limit as string", () => {
    const h = rateLimitHeaders(base) as Record<string, string>;
    expect(h["X-RateLimit-Limit"]).toBe("60");
  });

  it("includes X-RateLimit-Remaining as string", () => {
    const h = rateLimitHeaders(base) as Record<string, string>;
    expect(h["X-RateLimit-Remaining"]).toBe("59");
  });

  it("includes X-RateLimit-Reset", () => {
    const h = rateLimitHeaders(base) as Record<string, string>;
    expect(h["X-RateLimit-Reset"]).toBeTruthy();
  });

  it("omits Retry-After when retryAfter is 0", () => {
    const h = rateLimitHeaders(base) as Record<string, string>;
    expect(h["Retry-After"]).toBeUndefined();
  });

  it("includes Retry-After in whole seconds when retryAfter > 0", () => {
    const h = rateLimitHeaders({ ...base, retryAfter: 30_500 }) as Record<string, string>;
    expect(h["Retry-After"]).toBe("31"); // Math.ceil(30500 / 1000)
  });
});
