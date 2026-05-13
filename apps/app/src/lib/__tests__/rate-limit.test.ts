import { describe, it, expect } from "bun:test";
import { createRateLimiter, getClientIdentifier, rateLimitHeaders } from "../rate-limit";

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
