import { describe, it, expect } from "bun:test";
import {
  listApiKeys,
  createApiKey,
  revokeApiKey,
} from "../services/api-keys.service";
import { createMockSupabase } from "./helpers/supabase-mock";

const USER_ID = "user-abc";
const OK = { data: null, error: null };

// --- listApiKeys ---

describe("listApiKeys", () => {
  it("returns key list on success", async () => {
    const keys = [{ id: "k1", name: "My Key" }, { id: "k2", name: "CI Key" }];
    const supabase = createMockSupabase({
      api_keys: { data: keys, error: null },
    });
    const result = await listApiKeys(supabase, USER_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(keys);
  });

  it("returns empty array when user has no keys", async () => {
    const supabase = createMockSupabase({
      api_keys: { data: [], error: null },
    });
    const result = await listApiKeys(supabase, USER_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it("returns QUERY_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      api_keys: { data: null, error: { message: "timeout" } },
    });
    const result = await listApiKeys(supabase, USER_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});

// --- createApiKey ---

describe("createApiKey", () => {
  it("returns INVALID_SCOPES for empty scopes array", async () => {
    const supabase = createMockSupabase();
    const result = await createApiKey(supabase, USER_ID, {
      name: "My Key",
      scopes: [],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_SCOPES");
      expect(result.error.message).toContain("At least one scope");
    }
  });

  it("returns INVALID_SCOPES for unknown scope names", async () => {
    const supabase = createMockSupabase();
    const result = await createApiKey(supabase, USER_ID, {
      name: "My Key",
      scopes: ["read:events", "not:a:real:scope"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("INVALID_SCOPES");
      expect(result.error.message).toContain("not:a:real:scope");
    }
  });

  it("creates key and returns plaintext on success", async () => {
    const stored = {
      id: "k-new",
      user_id: USER_ID,
      name: "My Key",
      key_prefix: "ct_live_xxxx",
      scopes: ["write:events"],
      rate_limit_tier: "standard",
      last_used_at: null,
      expires_at: null,
      created_at: "2025-05-01T00:00:00Z",
    };
    const supabase = createMockSupabase({
      api_keys: { data: stored, error: null },
    });
    const result = await createApiKey(supabase, USER_ID, {
      name: "My Key",
      scopes: ["write:events"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // plaintext_key is added on top of the stored record
      expect(result.data.plaintext_key).toMatch(/^ct_live_/);
      expect(result.data.plaintext_key.length).toBe(40);
      expect(result.data.id).toBe("k-new");
    }
  });

  it("accepts all valid scope values", async () => {
    const stored = { id: "k-all", name: "Admin Key", scopes: ["admin"] };
    const supabase = createMockSupabase({
      api_keys: { data: stored, error: null },
    });
    const result = await createApiKey(supabase, USER_ID, {
      name: "Admin Key",
      scopes: ["admin"],
    });
    expect(result.success).toBe(true);
  });

  it("returns CREATE_FAILED when insert fails", async () => {
    const supabase = createMockSupabase({
      api_keys: { data: null, error: { message: "DB error" } },
    });
    const result = await createApiKey(supabase, USER_ID, {
      name: "My Key",
      scopes: ["read:analytics"],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("CREATE_FAILED");
  });
});

// --- revokeApiKey ---

describe("revokeApiKey", () => {
  it("returns revoked: true when key is deleted", async () => {
    const supabase = createMockSupabase({
      api_keys: { data: null, error: null, count: 1 },
    });
    const result = await revokeApiKey(supabase, USER_ID, "k1");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.revoked).toBe(true);
  });

  it("returns NOT_FOUND when count is 0 (key belongs to another user or does not exist)", async () => {
    const supabase = createMockSupabase({
      api_keys: { data: null, error: null, count: 0 },
    });
    const result = await revokeApiKey(supabase, USER_ID, "k-missing");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("NOT_FOUND");
  });

  it("returns DELETE_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      api_keys: { data: null, error: { message: "constraint error" } },
    });
    const result = await revokeApiKey(supabase, USER_ID, "k1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("DELETE_FAILED");
  });
});
