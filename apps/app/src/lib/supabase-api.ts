import { createClient } from "@/lib/supabase/client";
import type { DailyActivity, OverviewStats, SessionSummary, ToolUsageStat } from "@/types/analytics";

const supabase = createClient();

export async function fetchOverviewStats(from: string, to: string): Promise<OverviewStats> {
  const { data, error } = await supabase.rpc("get_overview_stats", {
    p_user_id: (await supabase.auth.getUser()).data.user?.id,
    p_from: from,
    p_to: to,
  });
  if (error) throw error;
  return data as OverviewStats;
}

export async function fetchDailyActivity(from: string, to: string): Promise<DailyActivity[]> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("daily_aggregates")
    .select("date, sessions, events, tool_uses")
    .eq("user_id", user?.id)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data || []) as DailyActivity[];
}

export async function fetchTopTools(from: string, to: string): Promise<ToolUsageStat[]> {
  const { data, error } = await supabase.rpc("get_top_tools", {
    p_user_id: (await supabase.auth.getUser()).data.user?.id,
    p_from: from,
    p_to: to,
    p_limit: 20,
  });
  if (error) throw error;
  return (data || []) as ToolUsageStat[];
}

export async function fetchSessions(
  limit = 50,
  offset = 0
): Promise<{ sessions: SessionSummary[]; total: number }> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error, count } = await supabase
    .from("sessions")
    .select("*", { count: "exact" })
    .eq("user_id", user?.id)
    .order("started_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return { sessions: (data || []) as SessionSummary[], total: count || 0 };
}

export async function fetchSession(sessionId: string): Promise<SessionSummary | null> {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", user?.id)
    .eq("session_id", sessionId)
    .single();
  if (error) return null;
  return data as SessionSummary;
}
