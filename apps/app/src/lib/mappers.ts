import type { DailyActivity, DailyCost, OverviewStats } from "@/types/analytics";

type NullableActivityRow = {
  date: string;
  sessions: number | null;
  events: number | null;
  tool_uses: number | null;
};

export function mapDailyActivity(rows: NullableActivityRow[]): DailyActivity[] {
  return rows.map((row) => ({
    date: row.date,
    sessions: row.sessions ?? 0,
    events: row.events ?? 0,
    tool_uses: row.tool_uses ?? 0,
  }));
}

export function mapDailyCost(rows: Record<string, unknown>[]): DailyCost[] {
  return rows.map((row) => ({
    date: row.date as string,
    total_cost_usd: (row.total_cost_usd as number | null) ?? 0,
    input_tokens: (row.input_tokens as number | null) ?? 0,
    output_tokens: (row.output_tokens as number | null) ?? 0,
  }));
}

const OVERVIEW_DEFAULTS: OverviewStats = {
  total_sessions: 0,
  total_events: 0,
  total_tool_uses: 0,
  total_agent_calls: 0,
  active_days: 0,
  avg_session_duration_min: 0,
  avg_tools_per_session: 0,
};

export function mapOverviewStats(data: unknown): OverviewStats {
  if (!data || typeof data !== "object") return OVERVIEW_DEFAULTS;
  return { ...OVERVIEW_DEFAULTS, ...(data as Partial<OverviewStats>) };
}
