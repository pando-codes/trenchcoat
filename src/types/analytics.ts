export interface OverviewStats {
  total_sessions: number;
  total_events: number;
  total_tool_uses: number;
  total_agent_calls: number;
  active_days: number;
  avg_session_duration_min: number;
  avg_tools_per_session: number;
}

export interface DailyActivity {
  date: string;
  sessions: number;
  events: number;
  tool_uses: number;
}

export interface ToolUsageStat {
  tool_name: string;
  count: number;
  avg_duration_ms: number | null;
  p50_duration_ms: number | null;
  p99_duration_ms: number | null;
  trend: number | null; // % change vs previous period, null when no prior data
}

export interface HourlyHeatmapEntry {
  day_of_week: number; // 0 = Sun
  hour: number; // 0-23
  count: number;
}

export interface SessionSummary {
  id: string;
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  event_count: number;
  tool_count: number;
  stop_reason: string | null;
  git_branch: string | null;
  working_directory: string | null;
}

export interface AgentStat {
  agent_type: string;
  count: number;
  avg_tool_count: number | null;
  avg_turns: number | null;
  trend: number | null;
}

export interface DateRange {
  from: Date;
  to: Date;
}
