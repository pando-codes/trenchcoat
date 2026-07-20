import { describe, it, expect } from "bun:test";
import { upsertEvalScores, getEvalList, getEvalComparison } from "../services/evals.service";
import { createMockSupabase } from "./helpers/supabase-mock";

const USER_ID = "user-abc";

describe("upsertEvalScores", () => {
  it("returns the number of scores written on success", async () => {
    const supabase = createMockSupabase({ eval_scores: { data: [], error: null } });
    const result = await upsertEvalScores(supabase, USER_ID, [
      { session_id: "s1", metric: "accuracy", value: 0.82 },
      { session_id: "s1", metric: "pass_rate", value: 1 },
    ]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inserted).toBe(2);
  });

  it("returns QUERY_FAILED on db error", async () => {
    const supabase = createMockSupabase({
      eval_scores: { data: null, error: { message: "boom" } },
    });
    const result = await upsertEvalScores(supabase, USER_ID, [
      { session_id: "s1", metric: "accuracy", value: 0.5 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});

describe("getEvalList", () => {
  it("maps eval rows", async () => {
    const rows = [{ eval_id: "deep-research", variant_count: 2, session_count: 9, last_run: "2026-07-19T00:00:00Z" }];
    const supabase = createMockSupabase({}, { get_eval_list: { data: rows } });
    const result = await getEvalList(supabase, USER_ID, "2026-07-01", "2026-07-19");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].variant_count).toBe(2);
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, { get_eval_list: { data: null, error: { message: "boom" } } });
    const result = await getEvalList(supabase, USER_ID, "2026-07-01", "2026-07-19");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});

describe("getEvalComparison", () => {
  it("maps variant stats including scores", async () => {
    const rows = [{
      eval_variant: "v3", session_count: 5, total_input_tokens: 100, total_output_tokens: 20,
      total_cost_usd: 1.25, avg_duration_ms: 42000,
      scores: { accuracy: { avg: 0.82, count: 5 } },
    }];
    const supabase = createMockSupabase({}, { get_eval_comparison: { data: rows } });
    const result = await getEvalComparison(supabase, USER_ID, "deep-research");
    if (result.success) {
      expect(result.data[0].eval_variant).toBe("v3");
      expect(result.data[0].scores.accuracy.avg).toBeCloseTo(0.82);
      expect(result.data[0].scores.accuracy.count).toBe(5);
    }
  });

  it("defaults missing scores to an empty object", async () => {
    const rows = [{
      eval_variant: "v2", session_count: 1, total_input_tokens: 0, total_output_tokens: 0,
      total_cost_usd: 0, avg_duration_ms: null,
    }];
    const supabase = createMockSupabase({}, { get_eval_comparison: { data: rows } });
    const result = await getEvalComparison(supabase, USER_ID, "deep-research");
    if (result.success) expect(result.data[0].scores).toEqual({});
  });
});
