import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EvalListEntry,
  EvalVariantStat,
  EvalScoreSummary,
} from "@/types/analytics";
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

export async function getEvalList(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  apiKeyId?: string
): Promise<ServiceResult<EvalListEntry[]>> {
  const { data, error } = await supabase.rpc("get_eval_list", {
    p_user_id: userId,
    p_from: from,
    p_to: to,
    p_api_key_id: apiKeyId ?? null,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get eval list", details: error.message },
    };
  }

  return { success: true, data: (data as EvalListEntry[]) ?? [] };
}

export async function getEvalComparison(
  supabase: SupabaseClient,
  userId: string,
  evalId: string
): Promise<ServiceResult<EvalVariantStat[]>> {
  const { data, error } = await supabase.rpc("get_eval_comparison", {
    p_user_id: userId,
    p_eval_id: evalId,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get eval comparison", details: error.message },
    };
  }

  const variants: EvalVariantStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    eval_variant: row.eval_variant as string,
    session_count: (row.session_count as number) ?? 0,
    total_input_tokens: (row.total_input_tokens as number) ?? 0,
    total_output_tokens: (row.total_output_tokens as number) ?? 0,
    total_cost_usd: (row.total_cost_usd as number) ?? 0,
    avg_duration_ms: (row.avg_duration_ms as number | null) ?? null,
    scores: (row.scores as Record<string, EvalScoreSummary>) ?? {},
  }));

  return { success: true, data: variants };
}
