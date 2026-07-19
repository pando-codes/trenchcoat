import { describe, it, expect } from "bun:test";
import {
  getOverviewStats,
  getDailyActivity,
  getTopTools,
  getHourlyHeatmap,
  getTopAgents,
  getAgentTimeseries,
  getSessionTree,
} from "../services/analytics.service";
import { createMockSupabase } from "./helpers/supabase-mock";

const USER_ID = "user-abc";
const FROM = "2025-04-01";
const TO = "2025-04-30";

// --- getOverviewStats ---

describe("getOverviewStats", () => {
  it("returns stats from RPC on success", async () => {
    const stats = {
      total_sessions: 10,
      total_events: 200,
      total_tool_uses: 50,
      total_agent_calls: 5,
      active_days: 7,
      avg_session_duration_min: 12.5,
      avg_tools_per_session: 3.2,
    };
    const supabase = createMockSupabase({}, { get_overview_stats: { data: stats } });
    const result = await getOverviewStats(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(stats);
  });

  it("returns RPC_FAILED on RPC error", async () => {
    const supabase = createMockSupabase({}, {
      get_overview_stats: { data: null, error: { message: "rpc failed" } },
    });
    const result = await getOverviewStats(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});

// --- getDailyActivity ---

describe("getDailyActivity", () => {
  it("returns mapped activity rows on success", async () => {
    const rows = [
      { date: "2025-04-01", sessions: 3, events: 12, tool_uses: 8 },
      { date: "2025-04-02", sessions: 1, events: 5, tool_uses: 2 },
    ];
    const supabase = createMockSupabase({
      daily_aggregates: { data: rows, error: null },
    });
    const result = await getDailyActivity(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].sessions).toBe(3);
    }
  });

  it("returns empty array when no aggregate rows exist", async () => {
    const supabase = createMockSupabase({
      daily_aggregates: { data: [], error: null },
    });
    const result = await getDailyActivity(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it("returns QUERY_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      daily_aggregates: { data: null, error: { message: "timeout" } },
    });
    const result = await getDailyActivity(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});

// --- getTopTools ---

describe("getTopTools", () => {
  it("returns tool rows with default trend of 0", async () => {
    const rows = [
      { tool_name: "Read", count: 50, avg_duration_ms: 100, p50_duration_ms: 90, p99_duration_ms: 200 },
      { tool_name: "Write", count: 30, avg_duration_ms: 80, p50_duration_ms: 70, p99_duration_ms: 150 },
    ];
    const supabase = createMockSupabase({}, { get_top_tools: { data: rows } });
    const result = await getTopTools(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].tool_name).toBe("Read");
      expect(result.data[0].count).toBe(50);
      // trend is always defaulted to 0 since the RPC doesn't return it
      expect(result.data[0].trend).toBe(0);
      expect(result.data[1].trend).toBe(0);
    }
  });

  it("returns empty array when RPC returns no rows", async () => {
    const supabase = createMockSupabase({}, { get_top_tools: { data: [] } });
    const result = await getTopTools(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_top_tools: { data: null, error: { message: "rpc error" } },
    });
    const result = await getTopTools(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});

// --- getHourlyHeatmap ---

describe("getHourlyHeatmap", () => {
  it("returns a full 7×24 grid (168 entries) for empty data", async () => {
    const supabase = createMockSupabase({
      daily_aggregates: { data: [], error: null },
    });
    const result = await getHourlyHeatmap(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(168);
      // all counts are zero when there is no data
      expect(result.data.every((e) => e.count === 0)).toBe(true);
    }
  });

  it("each entry has day_of_week (0–6), hour (0–23), and count fields", async () => {
    const supabase = createMockSupabase({
      daily_aggregates: { data: [], error: null },
    });
    const result = await getHourlyHeatmap(supabase, USER_ID, FROM, TO);
    if (result.success) {
      for (const entry of result.data) {
        expect(entry.day_of_week).toBeGreaterThanOrEqual(0);
        expect(entry.day_of_week).toBeLessThanOrEqual(6);
        expect(entry.hour).toBeGreaterThanOrEqual(0);
        expect(entry.hour).toBeLessThanOrEqual(23);
        expect(typeof entry.count).toBe("number");
      }
    }
  });

  it("accumulates counts from hourly_distribution arrays", async () => {
    const hourly = new Array(24).fill(0);
    hourly[9] = 5; // 5 events at hour 9
    hourly[14] = 3; // 3 events at hour 14

    const supabase = createMockSupabase({
      daily_aggregates: {
        data: [{ date: "2025-04-07", hourly_distribution: hourly }],
        error: null,
      },
    });
    const result = await getHourlyHeatmap(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) {
      const totalCount = result.data.reduce((sum, e) => sum + e.count, 0);
      expect(totalCount).toBe(8); // 5 + 3
    }
  });

  it("skips rows where hourly_distribution is not an array", async () => {
    const supabase = createMockSupabase({
      daily_aggregates: {
        data: [{ date: "2025-04-07", hourly_distribution: null }],
        error: null,
      },
    });
    const result = await getHourlyHeatmap(supabase, USER_ID, FROM, TO);
    if (result.success) {
      const totalCount = result.data.reduce((sum, e) => sum + e.count, 0);
      expect(totalCount).toBe(0);
    }
  });

  it("returns QUERY_FAILED on DB error", async () => {
    const supabase = createMockSupabase({
      daily_aggregates: { data: null, error: { message: "DB error" } },
    });
    const result = await getHourlyHeatmap(supabase, USER_ID, FROM, TO);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});

// --- getTopAgents ---

describe("getTopAgents", () => {
  it("maps agent rows including cost and tokens", async () => {
    const rows = [
      { agent_type: "searcher", count: 12, avg_tool_count: 6, avg_turns: 4,
        trend: 45.0, total_input_tokens: 90000, total_output_tokens: 12000, total_cost_usd: 0.42 },
    ];
    const supabase = createMockSupabase({}, { get_top_agents: { data: rows } });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].agent_type).toBe("searcher");
      expect(result.data[0].total_cost_usd).toBe(0.42);
      expect(result.data[0].total_input_tokens).toBe(90000);
    }
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_top_agents: { data: null, error: { message: "boom" } },
    });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});

describe("getTopAgents latency fields", () => {
  it("maps latency fields through", async () => {
    const rows = [{
      agent_type: "searcher", count: 12, avg_tool_count: 6, avg_turns: 4, trend: null,
      total_input_tokens: 100, total_output_tokens: 20, total_cost_usd: 0.42,
      p50_latency_ms: 1200, p99_latency_ms: 4300, latency_sample_count: 12,
    }];
    const supabase = createMockSupabase({}, { get_top_agents: { data: rows } });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].p50_latency_ms).toBe(1200);
      expect(result.data[0].p99_latency_ms).toBe(4300);
      expect(result.data[0].latency_sample_count).toBe(12);
    }
  });

  it("defaults missing latency to null/0 (old plugin data)", async () => {
    const rows = [{
      agent_type: "old", count: 3, avg_tool_count: 1, avg_turns: 1, trend: null,
      total_input_tokens: 0, total_output_tokens: 0, total_cost_usd: 0,
    }];
    const supabase = createMockSupabase({}, { get_top_agents: { data: rows } });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    if (result.success) {
      expect(result.data[0].p50_latency_ms).toBeNull();
      expect(result.data[0].latency_sample_count).toBe(0);
    }
  });
});

// --- getAgentTimeseries ---

describe("getAgentTimeseries", () => {
  it("maps timeseries rows on success", async () => {
    const rows = [
      { bucket: "2025-04-01", invocations: 3, input_tokens: 30000, output_tokens: 4000, cost_usd: 0.12 },
    ];
    const supabase = createMockSupabase({}, { get_agent_timeseries: { data: rows } });
    const result = await getAgentTimeseries(supabase, USER_ID, "searcher", FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].cost_usd).toBe(0.12);
      expect(result.data[0].invocations).toBe(3);
    }
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_agent_timeseries: { data: null, error: { message: "boom" } },
    });
    const result = await getAgentTimeseries(supabase, USER_ID, "searcher", FROM, TO);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});

