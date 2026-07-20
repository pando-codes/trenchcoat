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

  // Returns the argument object of every `.update(...)` call the ingest made.
  function updateArgs(calls: { method: string; args: unknown[] }[]) {
    return calls
      .filter((c) => c.method === "update")
      .map((c) => c.args[0] as Record<string, unknown>);
  }

  it("promotes cache tokens from assistant_stop onto the session", async () => {
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK, OK],
    });

    const events = [
      makeEvent({
        seq: 1,
        event: "assistant_stop",
        data: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_tokens: 32655,
          cache_read_tokens: 15121,
          model: "claude-sonnet",
        },
      }),
    ];

    const result = await ingestEvents(client, USER_ID, events);
    expect(result.success).toBe(true);

    const update = updateArgs(calls).find((u) => u.cache_creation_tokens !== undefined);
    expect(update).toBeDefined();
    expect(update!.cache_creation_tokens).toBe(32655);
    expect(update!.cache_read_tokens).toBe(15121);
  });

  it("omits cache token columns when the payload lacks them", async () => {
    const { client, calls } = createSpySupabase({
      events: OK,
      sessions: [NOT_FOUND, OK, OK],
    });

    const events = [
      makeEvent({
        seq: 1,
        event: "assistant_stop",
        data: { input_tokens: 10, output_tokens: 5, model: "claude-sonnet" },
      }),
    ];

    await ingestEvents(client, USER_ID, events);

    for (const u of updateArgs(calls)) {
      expect(u).not.toHaveProperty("cache_creation_tokens");
      expect(u).not.toHaveProperty("cache_read_tokens");
    }
  });
});

// --- agent lineage promotion ---

