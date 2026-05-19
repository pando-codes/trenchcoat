import { mock, describe, it, expect, beforeEach } from "bun:test";
import { NextRequest } from "next/server";

const mockValidateApiKey = mock();
const mockRequireScopes = mock(() => null);
const mockLimiterCheck = mock();
const mockRateLimitHeaders = mock(() => ({}));

mock.module("@/lib/api-keys", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeCrypto = require("crypto") as typeof import("crypto");
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const hashApiKey = (k: string) =>
    nodeCrypto.createHash("sha256").update(k).digest("hex");
  return {
    validateApiKey: mockValidateApiKey,
    requireScopes: mockRequireScopes,
    // Inline real implementations so other test files that statically import
    // @/lib/api-keys still receive valid exports (mock.module persists across files).
    hashApiKey,
    generateApiKey: () => {
      const arr = nodeCrypto.randomBytes(32) as Buffer;
      const rnd = Array.from(arr).map((b) => CHARS[(b as number) % CHARS.length]).join("");
      const plaintext = `ct_live_${rnd}`;
      return { plaintext, hash: hashApiKey(plaintext), prefix: plaintext.substring(0, 12) };
    },
    hasRequiredScopes: (ks: string[], rs: string[]) =>
      ks.includes("admin") || rs.every((s) => ks.includes(s)),
    API_SCOPES: {
      "write:events": { label: "Write Events", description: "", recommended: true },
      "read:events": { label: "Read Events", description: "" },
      "read:sessions": { label: "Read Sessions", description: "" },
      "read:analytics": { label: "Read Analytics", description: "" },
      admin: { label: "Admin", description: "", danger: true },
    },
  };
});

mock.module("@/lib/rate-limit", () => ({
  createRateLimiter: () => ({ check: mockLimiterCheck, reset: mock() }),
  rateLimitHeaders: mockRateLimitHeaders,
  getClientIdentifier: () => "test-client",
}));

const { createApiHandler } = await import("../api-middleware");

// ============================================================================
// Fixtures
// ============================================================================

const VALID_KEY = "ct_live_" + "a".repeat(32);

const VALID_VALIDATION = {
  valid: true,
  key: { id: "key-1", rate_limit_tier: "standard", scopes: ["write:events"] },
  user_id: "user-1",
  scopes: ["write:events"],
};

const RATE_LIMIT_OK = {
  success: true,
  remaining: 59,
  limit: 60,
  reset: Date.now() + 60_000,
  retryAfter: 0,
};

const ROUTE_CONTEXT = { params: Promise.resolve({}) };

function makeReq(opts: {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  url?: string;
} = {}) {
  const url = opts.url ?? "http://localhost/api/v1/test";
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { "X-API-Key": VALID_KEY, ...opts.headers };
  if (opts.body) headers["Content-Type"] = "application/json";
  return new NextRequest(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

const okHandler = mock(() => Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 })));

// ============================================================================
// Tests
// ============================================================================

