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
import type { AgentStat } from "@/types/analytics";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { from, to } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);

  const [agentsResult, dailyResult] = await Promise.all([
    supabase.rpc("get_top_agents", {
      p_user_id: user.id,
      p_from,
      p_to,
      p_limit: 50,
    }),
    supabase
      .from("daily_aggregates")
      .select("date, agent_calls")
      .eq("user_id", user.id)
      .gte("date", p_from)
      .lte("date", p_to)
      .order("date", { ascending: true }),
  ]);

  const agents: AgentStat[] = (
    (agentsResult.data as Record<string, unknown>[]) ?? []
  ).map((row) => ({
    agent_type: row.agent_type as string,
    count: row.count as number,
    avg_tool_count: (row.avg_tool_count as number | null) ?? null,
    avg_turns: (row.avg_turns as number | null) ?? null,
    trend: (row.trend as number | null) ?? null,
  }));

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
                <TableHead className="text-right">Avg Tools/Call</TableHead>
                <TableHead className="text-right">Avg Turns</TableHead>
                <TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No agent data found.
                  </TableCell>
                </TableRow>
              ) : (
                agents.map((stat) => (
                  <TableRow key={stat.agent_type}>
                    <TableCell className="font-medium">
                      {stat.agent_type}
                    </TableCell>
                    <TableCell className="text-right">{stat.count}</TableCell>
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
