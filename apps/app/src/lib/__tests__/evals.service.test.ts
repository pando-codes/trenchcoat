import { describe, it, expect } from "bun:test";
import { upsertEvalScores } from "../services/evals.service";
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