describe("createApiHandler", () => {
  beforeEach(() => {
    mockValidateApiKey.mockResolvedValue(VALID_VALIDATION);
    mockRequireScopes.mockReturnValue(null);
    mockLimiterCheck.mockResolvedValue(RATE_LIMIT_OK);
    mockRateLimitHeaders.mockReturnValue({});
    okHandler.mockClear();
  });

  // --- CORS ---

  it("OPTIONS request returns 204 with CORS headers", async () => {
    const handler = createApiHandler({}, okHandler);
    const res = await handler(makeReq({ method: "OPTIONS" }), ROUTE_CONTEXT);
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("OPTIONS request does not call the handler", async () => {
    const handler = createApiHandler({}, okHandler);
    await handler(makeReq({ method: "OPTIONS" }), ROUTE_CONTEXT);
    expect(okHandler).not.toHaveBeenCalled();
  });

  // --- Authentication ---

  it("returns 401 when validateApiKey reports invalid", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: false, error: "Missing X-API-Key header" });
    const handler = createApiHandler({}, okHandler);
    const res = await handler(makeReq(), ROUTE_CONTEXT);
    expect(res.status).toBe(401);
  });

  it("does not call the handler on auth failure", async () => {
    mockValidateApiKey.mockResolvedValue({ valid: false, error: "bad key" });
    const handler = createApiHandler({}, okHandler);
    await handler(makeReq(), ROUTE_CONTEXT);
    expect(okHandler).not.toHaveBeenCalled();
  });

  // --- Scope enforcement ---

  it("returns 403 when requireScopes returns an error string", async () => {
    mockRequireScopes.mockReturnValue("Missing required scope: write:events");
    const handler = createApiHandler({ scopes: ["write:events"] }, okHandler);
    const res = await handler(makeReq(), ROUTE_CONTEXT);
    expect(res.status).toBe(403);
  });

  it("calls handler when scopes are satisfied (requireScopes returns null)", async () => {
    mockRequireScopes.mockReturnValue(null);
    const handler = createApiHandler({ scopes: ["write:events"] }, okHandler);
    await handler(makeReq(), ROUTE_CONTEXT);
    expect(okHandler).toHaveBeenCalledTimes(1);
  });

  // --- Body validation ---

  it("returns 400 when POST body fails the Zod schema", async () => {
    const { z } = await import("zod");
    const handler = createApiHandler(
      { bodySchema: z.object({ name: z.string() }) },
      okHandler
    );
    const res = await handler(makeReq({ method: "POST", body: { name: 42 } }), ROUTE_CONTEXT);
    expect(res.status).toBe(400);
  });

  it("skips body validation for GET requests even when bodySchema is provided", async () => {
    const { z } = await import("zod");
    const handler = createApiHandler(
      { bodySchema: z.object({ name: z.string() }) },
      okHandler
    );
    const res = await handler(makeReq({ method: "GET" }), ROUTE_CONTEXT);
    expect(res.status).toBe(200);
  });

  it("passes validated body to handler context for POST requests", async () => {
    const { z } = await import("zod");
    let capturedBody: unknown;
    const handler = createApiHandler(
      { bodySchema: z.object({ count: z.number() }) },
      mock((_, ctx) => {
        capturedBody = ctx.body;
        return Promise.resolve(new Response("ok"));
      })
    );
    await handler(makeReq({ method: "POST", body: { count: 7 } }), ROUTE_CONTEXT);
    expect(capturedBody).toEqual({ count: 7 });
  });

  // --- Handler invocation ---

  it("calls the handler and returns its response for a valid request", async () => {
    const handler = createApiHandler({}, okHandler);
    const res = await handler(makeReq(), ROUTE_CONTEXT);
    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
  });

  it("passes userId and scopes from validated key into handler context", async () => {
    let capturedCtx: Record<string, unknown> = {};
    const handler = createApiHandler(
      {},
      mock((_, ctx) => {
        capturedCtx = ctx as Record<string, unknown>;
        return Promise.resolve(new Response("ok"));
      })
    );
    await handler(makeReq(), ROUTE_CONTEXT);
    expect(capturedCtx.userId).toBe("user-1");
    expect(capturedCtx.scopes).toEqual(["write:events"]);
  });

  // --- Error handling ---

  it("returns 500 when the handler throws an unhandled exception", async () => {
    const handler = createApiHandler(
      {},
      mock(() => { throw new Error("boom"); })
    );
    const res = await handler(makeReq(), ROUTE_CONTEXT);
    expect(res.status).toBe(500);
  });

  // --- Response headers ---

  it("adds X-Request-ID header to every successful response", async () => {
    const handler = createApiHandler({}, okHandler);
    const res = await handler(makeReq(), ROUTE_CONTEXT);
    expect(res.headers.get("X-Request-ID")).toMatch(/^req_/);
  });

  it("adds Access-Control-Allow-Origin: * to every response", async () => {
    const handler = createApiHandler({}, okHandler);
    const res = await handler(makeReq(), ROUTE_CONTEXT);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  // --- Pagination ---

  it("parses limit and offset from query string when pagination is enabled", async () => {
    let captured: { limit?: number; offset?: number } = {};
    const handler = createApiHandler(
      { pagination: true },
      mock((_, ctx) => {
        captured = ctx.pagination ?? {};
        return Promise.resolve(new Response("ok"));
      })
    );
    await handler(makeReq({ url: "http://localhost/api?limit=25&offset=50" }), ROUTE_CONTEXT);
    expect(captured.limit).toBe(25);
    expect(captured.offset).toBe(50);
  });

  it("caps pagination limit at 200", async () => {
    let captured: { limit?: number } = {};
    const handler = createApiHandler(
      { pagination: true },
      mock((_, ctx) => {
        captured = ctx.pagination ?? {};
        return Promise.resolve(new Response("ok"));
      })
    );
    await handler(makeReq({ url: "http://localhost/api?limit=999" }), ROUTE_CONTEXT);
    expect(captured.limit).toBe(200);
  });

  it("defaults pagination to limit=50, offset=0 when params are absent", async () => {
    let captured: { limit?: number; offset?: number } = {};
    const handler = createApiHandler(
      { pagination: true },
      mock((_, ctx) => {
        captured = ctx.pagination ?? {};
        return Promise.resolve(new Response("ok"));
      })
    );
    await handler(makeReq(), ROUTE_CONTEXT);
    expect(captured.limit).toBe(50);
    expect(captured.offset).toBe(0);
  });
});

