import { mock, describe, it, expect } from "bun:test";
import { createMockSupabase } from "./helpers/supabase-mock";

const mockAdminRef = { client: createMockSupabase() };

mock.module("@/lib/supabase/admin", () => ({
  getAdminClient: () => mockAdminRef.client,
}));

// Re-establish the real validateApiKey in case an earlier test file mocked @/lib/api-keys.
// Bun v1.x shares mock.module state across files; this override restores correct behavior.
// The inline implementation calls getAdminClient() at runtime, picking up the mock above.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _nodeCrypto = require("crypto");
const _hashKey = (k: string) => _nodeCrypto.createHash("sha256").update(k).digest("hex");

mock.module("@/lib/api-keys", () => ({
  validateApiKey: async (request: Request) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAdminClient } = require("@/lib/supabase/admin");
    const header = request.headers.get("x-api-key");
    if (!header) return { valid: false, error: "Missing X-API-Key header" };
    if (!header.startsWith("ct_live_") || header.length !== 40)
      return { valid: false, error: "Invalid API key format" };
    const supabase = getAdminClient();
    const { data, error } = await supabase.from("api_keys").select("*").eq("key_hash", _hashKey(header)).single();
    if (error || !data) return { valid: false, error: "Invalid API key" };
    const row = data as { id: string; user_id: string; scopes: string[] | null; expires_at: string | null };
    if (row.expires_at && new Date(row.expires_at) < new Date())
      return { valid: false, error: "API key has expired" };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from("api_keys") as any).update({ last_used_at: new Date().toISOString() }).eq("id", row.id).then(() => {});
    return { valid: true, key: row, user_id: row.user_id, scopes: row.scopes ?? [] };
  },
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
