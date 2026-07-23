import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AgentCallsChart } from "@/components/charts/agent-calls-chart";
import { getTopAgents } from "@/lib/services/analytics.service";
import { formatUsd, formatTokens, avgCostPerCall, formatLatency } from "@/lib/format/agents";

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent Type</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Avg Cost</TableHead>
                <TableHead className="text-right">Tokens (in/out)</TableHead>
                <TableHead className="text-right">Latency p50 / p99</TableHead>
                <TableHead className="text-right">Avg Tools/Call</TableHead>
                <TableHead className="text-right">Avg Turns</TableHead>
                <TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center text-muted-foreground"
                  >
                    No agent data found.
                  </TableCell>
                </TableRow>
              ) : (
                agents.map((stat) => (
                  <TableRow key={stat.agent_type}>
                    <TableCell className="font-medium">
                      <Link href={`/agents/${encodeURIComponent(stat.agent_type || "general-purpose")}`}
                            className="hover:underline">
                        {stat.agent_type || "general-purpose"}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right">{stat.count}</TableCell>
                    <TableCell className="text-right">
                      {formatUsd(avgCostPerCall(stat.total_cost_usd, stat.count))}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatTokens(stat.total_input_tokens)} / {formatTokens(stat.total_output_tokens)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatLatency(stat.p50_latency_ms, stat.latency_sample_count)}
                      {" / "}
                      {formatLatency(stat.p99_latency_ms, stat.latency_sample_count)}
                    </TableCell>
                    <TableCell className="text-right">
                      {stat.avg_tool_count?.toFixed(1) ?? "--"}
                    </TableCell>
                    <TableCell className="text-right">
                      {stat.avg_turns?.toFixed(1) ?? "--"}
                    </TableCell>
                    <TableCell className="text-right">
                      {stat.trend === null ? (
                        <span className="text-muted-foreground">--</span>
                      ) : stat.trend > 0 ? (
                        <span className="text-emerald-600">
                          +{stat.trend.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-red-500">
                          {stat.trend.toFixed(1)}%
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
