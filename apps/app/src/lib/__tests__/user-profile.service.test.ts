import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { createMockSupabase, createSpySupabase } from "./helpers/supabase-mock";
import { getProfile, updateProfile } from "../services/user-profile.service";

const USER_ID = "user-123";

// ---------------------------------------------------------------------------
// getProfile
// ---------------------------------------------------------------------------

describe("getProfile", () => {
  it("returns profile data on success", async () => {
    const row = { display_name: "Alex", timezone: "America/New_York" };
    const supabase = createMockSupabase({ user_profiles: { data: row } });

    const result = await getProfile(supabase, USER_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(row);
  });

  it("returns null data when profile does not exist", async () => {
    const supabase = createMockSupabase({
      user_profiles: { data: null, error: null },
    });

    const result = await getProfile(supabase, USER_ID);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it("returns QUERY_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      user_profiles: { data: null, error: { message: "connection timeout" } },
    });

    const result = await getProfile(supabase, USER_ID);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });

  it('filters by "id" column, not "user_id"', async () => {
    const { client, calls } = createSpySupabase({
      user_profiles: { data: null },
    });

    await getProfile(client, USER_ID);

    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls.length).toBeGreaterThan(0);
    expect(eqCalls.some((c) => c.args[0] === "id" && c.args[1] === USER_ID)).toBe(true);
    expect(eqCalls.some((c) => c.args[0] === "user_id")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updateProfile
// ---------------------------------------------------------------------------

describe("updateProfile", () => {
  it("returns success when update succeeds", async () => {
    const supabase = createMockSupabase({
      user_profiles: { data: null, error: null },
    });

    const result = await updateProfile(supabase, USER_ID, {
      display_name: "Alex Noboa",
      timezone: "America/New_York",
    });

    expect(result.success).toBe(true);
  });

  it("returns UPDATE_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      user_profiles: { data: null, error: { message: "RLS policy violation" } },
    });

    const result = await updateProfile(supabase, USER_ID, {
      display_name: "Alex Noboa",
      timezone: "UTC",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("UPDATE_FAILED");
  });

  it('uses update(), not upsert()', async () => {
    const { client, calls } = createSpySupabase({
      user_profiles: { data: null, error: null },
    });

    await updateProfile(client, USER_ID, {
      display_name: "Alex Noboa",
      timezone: "UTC",
    });

    expect(calls.some((c) => c.method === "upsert")).toBe(false);
    expect(calls.some((c) => c.method === "update")).toBe(true);
  });

  it('filters by "id" column, not "user_id"', async () => {
    const { client, calls } = createSpySupabase({
      user_profiles: { data: null, error: null },
    });

    await updateProfile(client, USER_ID, {
      display_name: "Alex Noboa",
      timezone: "UTC",
    });

    const eqCalls = calls.filter((c) => c.method === "eq");
    expect(eqCalls.some((c) => c.args[0] === "id" && c.args[1] === USER_ID)).toBe(true);
    expect(eqCalls.some((c) => c.args[0] === "user_id")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Static assertion: ProfileForm must be a client component
// ---------------------------------------------------------------------------

describe("ProfileForm", () => {
  it('declares "use client" to prevent hydration mismatches', () => {
    const src = readFileSync(
      join(__dirname, "../../components/settings/profile-form.tsx"),
      "utf8"
    );
    expect(src.trimStart().startsWith('"use client"')).toBe(true);
  });
});
