import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  OverviewStats,
  DailyActivity,
  ToolUsageStat,
  HourlyHeatmapEntry,
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
