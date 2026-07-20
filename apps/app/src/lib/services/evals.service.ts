import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceResult } from "./types";

export interface EvalScoreInput {
  session_id: string;
  metric: string;
  value: number;
}

export async function upsertEvalScores(
  supabase: SupabaseClient,
  userId: string,
  scores: EvalScoreInput[]
): Promise<ServiceResult<{ inserted: number }>> {
  const rows = scores.map((s) => ({
    user_id: userId,
    session_id: s.session_id,
    metric: s.metric,
    value: s.value,
  }));

  const { error } = await supabase
    .from("eval_scores")
    .upsert(rows, { onConflict: "user_id,session_id,metric" });

  if (error) {
    return {
      success: false,
      error: { code: "QUERY_FAILED", message: "Failed to write eval scores", details: error.message },
    };
  }

  return { success: true, data: { inserted: rows.length } };
}