describe("getAgentTimeseries latency fields", () => {
  it("maps p50 latency and sample count", async () => {
    const rows = [{
      bucket: "2025-04-01", invocations: 3, input_tokens: 10, output_tokens: 2,
      cost_usd: 0.05, p50_latency_ms: 900, latency_sample_count: 3,
    }];
    const supabase = createMockSupabase({}, { get_agent_timeseries: { data: rows } });
    const result = await getAgentTimeseries(supabase, USER_ID, "searcher", FROM, TO);
    if (result.success) {
      expect(result.data[0].p50_latency_ms).toBe(900);
      expect(result.data[0].latency_sample_count).toBe(3);
    }
  });
});

// --- getSessionTree ---

describe("getSessionTree", () => {
  it("maps tree nodes including duration and cost", async () => {
    const rows = [
      { session_id: "root", parent_session_id: null, spawner_id: null, spawner_type: null,
        depth: 0, started_at: "2025-04-01T00:00:00Z", ended_at: "2025-04-01T00:01:00Z",
        duration_ms: 60000, tool_count: 4, skill_count: 0, subagent_count: 2,
        input_tokens: 1000, output_tokens: 200, estimated_cost_usd: 0.05 },
    ];
    const supabase = createMockSupabase({}, { get_session_tree: { data: rows } });
    const result = await getSessionTree(supabase, USER_ID, "root");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].duration_ms).toBe(60000);
      expect(result.data[0].estimated_cost_usd).toBe(0.05);
    }
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_session_tree: { data: null, error: { message: "boom" } },
    });
    const result = await getSessionTree(supabase, USER_ID, "root");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});
