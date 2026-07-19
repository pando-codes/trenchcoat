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
  trend: number | null;
}

export interface HourlyHeatmapEntry {
  day_of_week: number;
  hour: number;
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
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  parent_session_id: string | null;
  spawner_id: string | null;
  spawner_type: "skill" | "agent" | null;
}

export interface AgentStat {
  agent_type: string;
  count: number;
  avg_tool_count: number | null;
  avg_turns: number | null;
  trend: number | null;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_cost_usd: number | null;
  p50_latency_ms: number | null;
  p99_latency_ms: number | null;
  latency_sample_count: number;
}

export interface SkillStat {
  skill_name: string;
  invocation_count: number;
  tool_calls_triggered: number;
  avg_tools_per_invocation: number;
  cross_session_tool_calls: number;
}

export interface DailyCost {
  date: string;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
}

export interface ModelCost {
  model: string;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
}

export interface DateRange {
  from: Date;
  to: Date;
}

export interface SessionTreeNode {
  session_id: string;
  parent_session_id: string | null;
  spawner_id: string | null;
  spawner_type: "skill" | "agent" | null;
  depth: number;
  started_at: string;
  ended_at: string | null;
  tool_count: number;
  skill_count: number;
  subagent_count: number;
  input_tokens: number;
  output_tokens: number;
  duration_ms: number;
  estimated_cost_usd: number;
  edge_label: string | null;
}

export interface EntityRollup {
  total_tools: number;
  total_skills: number;
  total_subagents: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}

export interface AgentTimeseriesPoint {
  bucket: string;
  invocations: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  p50_latency_ms: number | null;
  latency_sample_count: number;
}
