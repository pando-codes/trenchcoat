import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OverviewStats,
  DailyActivity,
  ToolUsageStat,
  HourlyHeatmapEntry,
  AgentStat,
  AgentTimeseriesPoint,
  SessionTreeNode,
  AgentTreeNode,
} from "@/types/analytics";
import type { ServiceResult } from "./types";

// ---------------------------------------------------------------------------
// Overview stats
// ---------------------------------------------------------------------------

export async function getOverviewStats(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<ServiceResult<OverviewStats>> {
  const { data, error } = await supabase.rpc("get_overview_stats", {
    p_user_id: userId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return {
      success: false,
      error: {
        code: "RPC_FAILED",
        message: "Failed to get overview stats",
        details: error.message,
      },
    };
  }

  return { success: true, data: data as OverviewStats };
}

// ---------------------------------------------------------------------------
// Daily activity (chart data)
// ---------------------------------------------------------------------------

export async function getDailyActivity(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<ServiceResult<DailyActivity[]>> {
  const { data, error } = await supabase
    .from("daily_aggregates")
    .select("date, sessions, events, tool_uses")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });

  if (error) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to get daily activity",
        details: error.message,
      },
    };
  }

  const activity: DailyActivity[] = (data ?? []).map((row) => ({
    date: row.date,
    sessions: row.sessions,
    events: row.events,
    tool_uses: row.tool_uses,
  }));

  return { success: true, data: activity };
}

// ---------------------------------------------------------------------------
// Top tools
// ---------------------------------------------------------------------------

export async function getTopTools(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<ServiceResult<ToolUsageStat[]>> {
  const { data, error } = await supabase.rpc("get_top_tools", {
    p_user_id: userId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return {
      success: false,
      error: {
        code: "RPC_FAILED",
        message: "Failed to get top tools",
        details: error.message,
      },
    };
  }

  // The RPC returns tool stats without a trend field; default trend to 0.
  const tools: ToolUsageStat[] = ((data as Record<string, unknown>[]) ?? []).map(
    (row) => ({
      tool_name: row.tool_name as string,
      count: row.count as number,
      avg_duration_ms: (row.avg_duration_ms as number) ?? null,
      p50_duration_ms: (row.p50_duration_ms as number) ?? null,
      p99_duration_ms: (row.p99_duration_ms as number) ?? null,
      trend: 0,
    })
  );

  return { success: true, data: tools };
}

// ---------------------------------------------------------------------------
// Hourly heatmap
// ---------------------------------------------------------------------------

export async function getHourlyHeatmap(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<ServiceResult<HourlyHeatmapEntry[]>> {
  const { data, error } = await supabase
    .from("daily_aggregates")
    .select("date, hourly_distribution")
    .eq("user_id", userId)
    .gte("date", from)
    .lte("date", to);

  if (error) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to get heatmap data",
        details: error.message,
      },
    };
  }

  // Accumulate hourly counts by day-of-week and hour
  const buckets = new Map<string, number>(); // "dow:hour" -> count

  for (const row of data ?? []) {
    const dayOfWeek = new Date(row.date).getDay(); // 0 = Sun
    const hourly = row.hourly_distribution as number[];

    if (!Array.isArray(hourly)) continue;

    for (let hour = 0; hour < hourly.length && hour < 24; hour++) {
      const key = `${dayOfWeek}:${hour}`;
      buckets.set(key, (buckets.get(key) ?? 0) + (hourly[hour] ?? 0));
    }
  }

  // Build full 7x24 grid
  const entries: HourlyHeatmapEntry[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      entries.push({
        day_of_week: dow,
        hour,
        count: buckets.get(`${dow}:${hour}`) ?? 0,
      });
    }
  }

  return { success: true, data: entries };
}

// ---------------------------------------------------------------------------
// Top agents
// ---------------------------------------------------------------------------

export async function getTopAgents(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  limit = 50
): Promise<ServiceResult<AgentStat[]>> {
  const { data, error } = await supabase.rpc("get_top_agents", {
    p_user_id: userId,
    p_from: from,
    p_to: to,
    p_limit: limit,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get top agents", details: error.message },
    };
  }

  const agents: AgentStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    agent_type: row.agent_type as string,
    count: row.count as number,
    avg_tool_count: (row.avg_tool_count as number | null) ?? null,
    avg_turns: (row.avg_turns as number | null) ?? null,
    trend: (row.trend as number | null) ?? null,
    total_input_tokens: (row.total_input_tokens as number | null) ?? null,
    total_output_tokens: (row.total_output_tokens as number | null) ?? null,
    total_cost_usd: (row.total_cost_usd as number | null) ?? null,
    p50_latency_ms: (row.p50_latency_ms as number | null) ?? null,
    p99_latency_ms: (row.p99_latency_ms as number | null) ?? null,
    latency_sample_count: (row.latency_sample_count as number) ?? 0,
  }));

  return { success: true, data: agents };
}

// ---------------------------------------------------------------------------
// Agent timeseries
// ---------------------------------------------------------------------------

export async function getAgentTimeseries(
  supabase: SupabaseClient,
  userId: string,
  agentType: string,
  from: string,
  to: string
): Promise<ServiceResult<AgentTimeseriesPoint[]>> {
  const { data, error } = await supabase.rpc("get_agent_timeseries", {
    p_user_id: userId,
    p_agent_type: agentType,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get agent timeseries", details: error.message },
    };
  }

  const points: AgentTimeseriesPoint[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    bucket: row.bucket as string,
    invocations: row.invocations as number,
    input_tokens: (row.input_tokens as number) ?? 0,
    output_tokens: (row.output_tokens as number) ?? 0,
    cost_usd: (row.cost_usd as number) ?? 0,
    p50_latency_ms: (row.p50_latency_ms as number | null) ?? null,
    latency_sample_count: (row.latency_sample_count as number) ?? 0,
  }));

  return { success: true, data: points };
}

// ---------------------------------------------------------------------------
// Session tree
// ---------------------------------------------------------------------------

export async function getSessionTree(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<ServiceResult<SessionTreeNode[]>> {
  const { data, error } = await supabase.rpc("get_session_tree", {
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get session tree", details: error.message },
    };
  }

  return { success: true, data: (data as SessionTreeNode[]) ?? [] };
}

// ---------------------------------------------------------------------------
// Agent tree
// ---------------------------------------------------------------------------

export async function getAgentTree(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<ServiceResult<AgentTreeNode[]>> {
  const { data, error } = await supabase.rpc("get_agent_tree", {
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get agent tree", details: error.message },
    };
  }

  return { success: true, data: (data as AgentTreeNode[]) ?? [] };
}
