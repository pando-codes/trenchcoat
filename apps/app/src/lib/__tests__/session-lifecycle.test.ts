import { describe, it, expect, mock } from "bun:test";
import { ingestEvents } from "../services/events.service";
import { createSpySupabase, createMockSupabase } from "./helpers/supabase-mock";
import type { IngestEvent } from "@/types/events";

const USER_ID = "user-xyz";
const NOT_FOUND = { error: { code: "PGRST116", message: "not found" } };
const OK = { data: null, error: null };

function makeEvent(overrides: Partial<IngestEvent> = {}): IngestEvent {
  return {
    ts: "2025-05-01T10:00:00.000Z",
    event: "session_start",
    session_id: "sess-1",
    seq: 0,
    data: {},
    ...overrides,
  };
}

// Finds the sessions INSERT call by looking for the object with started_at
// (distinguishes it from the events INSERT which passes an array)
function findSessionInsert(calls: { method: string; args: unknown[] }[]) {
  return calls.find(
    (c) =>
      c.method === "insert" &&
      !Array.isArray(c.args[0]) &&
      typeof c.args[0] === "object" &&
      c.args[0] !== null &&
      "started_at" in (c.args[0] as object)
  );
}

// Finds the sessions UPDATE call (has ended_at; token updates don't)
function findSessionUpdate(calls: { method: string; args: unknown[] }[]) {
  return calls.find(
    (c) =>
      c.method === "update" &&
      typeof c.args[0] === "object" &&
      c.args[0] !== null &&
      "ended_at" in (c.args[0] as object)
  );
}

// ============================================================================
// Duration computation — new sessions
// ============================================================================

describe("session lifecycle — new session duration", () => {
  it("sets duration_ms when session_start and session_end span 5 minutes", async () => {
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK],
    });

    const T0 = "2025-05-01T10:00:00.000Z";
    const T1 = "2025-05-01T10:05:00.000Z";

    await ingestEvents(client, USER_ID, [
      makeEvent({ ts: T0, event: "session_start", seq: 0 }),
      makeEvent({ ts: T1, event: "session_end", seq: 1 }),
    ]);

    const row = findSessionInsert(calls)?.args[0] as Record<string, unknown>;
    expect(row.duration_ms).toBe(5 * 60 * 1_000);
  });

  it("sets duration_ms to null when only session_start is sent (equal timestamps)", async () => {
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK],
    });

    await ingestEvents(client, USER_ID, [
      makeEvent({ ts: "2025-05-01T10:00:00.000Z", event: "session_start" }),
    ]);

    const row = findSessionInsert(calls)?.args[0] as Record<string, unknown>;
    expect(row.duration_ms).toBeNull();
  });

  it("uses the full timestamp range across multiple events in one batch", async () => {
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK],
    });

    await ingestEvents(client, USER_ID, [
      makeEvent({ ts: "2025-05-01T10:00:00.000Z", event: "session_start", seq: 0 }),
      makeEvent({ ts: "2025-05-01T10:02:00.000Z", event: "tool_use", seq: 1 }),
      makeEvent({ ts: "2025-05-01T10:10:00.000Z", event: "session_end", seq: 2 }),
    ]);

    const row = findSessionInsert(calls)?.args[0] as Record<string, unknown>;
    expect(row.duration_ms).toBe(10 * 60 * 1_000); // 10 min, not 2 min
  });
});

// ============================================================================
// Duration computation — existing sessions (second batch extends the window)
// ============================================================================

describe("session lifecycle — updating existing session duration", () => {
  it("extends duration_ms when a later event arrives for an existing session", async () => {
    const STARTED_AT = "2025-05-01T10:00:00.000Z";
    const existing = {
      id: "row-1",
      started_at: STARTED_AT,
      ended_at: "2025-05-01T10:01:00.000Z", // 1 min so far
      event_count: 1,
      tool_count: 0,
    };
    const NEW_END = "2025-05-01T10:06:00.000Z"; // 6 min from session start

    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [{ data: existing, error: null }, OK],
    });

    await ingestEvents(client, USER_ID, [
      makeEvent({ ts: NEW_END, event: "session_end", seq: 2 }),
    ]);

    const row = findSessionUpdate(calls)?.args[0] as Record<string, unknown>;
    expect(row.duration_ms).toBe(6 * 60 * 1_000);
    expect(row.ended_at).toBe(NEW_END);
  });

  it("does not move started_at earlier than the existing value", async () => {
    const ORIGINAL_START = "2025-05-01T10:00:00.000Z";
    const existing = {
      id: "row-1",
      started_at: ORIGINAL_START,
      ended_at: "2025-05-01T10:03:00.000Z",
      event_count: 2,
      tool_count: 0,
    };
    // New event is later than original start — started_at should stay
    const NEW_EVENT_TS = "2025-05-01T10:05:00.000Z";

    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [{ data: existing, error: null }, OK],
    });

    await ingestEvents(client, USER_ID, [
      makeEvent({ ts: NEW_EVENT_TS, event: "assistant_stop", seq: 3 }),
    ]);

    const row = findSessionUpdate(calls)?.args[0] as Record<string, unknown>;
    expect(row.started_at).toBe(ORIGINAL_START);
  });
});

