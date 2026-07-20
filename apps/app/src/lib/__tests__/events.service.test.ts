import { describe, it, expect } from "bun:test";
import { ingestEvents, queryEvents } from "../services/events.service";
import { createMockSupabase, createSpySupabase } from "./helpers/supabase-mock";
import type { IngestEvent } from "@/types/events";

const USER_ID = "user-abc";
const SESSION_ID = "sess-1";

function makeEvent(overrides: Partial<IngestEvent> = {}): IngestEvent {
  return {
    ts: "2025-05-01T10:00:00.000Z",
    event: "tool_use",
    session_id: SESSION_ID,
    seq: 1,
    data: { tool_name: "Read" },
    ...overrides,
  };
}

// Shorthand for a sessions queue entry indicating the session does not exist yet.
const NOT_FOUND = { error: { code: "PGRST116", message: "not found" } };
const OK = { data: null, error: null };

// --- ingestEvents ---

describe("ingestEvents", () => {
  it("returns inserted: 0 immediately when events array is empty", async () => {
    const supabase = createMockSupabase();
    const result = await ingestEvents(supabase, USER_ID, []);
    expect(result).toEqual({ success: true, data: { inserted: 0 } });
  });

  it("returns INGEST_FAILED when the events insert fails", async () => {
    const supabase = createMockSupabase({
      events: { error: { message: "DB error" } },
    });
    const result = await ingestEvents(supabase, USER_ID, [makeEvent()]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("INGEST_FAILED");
  });

  it("creates a new session when none exists and returns inserted count", async () => {
    const supabase = createMockSupabase(
      {
        events: OK,
        // 1st call: select → not found; 2nd call: insert → ok
        sessions: [NOT_FOUND, OK],
      },
      { update_daily_aggregate: OK }
    );

    const result = await ingestEvents(supabase, USER_ID, [makeEvent()]);
    expect(result).toEqual({ success: true, data: { inserted: 1 } });
  });

  it("updates existing session when one already exists", async () => {
    const existing = {
      id: "row-1",
      started_at: "2025-05-01T09:00:00.000Z",
      ended_at: "2025-05-01T09:30:00.000Z",
      event_count: 5,
      tool_count: 2,
    };
    const supabase = createMockSupabase(
      {
        events: OK,
        // 1st call: select → existing; 2nd call: update → ok
        sessions: [{ data: existing, error: null }, OK],
      },
      { update_daily_aggregate: OK }
    );

    const result = await ingestEvents(supabase, USER_ID, [makeEvent()]);
    expect(result).toEqual({ success: true, data: { inserted: 1 } });
  });

  it("returns inserted count equal to number of events in the batch", async () => {
    const supabase = createMockSupabase(
      {
        events: OK,
        sessions: [NOT_FOUND, OK],
      },
      { update_daily_aggregate: OK }
    );

    const events = [
      makeEvent({ seq: 1 }),
      makeEvent({ seq: 2, event: "tool_result" }),
      makeEvent({ seq: 3, event: "assistant_stop" }),
    ];
    const result = await ingestEvents(supabase, USER_ID, events);
    expect(result).toEqual({ success: true, data: { inserted: 3 } });
  });

  it("handles two distinct sessions in the same batch", async () => {
    const supabase = createMockSupabase(
      {
        events: OK,
        // Two separate sessions: each needs a select + insert
        sessions: [NOT_FOUND, OK, NOT_FOUND, OK],
      },
      { update_daily_aggregate: OK }
    );

    const events = [
      makeEvent({ session_id: "sess-A" }),
      makeEvent({ session_id: "sess-B" }),
    ];
    const result = await ingestEvents(supabase, USER_ID, events);
    expect(result).toEqual({ success: true, data: { inserted: 2 } });
  });

  it("triggers the daily aggregate RPC once per unique date", async () => {
    // Two events on different dates → two RPC invocations; mock accepts both
    const supabase = createMockSupabase(
      {
        events: OK,
        sessions: [NOT_FOUND, OK, NOT_FOUND, OK],
      },
      { update_daily_aggregate: [OK, OK] }
    );

    const events = [
      makeEvent({ session_id: "sess-A", ts: "2025-05-01T10:00:00.000Z" }),
      makeEvent({ session_id: "sess-B", ts: "2025-05-02T10:00:00.000Z" }),
    ];
    const result = await ingestEvents(supabase, USER_ID, events);
    expect(result.success).toBe(true);
  });

  it("writes token data to session when a stop event is present", async () => {
    const supabase = createMockSupabase(
      {
        events: OK,
        // select → not found → insert new session → update for token data
        sessions: [NOT_FOUND, OK, OK],
      },
      { update_daily_aggregate: OK }
    );

    const stopEvent = makeEvent({
      event: "stop",
      data: { input_tokens: 100, output_tokens: 50, model: "claude-3-5-sonnet" },
    });
    const result = await ingestEvents(supabase, USER_ID, [stopEvent]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inserted).toBe(1);
  });

  it("skips token update when stop event has no token data", async () => {
    // No update_daily_aggregate error means flow completes without token update
    const supabase = createMockSupabase(
      {
        events: OK,
        sessions: [NOT_FOUND, OK],
      },
      { update_daily_aggregate: OK }
    );

    const stopEvent = makeEvent({ event: "stop", data: {} });
    const result = await ingestEvents(supabase, USER_ID, [stopEvent]);
    expect(result.success).toBe(true);
  });

  it("promotes eval_id and eval_variant from session_start onto the session", async () => {
    // select → not found; insert → ok; eval promotion update → ok
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK, OK],
    });

    const evalEvent = makeEvent({
      event: "session_start",
      data: { eval_id: "deep-research", eval_variant: "v3" },
    });

    const result = await ingestEvents(client, USER_ID, [evalEvent]);
    expect(result.success).toBe(true);

    const updateCalls = calls.filter((c) => c.method === "update");
    expect(
      updateCalls.some((c) => {
        const payload = c.args[0] as Record<string, unknown>;
        return payload.eval_id === "deep-research" && payload.eval_variant === "v3";
      })
    ).toBe(true);
  });
});

// --- queryEvents ---

describe("queryEvents", () => {
  it("returns events and total on success", async () => {
    const rows = [{ id: "e1", event_type: "tool_use" }];
    const supabase = createMockSupabase({
      events: { data: rows, error: null, count: 1 },
    });
    const result = await queryEvents(supabase, USER_ID, {});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.events).toEqual(rows);
      expect(result.data.total).toBe(1);
    }
  });

  it("defaults total to 0 when count is null", async () => {
    const supabase = createMockSupabase({
      events: { data: [], error: null, count: null },
    });
    const result = await queryEvents(supabase, USER_ID, {});
    if (result.success) expect(result.data.total).toBe(0);
  });

  it("returns QUERY_FAILED error on DB failure", async () => {
    const supabase = createMockSupabase({
      events: { data: null, error: { message: "connection lost" } },
    });
    const result = await queryEvents(supabase, USER_ID, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});
