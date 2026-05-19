/**
 * Integration tests for the events endpoint handler stack.
 * Unlike events.service.test.ts (unit) and event-schema.test.ts (schema only),
 * these tests exercise createApiHandler end-to-end: auth → scope check → body
 * validation → handler invocation.
 *
 * The scope enforcement tests use mockRequireScopes.mockImplementation() with
 * the real requireScopes logic to verify end-to-end wiring without module
 * pollution (mirrors the pattern used by api-middleware.test.ts).
 */
import { mock, describe, it, expect, beforeEach, afterAll } from "bun:test";
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
const { z } = await import("zod");

// Mirror the production schema from apps/app/src/app/api/v1/events/route.ts.
// Defined inline to avoid importing the route (which drags in getAdminClient).
const eventSchema = z.object({
  ts: z.string().datetime({ offset: true }),
  event: z.enum([
    "session_start", "session_end", "tool_use", "tool_result",
    "prompt_submit", "assistant_stop", "subagent_stop", "pre_compact", "error",
  ]),
  session_id: z.string().min(1),
  seq: z.number().int().min(0),
  data: z.record(z.string(), z.unknown()).default({}),
});
const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(1000),
});

// Real requireScopes logic (matches @/types/api-keys implementation).
// Used via mockImplementation so scope tests exercise actual logic without
// requiring a separate mock.module that could pollute other test files.
function realRequireScopes(
  context: { scopes?: string[] },
  requiredScopes: string[]
): string | null {
  if (!context.scopes) return "No scopes available";
  if (context.scopes.includes("admin")) return null;
  const missing = requiredScopes.filter((s) => !context.scopes!.includes(s));
  return missing.length > 0
    ? `Insufficient permissions. Required scopes: ${requiredScopes.join(", ")}`
    : null;
}

// ============================================================================
// Fixtures
// ============================================================================

const VALID_KEY = "ct_live_" + "a".repeat(32);
const RATE_LIMIT_OK = {
  success: true,
  remaining: 99,
  limit: 200,
  reset: Date.now() + 60_000,
  retryAfter: 0,
};
const ROUTE_CONTEXT = { params: Promise.resolve({}) };
const VALID_EVENT = {
  ts: "2025-05-01T10:00:00.000Z",
  event: "session_start",
  session_id: "sess-1",
  seq: 0,
};

function makeValidation(scopes: string[]) {
  return {
    valid: true,
    key: { id: "key-1", rate_limit_tier: "ingestion", scopes },
    user_id: "user-1",
    scopes,
  };
}

