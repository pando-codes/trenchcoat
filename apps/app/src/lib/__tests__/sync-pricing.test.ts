import { mock, describe, it, expect, beforeEach, afterEach } from "bun:test";
import { NextRequest } from "next/server";
import { createMockSupabase } from "./helpers/supabase-mock";

const mockAdminRef = { client: createMockSupabase() };

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockAdminRef.client,
}));

const { GET } = await import("../../app/api/v1/admin/sync-pricing/route");

// ============================================================================
// Fixtures
// ============================================================================

const SECRET = "test-cron-secret";

const SAMPLE_PRICING = {
  "claude-3-5-sonnet-20241022": {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
  },
  "claude-3-haiku-20240307": {
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.00000125,
  },
  "gpt-4o": {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000015,
  },
};

const CLAUDE_ONLY_PRICING = {
  "claude-3-5-sonnet-20241022": SAMPLE_PRICING["claude-3-5-sonnet-20241022"],
  "claude-3-haiku-20240307": SAMPLE_PRICING["claude-3-haiku-20240307"],
};

function req(authHeader?: string) {
  const headers: Record<string, string> = {};
  if (authHeader !== undefined) headers["authorization"] = authHeader;
  return new NextRequest("http://localhost/api/v1/admin/sync-pricing", { headers });
}

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

// ============================================================================
// Tests
// ============================================================================

describe("GET /api/v1/admin/sync-pricing", () => {
  beforeEach(() => {
    process.env.CRON_SECRET = SECRET;
    mockFetch = mock();
    (globalThis as unknown as { fetch: unknown }).fetch = mockFetch;
    mockAdminRef.client = createMockSupabase({
      model_pricing: { data: null, error: null },
    });
  });

  afterEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = originalFetch;
    delete process.env.CRON_SECRET;
  });

  // --- Auth ---

  it("returns 401 when CRON_SECRET env var is not set", async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header has wrong token", async () => {
    const res = await GET(req("Bearer wrong-token"));
    expect(res.status).toBe(401);
  });

  it("returns 401 when Authorization header uses wrong scheme", async () => {
    const res = await GET(req(`Basic ${SECRET}`));
    expect(res.status).toBe(401);
  });

  // --- Fetch failures ---

  it("returns 500 when upstream pricing fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("network error"));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("Fetch failed");
  });

  it("returns 500 when upstream pricing fetch returns non-OK status", async () => {
    mockFetch.mockResolvedValue(new Response("not found", { status: 404 }));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
  });

  // --- Data validation ---

  it("returns 500 when pricing data contains no Claude models", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ "gpt-4o": { input_cost_per_token: 0.000005, output_cost_per_token: 0.000015 } }), { status: 200 })
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toContain("No Claude models");
  });

  it("returns 500 when DB upsert fails", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(CLAUDE_ONLY_PRICING), { status: 200 })
    );
    mockAdminRef.client = createMockSupabase({
      model_pricing: { data: null, error: { message: "constraint violation" } },
    });
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
  });

  // --- Success ---

  it("returns synced count equal to number of Claude models processed", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_PRICING), { status: 200 })
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.synced).toBe(2); // only 2 Claude models, gpt-4o is filtered out
  });

  it("excludes non-Claude models from the upsert", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(SAMPLE_PRICING), { status: 200 })
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.synced).toBe(2); // gpt-4o excluded
  });

  it("converts per-token costs to per-1M correctly", async () => {
    const singleModel = {
      "claude-test": {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
      },
    };
    let capturedRows: unknown[] = [];
    mockAdminRef.client = {
      from: () => ({
        upsert: (rows: unknown[]) => {
          capturedRows = rows;
          return {
            then: (resolve: (v: { data: null; error: null }) => void) =>
              resolve({ data: null, error: null }),
          };
        },
      }),
    } as unknown as ReturnType<typeof createMockSupabase>;

    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(singleModel), { status: 200 })
    );
    await GET(req(`Bearer ${SECRET}`));

    expect(capturedRows).toHaveLength(1);
    const row = capturedRows[0] as { input_cost_per_1m: number; output_cost_per_1m: number };
    expect(row.input_cost_per_1m).toBe(3);
    expect(row.output_cost_per_1m).toBe(15);
  });

  it("skips models missing input or output cost", async () => {
    const partialPricing = {
      "claude-incomplete": { input_cost_per_token: 0.000003 }, // no output cost
      "claude-full": { input_cost_per_token: 0.000003, output_cost_per_token: 0.000015 },
    };
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify(partialPricing), { status: 200 })
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.synced).toBe(1); // only the complete model
  });
});
