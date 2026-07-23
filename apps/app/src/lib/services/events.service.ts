import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelemetryEvent, IngestEvent } from "@/types/events";
import type { ServiceResult } from "./types";

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export async function ingestEvents(
  adminClient: SupabaseClient,
  userId: string,
  events: IngestEvent[],
  apiKeyId: string | null = null
): Promise<ServiceResult<{ inserted: number }>> {
  if (events.length === 0) {
    return { success: true, data: { inserted: 0 } };
  }

  // Build rows for the events table
  const rows = events.map((e) => ({
    user_id: userId,
    session_id: e.session_id,
    event_type: e.event,
    timestamp: e.ts,
    seq: e.seq,
    tool_name: (e.data?.tool_name as string) ?? null,
    duration_ms: e.data?.duration_ms != null ? Math.round(e.data.duration_ms as number) : null,
    data: e.data,
  }));

  const { error: insertError } = await adminClient
    .from("events")
    .insert(rows);

  if (insertError) {
    return {
      success: false,
      error: {
        code: "INGEST_FAILED",
        message: "Failed to insert events",
        details: insertError.message,
      },
    };
  }

  // -----------------------------------------------------------------------
  // Upsert session records
  // -----------------------------------------------------------------------
  const sessionMap = new Map<
    string,
    { minTs: string; maxTs: string; eventCount: number; toolCount: number }
  >();

  for (const e of events) {
    const existing = sessionMap.get(e.session_id);
    const isTool = e.event === "tool_use" || e.event === "tool_result";

    if (!existing) {
      sessionMap.set(e.session_id, {
        minTs: e.ts,
        maxTs: e.ts,
        eventCount: 1,
        toolCount: isTool ? 1 : 0,
      });
    } else {
      if (e.ts < existing.minTs) existing.minTs = e.ts;
      if (e.ts > existing.maxTs) existing.maxTs = e.ts;
      existing.eventCount += 1;
      if (isTool) existing.toolCount += 1;
    }
  }

  for (const [sessionId, info] of sessionMap) {
    // Try to fetch existing session
    const { data: existingSession } = await adminClient
      .from("sessions")
      .select("id, started_at, ended_at, event_count, tool_count, api_key_id")
      .eq("session_id", sessionId)
      .eq("user_id", userId)
      .single();

    if (existingSession) {
      const newEndedAt =
        !existingSession.ended_at || info.maxTs > existingSession.ended_at
          ? info.maxTs
          : existingSession.ended_at;
      const newStartedAt =
        info.minTs < existingSession.started_at
          ? info.minTs
          : existingSession.started_at;
      const newEventCount =
        (existingSession.event_count ?? 0) + info.eventCount;
      const newToolCount =
        (existingSession.tool_count ?? 0) + info.toolCount;
      const durationMs =
        new Date(newEndedAt).getTime() - new Date(newStartedAt).getTime();

      // Back-fill attribution for sessions created before we had a key
      // (or before this column existed); never overwrite an existing value.
      const nextApiKeyId =
        (existingSession.api_key_id as string | null) ?? apiKeyId;

      await adminClient
        .from("sessions")
        .update({
          started_at: newStartedAt,
          ended_at: newEndedAt,
          duration_ms: durationMs > 0 ? durationMs : null,
          event_count: newEventCount,
          tool_count: newToolCount,
          api_key_id: nextApiKeyId,
        })
        .eq("id", existingSession.id);
    } else {
      const durationMs =
        new Date(info.maxTs).getTime() - new Date(info.minTs).getTime();

      await adminClient.from("sessions").insert({
        session_id: sessionId,
        user_id: userId,
        started_at: info.minTs,
        ended_at: info.maxTs,
        duration_ms: durationMs > 0 ? durationMs : null,
        event_count: info.eventCount,
        tool_count: info.toolCount,
        api_key_id: apiKeyId,
      });
    }
  }

  // -----------------------------------------------------------------------
  // Write token data and model from stop events to the session row
  // -----------------------------------------------------------------------
  for (const e of events) {
    if (e.event === "assistant_stop") {
      const inputTokens = (e.data?.input_tokens as number | null) ?? null;
      const outputTokens = (e.data?.output_tokens as number | null) ?? null;
      const model = (e.data?.model as string | null) ?? null;
      const reason = (e.data?.reason as string | null) ?? null;
      const cacheCreationTokens = (e.data?.cache_creation_tokens as number | null) ?? null;
      const cacheReadTokens = (e.data?.cache_read_tokens as number | null) ?? null;

      const update: Record<string, unknown> = {};
      if (inputTokens !== null) update.input_tokens = inputTokens;
      if (outputTokens !== null) update.output_tokens = outputTokens;
      if (model !== null) update.model = model;
      if (reason !== null) update.stop_reason = reason;
      if (cacheCreationTokens !== null) update.cache_creation_tokens = cacheCreationTokens;
      if (cacheReadTokens !== null) update.cache_read_tokens = cacheReadTokens;

      if (Object.keys(update).length > 0) {
        await adminClient
          .from("sessions")
          .update(update)
          .eq("session_id", e.session_id)
          .eq("user_id", userId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Write parent session linkage from session_start events
  // -----------------------------------------------------------------------
  for (const e of events) {
    if (e.event === "session_start") {
      const parentSessionId = (e.data?.parent_session_id as string) ?? null;
      const spawnerId = (e.data?.spawner_id as string) ?? null;
      const spawnerType = (e.data?.spawner_type as string) ?? null;
      const evalId = (e.data?.eval_id as string) ?? null;
      const evalVariant = (e.data?.eval_variant as string) ?? null;

      if (parentSessionId || spawnerId || evalId || evalVariant) {
        const update: Record<string, unknown> = {};
        if (parentSessionId) update.parent_session_id = parentSessionId;
        if (spawnerId) update.spawner_id = spawnerId;
        if (spawnerType) update.spawner_type = spawnerType;
        if (evalId) update.eval_id = evalId;
        if (evalVariant) update.eval_variant = evalVariant;

        await adminClient
          .from("sessions")
          .update(update)
          .eq("session_id", e.session_id)
          .eq("user_id", userId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Promote agent lineage rows. Each event contributes only the columns it
  // owns, so the three can arrive in any order without clobbering each other.
  // -----------------------------------------------------------------------
  for (const e of events) {
    let agentId: string | null = null;
    const row: Record<string, unknown> = {};

    if (e.event === "subagent_start") {
      agentId = (e.data?.agent_id as string) ?? null;
      if (agentId) {
        row.session_id = e.session_id;
        row.started_at = e.ts;
        const agentType = e.data?.agent_type as string | undefined;
        if (agentType) row.agent_type = agentType;
      }
    } else if (e.event === "subagent_stop") {
      agentId = (e.data?.agent_id as string) ?? null;
      if (agentId) {
        row.session_id = e.session_id;
        row.ended_at = e.ts;
        const agentType = e.data?.agent_type as string | undefined;
        if (agentType) row.agent_type = agentType;
        if (e.data?.input_tokens != null) row.input_tokens = e.data.input_tokens;
        if (e.data?.output_tokens != null) row.output_tokens = e.data.output_tokens;
        if (e.data?.model != null) row.model = e.data.model;
        if (e.data?.tool_count_total != null) row.tool_count = e.data.tool_count_total;
      }
    } else if (e.event === "tool_result" && e.data?.tool_name === "Agent") {
      const result = (e.data?.agent_result ?? {}) as Record<string, unknown>;
      // Only the native id (result.agentId) is usable here: subagent_start/stop
      // key their rows on Claude Code's native agent id, and a locally-minted
      // fallback id (data.agent_id, for async results that lack agentId) would
      // never match those rows, producing an orphan agent + phantom edge.
      agentId = (result.agentId as string) ?? null;
      if (agentId) {
        row.session_id = e.session_id;
        // origin_agent_id is the agent that MADE this spawn call = the parent.
        // Its absence means the call came from the main thread, i.e. a root.
        const originAgentId = e.data?.origin_agent_id as string | undefined;
        if (originAgentId) row.parent_agent_id = originAgentId;
        if (e.data?.edge_label != null) row.edge_label = e.data.edge_label;
        if (e.data?.duration_ms != null) row.duration_ms = Math.round(e.data.duration_ms as number);
        if (result.status != null) row.status = result.status;
        if (result.resolvedModel != null) row.model = result.resolvedModel;
        if (result.usage_input_tokens != null) row.result_input_tokens = result.usage_input_tokens;
        if (result.usage_output_tokens != null) row.result_output_tokens = result.usage_output_tokens;
        if (result.usage_cache_creation_tokens != null)
          row.result_cache_creation_tokens = result.usage_cache_creation_tokens;
        if (result.usage_cache_read_tokens != null)
          row.result_cache_read_tokens = result.usage_cache_read_tokens;
      }
    }

    if (agentId && Object.keys(row).length > 0) {
      await adminClient
        .from("agents")
        .upsert({ user_id: userId, agent_id: agentId, ...row },
                { onConflict: "user_id,agent_id" });
    }
  }

  // -----------------------------------------------------------------------
  // Update daily aggregates for each affected date
  // -----------------------------------------------------------------------
  const affectedDates = new Set<string>();
  for (const e of events) {
    const date = e.ts.substring(0, 10); // "YYYY-MM-DD"
    affectedDates.add(date);
  }

  for (const date of affectedDates) {
    await adminClient.rpc("update_daily_aggregate", {
      p_user_id: userId,
      p_date: date,
    });
  }

  return { success: true, data: { inserted: rows.length } };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

export interface EventFilters {
  session_id?: string;
  event_type?: string;
  from?: string; // ISO date string
  to?: string;
  limit?: number;
  offset?: number;
}

export async function queryEvents(
  supabase: SupabaseClient,
  userId: string,
  filters: EventFilters
): Promise<ServiceResult<{ events: TelemetryEvent[]; total: number }>> {
  let query = supabase
    .from("events")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("timestamp", { ascending: false });

  if (filters.session_id) {
    query = query.eq("session_id", filters.session_id);
  }
  if (filters.event_type) {
    query = query.eq("event_type", filters.event_type);
  }
  if (filters.from) {
    query = query.gte("timestamp", filters.from);
  }
  if (filters.to) {
    query = query.lte("timestamp", filters.to);
  }

  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;
  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to query events",
        details: error.message,
      },
    };
  }

  return {
    success: true,
    data: {
      events: (data as TelemetryEvent[]) ?? [],
      total: count ?? 0,
    },
  };
}
