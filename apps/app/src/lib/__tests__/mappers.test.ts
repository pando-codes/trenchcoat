import { describe, it, expect } from "bun:test";
import { mapDailyActivity, mapDailyCost, mapOverviewStats } from "../mappers";

// --- mapDailyActivity ---

describe("mapDailyActivity", () => {
  it("passes through fully-populated rows unchanged", () => {
    const result = mapDailyActivity([
      { date: "2025-05-01", sessions: 3, events: 12, tool_uses: 8 },
    ]);
    expect(result).toEqual([{ date: "2025-05-01", sessions: 3, events: 12, tool_uses: 8 }]);
  });

  it("coalesces null sessions to 0", () => {
    const result = mapDailyActivity([
      { date: "2025-05-01", sessions: null, events: 5, tool_uses: 2 },
    ]);
    expect(result[0].sessions).toBe(0);
  });

  it("coalesces null events to 0", () => {
    const result = mapDailyActivity([
      { date: "2025-05-01", sessions: 1, events: null, tool_uses: 2 },
    ]);
    expect(result[0].events).toBe(0);
  });

  it("coalesces null tool_uses to 0", () => {
    const result = mapDailyActivity([
      { date: "2025-05-01", sessions: 1, events: 5, tool_uses: null },
    ]);
    expect(result[0].tool_uses).toBe(0);
  });

  it("coalesces all nulls to 0 simultaneously", () => {
    const result = mapDailyActivity([
      { date: "2025-05-01", sessions: null, events: null, tool_uses: null },
    ]);
    expect(result[0]).toEqual({ date: "2025-05-01", sessions: 0, events: 0, tool_uses: 0 });
  });

  it("maps multiple rows", () => {
    const result = mapDailyActivity([
      { date: "2025-05-01", sessions: null, events: 2, tool_uses: null },
      { date: "2025-05-02", sessions: 4, events: null, tool_uses: 7 },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].sessions).toBe(0);
    expect(result[1].events).toBe(0);
  });

  it("returns empty array for empty input", () => {
    expect(mapDailyActivity([])).toEqual([]);
  });
});

// --- mapDailyCost ---

describe("mapDailyCost", () => {
  it("passes through fully-populated rows unchanged", () => {
    const result = mapDailyCost([
      { date: "2025-05-01", total_cost_usd: 1.5, input_tokens: 1000, output_tokens: 500 },
    ]);
    expect(result).toEqual([
      { date: "2025-05-01", total_cost_usd: 1.5, input_tokens: 1000, output_tokens: 500 },
    ]);
  });

  it("coalesces null total_cost_usd to 0", () => {
    const result = mapDailyCost([
      { date: "2025-05-01", total_cost_usd: null, input_tokens: 1000, output_tokens: 500 },
    ]);
    expect(result[0].total_cost_usd).toBe(0);
  });

  it("coalesces null input_tokens to 0", () => {
    const result = mapDailyCost([
      { date: "2025-05-01", total_cost_usd: 1.5, input_tokens: null, output_tokens: 500 },
    ]);
    expect(result[0].input_tokens).toBe(0);
  });

  it("coalesces null output_tokens to 0", () => {
    const result = mapDailyCost([
      { date: "2025-05-01", total_cost_usd: 1.5, input_tokens: 1000, output_tokens: null },
    ]);
    expect(result[0].output_tokens).toBe(0);
  });

  it("coalesces all nulls to 0 simultaneously", () => {
    const result = mapDailyCost([
      { date: "2025-05-01", total_cost_usd: null, input_tokens: null, output_tokens: null },
    ]);
    expect(result[0]).toEqual({
      date: "2025-05-01",
      total_cost_usd: 0,
      input_tokens: 0,
      output_tokens: 0,
    });
  });

  it("preserves the date string exactly", () => {
    const result = mapDailyCost([{ date: "2025-12-31", total_cost_usd: 0, input_tokens: 0, output_tokens: 0 }]);
    expect(result[0].date).toBe("2025-12-31");
  });

  it("returns empty array for empty input", () => {
    expect(mapDailyCost([])).toEqual([]);
  });
});

// --- mapOverviewStats ---

describe("mapOverviewStats", () => {
  it("returns all-zero defaults for null input", () => {
    const result = mapOverviewStats(null);
    expect(result).toEqual({
      total_sessions: 0,
      total_events: 0,
      total_tool_uses: 0,
      total_agent_calls: 0,
      active_days: 0,
      avg_session_duration_min: 0,
      avg_tools_per_session: 0,
    });
  });

  it("returns all-zero defaults for undefined input", () => {
    const result = mapOverviewStats(undefined);
    expect(result.total_sessions).toBe(0);
    expect(result.avg_tools_per_session).toBe(0);
  });

  it("returns all-zero defaults for non-object input", () => {
    expect(mapOverviewStats("bad data").total_sessions).toBe(0);
    expect(mapOverviewStats(42).total_sessions).toBe(0);
  });

  it("passes through a fully populated stats object", () => {
    const data = {
      total_sessions: 10,
      total_events: 200,
      total_tool_uses: 50,
      total_agent_calls: 5,
      active_days: 7,
      avg_session_duration_min: 12.5,
      avg_tools_per_session: 3.2,
    };
    const result = mapOverviewStats(data);
    expect(result).toEqual(data);
  });

  it("fills missing fields with 0 when only some fields are present", () => {
    const result = mapOverviewStats({ total_sessions: 3 });
    expect(result.total_sessions).toBe(3);
    expect(result.total_events).toBe(0);
    expect(result.avg_tools_per_session).toBe(0);
  });
});
