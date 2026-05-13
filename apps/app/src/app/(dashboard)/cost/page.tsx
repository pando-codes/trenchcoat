import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { formatCost } from "@/lib/cost";
import { mapDailyCost } from "@/lib/mappers";
import { DailyCostChart } from "@/components/charts/daily-cost-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ModelCost, AgentStat } from "@/types/analytics";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export default async function CostPage({
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

  const [dailyCostResult, modelCostResult, agentsResult] = await Promise.all([
    supabase.rpc("get_daily_cost", { p_user_id: user.id, p_from, p_to }),
    supabase.rpc("get_cost_by_model", { p_user_id: user.id, p_from, p_to }),
    supabase.rpc("get_top_agents", { p_user_id: user.id, p_from, p_to, p_limit: 20 }),
  ]);

  const dailyCost = mapDailyCost((dailyCostResult.data as Record<string, unknown>[]) ?? []);
  const modelCost: ModelCost[] = ((modelCostResult.data as Record<string, unknown>[]) ?? []).map(
    (row) => ({
      model: row.model as string,
      session_count: row.session_count as number,
      input_tokens: row.input_tokens as number,
      output_tokens: row.output_tokens as number,
      total_cost_usd: (row.total_cost_usd as number | null) ?? 0,
    })
  );
  const agents: AgentStat[] = ((agentsResult.data as Record<string, unknown>[]) ?? []).map(
    (row) => ({
      agent_type: row.agent_type as string,
      count: row.count as number,
      avg_tool_count: (row.avg_tool_count as number | null) ?? null,
      avg_turns: (row.avg_turns as number | null) ?? null,
      trend: (row.trend as number | null) ?? null,
      total_input_tokens: (row.total_input_tokens as number | null) ?? null,
      total_output_tokens: (row.total_output_tokens as number | null) ?? null,
      total_cost_usd: (row.total_cost_usd as number | null) ?? null,
    })
  );

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cost</h1>
        <p className="text-sm text-muted-foreground">
          Token usage and estimated spend by model and agent.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Spend</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyCostChart data={dailyCost} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost by Model</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Model</TableHead>
                <TableHead className="text-right">Sessions</TableHead>
                <TableHead className="text-right">Input Tokens</TableHead>
                <TableHead className="text-right">Output Tokens</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {modelCost.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No cost data found. Token data is captured from new sessions only.
                  </TableCell>
                </TableRow>
              ) : (
                modelCost.map((row) => (
                  <TableRow key={row.model}>
                    <TableCell className="font-medium font-mono text-sm">{row.model}</TableCell>
                    <TableCell className="text-right">{row.session_count}</TableCell>
                    <TableCell className="text-right">{formatTokens(row.input_tokens)}</TableCell>
                    <TableCell className="text-right">{formatTokens(row.output_tokens)}</TableCell>
                    <TableCell className="text-right font-mono">{formatCost(row.total_cost_usd)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cost by Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent Type</TableHead>
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Input Tokens</TableHead>
                <TableHead className="text-right">Output Tokens</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {agents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No agent data found.
                  </TableCell>
                </TableRow>
              ) : (
                agents.map((agent) => (
                  <TableRow key={agent.agent_type}>
                    <TableCell className="font-medium">{agent.agent_type}</TableCell>
                    <TableCell className="text-right">{agent.count}</TableCell>
                    <TableCell className="text-right">
                      {agent.total_input_tokens != null ? formatTokens(agent.total_input_tokens) : "--"}
                    </TableCell>
                    <TableCell className="text-right">
                      {agent.total_output_tokens != null ? formatTokens(agent.total_output_tokens) : "--"}
                    </TableCell>
                    <TableCell className="text-right font-mono">{formatCost(agent.total_cost_usd)}</TableCell>
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
