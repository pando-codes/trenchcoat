import { describe, it, expect } from "bun:test";
import {
  listSessions,
  getSession,
  getSessionEvents,
} from "../services/sessions.service";
import { createMockSupabase } from "./helpers/supabase-mock";

const USER_ID = "user-abc";

// --- listSessions ---

describe("listSessions", () => {
  it("returns sessions array and total on success", async () => {
    const rows = [{ session_id: "s1" }, { session_id: "s2" }];
    const supabase = createMockSupabase({
      sessions: { data: rows, error: null, count: 2 },
    });
    const result = await listSessions(supabase, USER_ID);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessions).toEqual(rows);
      expect(result.data.total).toBe(2);
    }
  });

  it("defaults total to 0 when count is null", async () => {
    const supabase = createMockSupabase({
      sessions: { data: [], error: null, count: null },
    });
    const result = await listSessions(supabase, USER_ID);
    if (result.success) expect(result.data.total).toBe(0);
  });

  it("returns empty array for a user with no sessions", async () => {
    const supabase = createMockSupabase({
      sessions: { data: [], error: null, count: 0 },
    });
    const result = await listSessions(supabase, USER_ID);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.sessions).toEqual([]);
  });

  it("returns QUERY_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      sessions: { data: null, error: { message: "timeout" } },
    });
    const result = await listSessions(supabase, USER_ID);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});

// --- getSession ---

describe("getSession", () => {
  it("returns the session when found", async () => {
    const session = { session_id: "s1", user_id: USER_ID };
    const supabase = createMockSupabase({
      sessions: { data: session, error: null },
    });
    const result = await getSession(supabase, USER_ID, "s1");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(session);
  });

  it("returns NOT_FOUND for PGRST116 (row not found)", async () => {
    const supabase = createMockSupabase({
      sessions: { data: null, error: { code: "PGRST116", message: "no rows" } },
    });
    const result = await getSession(supabase, USER_ID, "missing");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("NOT_FOUND");
      expect(result.error.message).toContain("not found");
    }
  });

  it("returns QUERY_FAILED for other DB errors", async () => {
    const supabase = createMockSupabase({
      sessions: { data: null, error: { code: "500", message: "crash" } },
    });
    const result = await getSession(supabase, USER_ID, "s1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});

// --- getSessionEvents ---

describe("getSessionEvents", () => {
  it("returns events and total on success", async () => {
    const rows = [{ id: "e1" }, { id: "e2" }];
    const supabase = createMockSupabase({
      events: { data: rows, error: null, count: 2 },
    });
    const result = await getSessionEvents(supabase, USER_ID, "s1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.events).toEqual(rows);
      expect(result.data.total).toBe(2);
    }
  });

  it("defaults total to 0 when count is null", async () => {
    const supabase = createMockSupabase({
      events: { data: [], error: null, count: null },
    });
    const result = await getSessionEvents(supabase, USER_ID, "s1");
    if (result.success) expect(result.data.total).toBe(0);
  });

  it("returns QUERY_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      events: { data: null, error: { message: "DB error" } },
    });
    const result = await getSessionEvents(supabase, USER_ID, "s1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});
