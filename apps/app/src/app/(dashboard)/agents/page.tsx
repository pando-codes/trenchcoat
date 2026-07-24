import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AgentCallsChart } from "@/components/charts/agent-calls-chart";
import { TopAgentsTable } from "@/components/agents/top-agents-table";
import { getTopAgents } from "@/lib/services/analytics.service";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; api_key_id?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { from, to, api_key_id } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);
  const apiKeyId = api_key_id || undefined;

  const [agentsResult, dailyResult] = await Promise.all([
    getTopAgents(supabase, user.id, p_from, p_to, 50, apiKeyId),
    // Machine filter active → recompute agent_calls per day from raw events.
    apiKeyId
      ? supabase.rpc("get_daily_activity_for_key", {
          p_user_id: user.id,
          p_from,
          p_to,
          p_api_key_id: apiKeyId,
        })
      : supabase
          .from("daily_aggregates")
          .select("date, agent_calls")
          .eq("user_id", user.id)
          .gte("date", p_from)
          .lte("date", p_to)
          .order("date", { ascending: true }),
  ]);

  const agents = agentsResult.success ? agentsResult.data : [];

  const dailyData: { date: string; agent_calls: number }[] = (
    (dailyResult.data as { date: string; agent_calls: number }[]) ?? []
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
        <p className="text-sm text-muted-foreground">
          Subagent usage analytics.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Agent Calls Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <AgentCallsChart data={dailyData} />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        Cost excludes cache tokens. Per-agent cache-aware cost is on each session&apos;s detail page.
      </p>

      {agents.length > 0 && agents.every((a) => a.latency_sample_count === 0) && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          Per-agent latency needs Trenchcoat plugin v1.2.0 or newer. Update the plugin to start
          capturing it — existing data is unaffected.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Top Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <TopAgentsTable agents={agents} />
        </CardContent>
      </Card>
    </div>
  );
}