function makePostReq(body: unknown) {
  return new NextRequest("http://localhost/api/v1/events", {
    method: "POST",
    headers: { "X-API-Key": VALID_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ============================================================================
// Bulk boundary — tested at the full handler stack level
// (event-schema.test.ts covers the Zod schema in isolation; these verify the
// HTTP response when the schema is wired into createApiHandler)
// ============================================================================

describe("POST /events — bulk boundary", () => {
  beforeEach(() => {
    mockValidateApiKey.mockResolvedValue(makeValidation(["write:events"]));
    mockRequireScopes.mockReturnValue(null);
    mockLimiterCheck.mockResolvedValue(RATE_LIMIT_OK);
    mockRateLimitHeaders.mockReturnValue({});
  });

  it("returns 400 when 1001 events are submitted", async () => {
    const okHandler = mock(() => Promise.resolve(new Response("ok", { status: 201 })));
    const handler = createApiHandler({ scopes: ["write:events"], bodySchema }, okHandler);
    const events = Array.from({ length: 1001 }, (_, i) => ({ ...VALID_EVENT, seq: i }));

    const res = await handler(makePostReq({ events }), ROUTE_CONTEXT);

    expect(res.status).toBe(400);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("returns 400 when 0 events are submitted", async () => {
    const okHandler = mock(() => Promise.resolve(new Response("ok", { status: 201 })));
    const handler = createApiHandler({ scopes: ["write:events"], bodySchema }, okHandler);

    const res = await handler(makePostReq({ events: [] }), ROUTE_CONTEXT);

    expect(res.status).toBe(400);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("passes through to handler when exactly 1000 events are submitted", async () => {
    const okHandler = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ inserted: 1000 }), { status: 201 }))
    );
    const handler = createApiHandler({ scopes: ["write:events"], bodySchema }, okHandler);
    const events = Array.from({ length: 1000 }, (_, i) => ({ ...VALID_EVENT, seq: i }));

    const res = await handler(makePostReq({ events }), ROUTE_CONTEXT);

    expect(res.status).toBe(201);
    expect(okHandler).toHaveBeenCalledTimes(1);
  });

  it("400 response body contains a descriptive validation message", async () => {
    const handler = createApiHandler(
      { scopes: ["write:events"], bodySchema },
      mock(() => Promise.resolve(new Response("ok")))
    );
    const events = Array.from({ length: 1001 }, (_, i) => ({ ...VALID_EVENT, seq: i }));

    const res = await handler(makePostReq({ events }), ROUTE_CONTEXT);
    const body = await res.json();

    expect(body.error).toBeDefined();
    expect(typeof body.error.message).toBe("string");
  });
});

// ============================================================================
// Scope enforcement — mockRequireScopes uses real implementation
// Verifies that the middleware correctly wires key scopes into the scope check.
// ============================================================================

describe("POST /events — scope enforcement", () => {
  beforeEach(() => {
    mockRequireScopes.mockImplementation(realRequireScopes);
    mockLimiterCheck.mockResolvedValue(RATE_LIMIT_OK);
    mockRateLimitHeaders.mockReturnValue({});
  });

  it("returns 403 when key has only read:analytics scope", async () => {
    mockValidateApiKey.mockResolvedValue(makeValidation(["read:analytics"]));
    const okHandler = mock(() => Promise.resolve(new Response("ok")));
    const handler = createApiHandler({ scopes: ["write:events"] }, okHandler);

    const res = await handler(makePostReq({ events: [VALID_EVENT] }), ROUTE_CONTEXT);

    expect(res.status).toBe(403);
    expect(okHandler).not.toHaveBeenCalled();
  });

  it("returns 403 when key has read-only scopes but not write:events", async () => {
    mockValidateApiKey.mockResolvedValue(
      makeValidation(["read:sessions", "read:analytics", "read:events"])
    );
    const okHandler = mock(() => Promise.resolve(new Response("ok")));
    const handler = createApiHandler({ scopes: ["write:events"] }, okHandler);

    const res = await handler(makePostReq({ events: [VALID_EVENT] }), ROUTE_CONTEXT);

    expect(res.status).toBe(403);
  });

  it("returns 403 when key has no scopes at all", async () => {
    mockValidateApiKey.mockResolvedValue(makeValidation([]));
    const okHandler = mock(() => Promise.resolve(new Response("ok")));
    const handler = createApiHandler({ scopes: ["write:events"] }, okHandler);

    const res = await handler(makePostReq({ events: [VALID_EVENT] }), ROUTE_CONTEXT);

    expect(res.status).toBe(403);
  });

  it("403 response body names the missing scope", async () => {
    mockValidateApiKey.mockResolvedValue(makeValidation(["read:analytics"]));
    const handler = createApiHandler(
      { scopes: ["write:events"] },
      mock(() => Promise.resolve(new Response("ok")))
    );

    const res = await handler(makePostReq({ events: [VALID_EVENT] }), ROUTE_CONTEXT);
    const body = await res.json();

    expect(body.error.message).toContain("write:events");
  });

  it("allows access when key has write:events scope", async () => {
    mockValidateApiKey.mockResolvedValue(makeValidation(["write:events"]));
    const okHandler = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    const handler = createApiHandler({ scopes: ["write:events"], bodySchema }, okHandler);

    const res = await handler(makePostReq({ events: [VALID_EVENT] }), ROUTE_CONTEXT);

    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
  });

  it("allows access when key has admin scope (bypasses all requirements)", async () => {
    mockValidateApiKey.mockResolvedValue(makeValidation(["admin"]));
    const okHandler = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    );
    const handler = createApiHandler({ scopes: ["write:events"] }, okHandler);

    const res = await handler(makePostReq({ events: [VALID_EVENT] }), ROUTE_CONTEXT);

    expect(res.status).toBe(200);
    expect(okHandler).toHaveBeenCalledTimes(1);
  });
});

// Restore all module mocks so later test files (rate-limit, validate-api-key)
// get the real implementations. In Bun v1.x, mock.module is global within the run.
afterAll(() => {
  mock.restore();
});

