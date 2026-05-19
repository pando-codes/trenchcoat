import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let pricing: Record<string, { input_cost_per_token?: number; output_cost_per_token?: number }>;
  try {
    const res = await fetch(LITELLM_URL, { next: { revalidate: 0 } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    pricing = await res.json();
  } catch (err) {
    return NextResponse.json({ error: `Fetch failed: ${String(err)}` }, { status: 500 });
  }

  const rows = Object.entries(pricing)
    .filter(([key]) => key.startsWith("claude-"))
    .filter(([, v]) => v.input_cost_per_token != null && v.output_cost_per_token != null)
    .map(([model_id, v]) => ({
      model_id,
      input_cost_per_1m: Number((v.input_cost_per_token! * 1_000_000).toFixed(6)),
      output_cost_per_1m: Number((v.output_cost_per_token! * 1_000_000).toFixed(6)),
      updated_at: new Date().toISOString(),
    }));

  if (rows.length === 0) {
    return NextResponse.json({ error: "No Claude models found in pricing data" }, { status: 500 });
  }

  const supabase = getAdminClient();
  const { error } = await supabase
    .from("model_pricing")
    .upsert(rows, { onConflict: "model_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ synced: rows.length });
}
