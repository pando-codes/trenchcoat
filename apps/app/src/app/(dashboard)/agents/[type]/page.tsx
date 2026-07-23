import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentTimeseries } from "@/lib/services/analytics.service";
import { summariseAgentTimeseries } from "@/lib/analytics/agent-timeseries";
import { formatUsd, formatTokens, formatLatency } from "@/lib/format/agents";
import { AgentTrendChart } from "@/components/charts/agent-trend-chart";

export default async function AgentDetailPage({
  params, searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ from?: string; to?: string; api_key_id?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { type } = await params;
  const agentType = decodeURIComponent(type);
  const { from, to, api_key_id } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);

  const tsResult = await getAgentTimeseries(supabase, user.id, agentType, p_from, p_to, api_key_id || undefined);
  const points = tsResult.success ? tsResult.data : [];
  const summary = summariseAgentTimeseries(points);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link href="/agents" className="text-sm text-muted-foreground hover:underline">← Agents</Link>
        <h1 className="text-2xl font-semibold tracking-tight">{agentType}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Invocations" value={String(summary.totalInvocations)} />
        <Stat label="Total Cost" value={formatUsd(summary.totalCostUsd)} />
        <Stat label="Avg Cost/Call" value={formatUsd(summary.avgCostPerCall)} />
        <Stat label="Tokens (in/out)"
              value={`${formatTokens(summary.totalInputTokens)} / ${formatTokens(summary.totalOutputTokens)}`} />
        <Stat label="Median Latency" value={formatLatency(summary.medianLatencyMs, summary.latencySampleCount)} />
      </div>

      {points.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">
          No data for this agent in the selected range.
        </CardContent></Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Cost per day</CardTitle></CardHeader>
            <CardContent><AgentTrendChart data={points} dataKey="cost_usd" label="USD" /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Invocations per day</CardTitle></CardHeader>
            <CardContent><AgentTrendChart data={points} dataKey="invocations" label="calls" /></CardContent>
          </Card>
          {summary.latencySampleCount > 0 && (
            <Card>
              <CardHeader><CardTitle>Latency (p50) per day</CardTitle></CardHeader>
              <CardContent><AgentTrendChart data={points} dataKey="p50_latency_ms" label="ms" /></CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