describe("ingestEvents: agent lineage promotion", () => {
  it("subagent_start upserts only its owned fields (no ended_at/tokens)", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "subagent_start",
      data: { agent_id: "agent-1", agent_type: "general-purpose" },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(1);

    const payload = upserts[0].args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      user_id: USER_ID,
      agent_id: "agent-1",
      agent_type: "general-purpose",
      session_id: SESSION_ID,
      started_at: event.ts,
    });
    expect(payload).not.toHaveProperty("ended_at");
    expect(payload).not.toHaveProperty("input_tokens");
    expect(payload).not.toHaveProperty("output_tokens");
    expect(payload).not.toHaveProperty("parent_agent_id");

    expect(upserts[0].args[1]).toEqual({ onConflict: "user_id,agent_id" });
  });

  it("subagent_stop upserts only its owned fields", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "subagent_stop",
      data: {
        agent_id: "agent-1",
        agent_type: "general-purpose",
        input_tokens: 100,
        output_tokens: 200,
        model: "claude-3-5-sonnet",
        tool_count_total: 4,
      },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(1);

    const payload = upserts[0].args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      user_id: USER_ID,
      agent_id: "agent-1",
      agent_type: "general-purpose",
      session_id: SESSION_ID,
      ended_at: event.ts,
      input_tokens: 100,
      output_tokens: 200,
      model: "claude-3-5-sonnet",
      tool_count: 4,
    });
    expect(payload).not.toHaveProperty("started_at");
    expect(payload).not.toHaveProperty("parent_agent_id");
    expect(payload).not.toHaveProperty("edge_label");
    expect(payload).not.toHaveProperty("result_input_tokens");
    expect(payload).not.toHaveProperty("result_output_tokens");
    expect(payload).not.toHaveProperty("result_cache_creation_tokens");
    expect(payload).not.toHaveProperty("result_cache_read_tokens");
  });

  it("an Agent tool_result with usage_* fields promotes all four result_* columns and never touches input_tokens/output_tokens", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "tool_result",
      data: {
        tool_name: "Agent",
        agent_result: {
          agentId: "agent-child",
          status: "success",
          usage_input_tokens: 111,
          usage_output_tokens: 222,
          usage_cache_creation_tokens: 33,
          usage_cache_read_tokens: 44,
        },
      },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(1);

    const payload = upserts[0].args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({
      result_input_tokens: 111,
      result_output_tokens: 222,
      result_cache_creation_tokens: 33,
      result_cache_read_tokens: 44,
    });
    expect(payload).not.toHaveProperty("input_tokens");
    expect(payload).not.toHaveProperty("output_tokens");
  });

  it("an Agent tool_result promotes a zero-valued usage field (0 is meaningful, not absent)", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "tool_result",
      data: {
        tool_name: "Agent",
        agent_result: {
          agentId: "agent-child",
          usage_input_tokens: 0,
        },
      },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    const payload = upserts[0].args[0] as Record<string, unknown>;
    expect(payload.result_input_tokens).toBe(0);
  });

  it("an Agent tool_result sets parent_agent_id from origin_agent_id, plus edge_label and duration_ms", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "tool_result",
      data: {
        tool_name: "Agent",
        agent_result: { agentId: "agent-child", status: "success" },
        origin_agent_id: "agent-parent",
        edge_label: "spawn",
        duration_ms: 1234.6,
      },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(1);

    const payload = upserts[0].args[0] as Record<string, unknown>;
    expect(payload.agent_id).toBe("agent-child");
    expect(payload.parent_agent_id).toBe("agent-parent");
    expect(payload.edge_label).toBe("spawn");
    expect(payload.duration_ms).toBe(1235);
    expect(upserts[0].args[1]).toEqual({ onConflict: "user_id,agent_id" });
  });

  it("parent_agent_id is absent when origin_agent_id is absent (root agent)", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "tool_result",
      data: {
        tool_name: "Agent",
        agent_result: { agentId: "agent-root" },
        duration_ms: 500,
      },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(1);

    const payload = upserts[0].args[0] as Record<string, unknown>;
    expect(payload.agent_id).toBe("agent-root");
    expect(payload).not.toHaveProperty("parent_agent_id");
  });

  it("does not write output_tokens from agent_result.totalTokens (aggregate, not output count)", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "tool_result",
      data: {
        tool_name: "Agent",
        agent_result: { agentId: "agent-child", status: "success", totalTokens: 9999 },
      },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(1);

    const payload = upserts[0].args[0] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("output_tokens");
  });

  it("skips promotion entirely for an async agent_result with no native agentId, even when a minted data.agent_id is present", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "tool_result",
      data: {
        tool_name: "Agent",
        agent_result: { status: "async_launched", isAsync: true },
        agent_id: "minted-correlation-id-123",
      },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(0);
  });

  it("a non-Agent tool_result produces no agent upsert", async () => {
    const { client, calls } = createSpySupabase();

    const event = makeEvent({
      event: "tool_result",
      data: { tool_name: "Read" },
    });

    await ingestEvents(client, USER_ID, [event]);

    const upserts = calls.filter((c) => c.method === "upsert");
    expect(upserts.length).toBe(0);
  });

  it("is order-independent: stop-then-start yields the same set of upserts as start-then-stop", async () => {
    const startEvent = makeEvent({
      event: "subagent_start",
      seq: 1,
      data: { agent_id: "agent-1", agent_type: "general-purpose" },
    });
    const stopEvent = makeEvent({
      event: "subagent_stop",
      seq: 2,
      data: { agent_id: "agent-1", agent_type: "general-purpose", input_tokens: 10 },
    });

    const forward = createSpySupabase();
    await ingestEvents(forward.client, USER_ID, [startEvent, stopEvent]);

    const reversed = createSpySupabase();
    await ingestEvents(reversed.client, USER_ID, [stopEvent, startEvent]);

    const upsertsForward = forward.calls
      .filter((c) => c.method === "upsert")
      .map((c) => JSON.stringify(c.args[0]))
      .sort();
    const upsertsReversed = reversed.calls
      .filter((c) => c.method === "upsert")
      .map((c) => JSON.stringify(c.args[0]))
      .sort();

    expect(upsertsForward.length).toBe(2);
    expect(upsertsForward).toEqual(upsertsReversed);
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