// ============================================================================
// Test-connection session (from the trenchcoat-connect skill)
// Documenting: a session_start sent during connection verification creates a
// real session row that is indistinguishable from production data.
// ============================================================================

describe("test-connection session", () => {
  it("creates a real session row with session_id 'test-connection'", async () => {
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK],
    });

    await ingestEvents(client, USER_ID, [
      makeEvent({
        ts: "2025-05-19T15:40:00.000Z",
        event: "session_start",
        session_id: "test-connection",
        data: { cwd: "test" },
      }),
    ]);

    const row = findSessionInsert(calls)?.args[0] as Record<string, unknown>;
    expect(row.session_id).toBe("test-connection");
  });

  it("stores session_id verbatim — no prefix filtering occurs", async () => {
    const ids = ["test-connection", "real-session", "_tc_test_xyz", "sess-abc-123"];

    for (const id of ids) {
      const { client, calls } = createSpySupabase({
        events: OK,
        sessions: [NOT_FOUND, OK],
      });

      await ingestEvents(client, USER_ID, [makeEvent({ session_id: id })]);

      const row = findSessionInsert(calls)?.args[0] as Record<string, unknown>;
      expect(row.session_id).toBe(id);
    }
  });

  it("gives a test-connection session null duration (single session_start only)", async () => {
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK],
    });

    await ingestEvents(client, USER_ID, [
      makeEvent({
        ts: "2025-05-19T15:40:00.000Z",
        event: "session_start",
        session_id: "test-connection",
        data: { cwd: "test" },
      }),
    ]);

    const row = findSessionInsert(calls)?.args[0] as Record<string, unknown>;
    // Dashboard shows "--" for duration because duration_ms is null
    expect(row.duration_ms).toBeNull();
  });
});

// ============================================================================
// Daily aggregate RPC — parameter verification
// ============================================================================

describe("daily aggregate RPC", () => {
  it("is called with the correct p_user_id and p_date", async () => {
    const rpcSpy = mock(() => Promise.resolve({ data: null, error: null }));
    const base = createMockSupabase({ events: OK, sessions: [NOT_FOUND, OK] }, {});
    (base as unknown as Record<string, unknown>).rpc = rpcSpy;

    await ingestEvents(base, "user-xyz", [
      makeEvent({ ts: "2025-06-15T10:30:00.000Z", session_id: "s1" }),
    ]);

    expect(rpcSpy).toHaveBeenCalledWith("update_daily_aggregate", {
      p_user_id: "user-xyz",
      p_date: "2025-06-15",
    });
  });

  it("is called once per unique date across all events in the batch", async () => {
    const rpcSpy = mock(() => Promise.resolve({ data: null, error: null }));
    const base = createMockSupabase(
      { events: OK, sessions: [NOT_FOUND, OK, NOT_FOUND, OK] },
      {}
    );
    (base as unknown as Record<string, unknown>).rpc = rpcSpy;

    await ingestEvents(base, USER_ID, [
      makeEvent({ ts: "2025-06-15T10:00:00.000Z", session_id: "s1", seq: 0 }),
      makeEvent({ ts: "2025-06-15T11:00:00.000Z", session_id: "s1", seq: 1 }),
      makeEvent({ ts: "2025-06-16T09:00:00.000Z", session_id: "s2", seq: 0 }),
    ]);

    // Two distinct dates → two RPC calls, not three
    expect(rpcSpy).toHaveBeenCalledTimes(2);
  });

  it("extracts the date from the event timestamp (not the current date)", async () => {
    const rpcSpy = mock(() => Promise.resolve({ data: null, error: null }));
    const base = createMockSupabase({ events: OK, sessions: [NOT_FOUND, OK] }, {});
    (base as unknown as Record<string, unknown>).rpc = rpcSpy;

    // Event timestamp is in the past — date must come from the event, not Date.now()
    await ingestEvents(base, USER_ID, [
      makeEvent({ ts: "2023-01-01T00:00:00.000Z", session_id: "s1" }),
    ]);

    expect(rpcSpy).toHaveBeenCalledWith("update_daily_aggregate", {
      p_user_id: USER_ID,
      p_date: "2023-01-01",
    });
  });
});
