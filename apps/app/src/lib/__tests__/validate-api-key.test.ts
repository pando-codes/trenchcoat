import { mock, describe, it, expect } from "bun:test";
import { createMockSupabase } from "./helpers/supabase-mock";

const mockAdminRef = { client: createMockSupabase() };

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockAdminRef.client,
}));

const { validateApiKey } = await import("../api-keys");

// ============================================================================
// Helpers
// ============================================================================

const VALID_KEY_PLAIN = "ct_live_" + "a".repeat(32); // exactly 40 chars

function req(headers: Record<string, string>) {
  return new Request("http://localhost", { headers });
}

const VALID_DB_ROW = {
  id: "key-1",
  user_id: "user-1",
  scopes: ["write:events", "read:analytics"],
  expires_at: null,
};

// ============================================================================
// Tests
// ============================================================================

describe("validateApiKey", () => {
  it("returns invalid when X-API-Key header is missing", async () => {
    const result = await validateApiKey(req({}));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("Missing");
  });

  it("returns invalid when key does not start with 'ct_live_'", async () => {
    const result = await validateApiKey(req({ "x-api-key": "sk_live_" + "a".repeat(32) }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("Invalid API key format");
  });

  it("returns invalid when key has correct prefix but wrong length (too short)", async () => {
    const result = await validateApiKey(req({ "x-api-key": "ct_live_short" }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("Invalid API key format");
  });

  it("returns invalid when key has correct prefix but wrong length (too long)", async () => {
    const result = await validateApiKey(req({ "x-api-key": "ct_live_" + "a".repeat(33) }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("Invalid API key format");
  });

  it("returns invalid when DB lookup returns an error", async () => {
    mockAdminRef.client = createMockSupabase({
      api_keys: { data: null, error: { message: "connection lost" } },
    });
    const result = await validateApiKey(req({ "x-api-key": VALID_KEY_PLAIN }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("Invalid API key");
  });

  it("returns invalid when DB lookup returns no matching row", async () => {
    mockAdminRef.client = createMockSupabase({
      api_keys: { data: null, error: null },
    });
    const result = await validateApiKey(req({ "x-api-key": VALID_KEY_PLAIN }));
    expect(result.valid).toBe(false);
  });

  it("returns invalid when key is expired", async () => {
    const expiredRow = { ...VALID_DB_ROW, expires_at: "2020-01-01T00:00:00.000Z" };
    mockAdminRef.client = createMockSupabase({
      api_keys: [
        { data: expiredRow, error: null },
        { data: null, error: null }, // for the fire-and-forget update
      ],
    });
    const result = await validateApiKey(req({ "x-api-key": VALID_KEY_PLAIN }));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toContain("expired");
  });

  it("returns valid with user_id and scopes for a good key with no expiry", async () => {
    mockAdminRef.client = createMockSupabase({
      api_keys: [
        { data: VALID_DB_ROW, error: null },
        { data: null, error: null }, // for the fire-and-forget update
      ],
    });
    const result = await validateApiKey(req({ "x-api-key": VALID_KEY_PLAIN }));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.user_id).toBe("user-1");
      expect(result.scopes).toEqual(["write:events", "read:analytics"]);
    }
  });

  it("returns valid when key has a future expiry date", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    const rowWithExpiry = { ...VALID_DB_ROW, expires_at: tomorrow };
    mockAdminRef.client = createMockSupabase({
      api_keys: [
        { data: rowWithExpiry, error: null },
        { data: null, error: null },
      ],
    });
    const result = await validateApiKey(req({ "x-api-key": VALID_KEY_PLAIN }));
    expect(result.valid).toBe(true);
  });

  it("defaults scopes to empty array when DB row has no scopes field", async () => {
    const rowNoScopes = { id: "key-1", user_id: "user-1", expires_at: null, scopes: null };
    mockAdminRef.client = createMockSupabase({
      api_keys: [
        { data: rowNoScopes, error: null },
        { data: null, error: null },
      ],
    });
    const result = await validateApiKey(req({ "x-api-key": VALID_KEY_PLAIN }));
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.scopes).toEqual([]);
  });
});
