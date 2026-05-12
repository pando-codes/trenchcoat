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
import { ToolUsageChart } from "@/components/charts/tool-usage-chart";
import type { ToolUsageStat } from "@/types/analytics";

function formatMs(ms: number | null): string {
  if (ms === null) return "--";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function ToolsPage({
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

  const { data } = await supabase.rpc("get_top_tools", {
    p_user_id: user.id,
    p_from,
    p_to,
    p_limit: 50,
  });

  const tools: ToolUsageStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    tool_name: row.tool_name as string,
    count: row.count as number,
    avg_duration_ms: (row.avg_duration_ms as number | null) ?? null,
    p50_duration_ms: (row.p50_duration_ms as number | null) ?? null,
    p99_duration_ms: (row.p99_duration_ms as number | null) ?? null,
    trend: (row.trend as number | null) ?? null,
  }));

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tools</h1>
        <p className="text-sm text-muted-foreground">
          Tool usage analytics and performance breakdown.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tool Usage Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <ToolUsageChart data={tools.slice(0, 15)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All Tools</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tool Name</TableHead>
                <TableHead className="text-right">Count</TableHead>
                <TableHead className="text-right">Avg Duration</TableHead>
                <TableHead className="text-right">p50</TableHead>
                <TableHead className="text-right">p99</TableHead>
                <TableHead className="text-right">Trend</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tools.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No tool usage data found.
                  </TableCell>
                </TableRow>
              ) : (
                tools.map((tool) => (
                  <TableRow key={tool.tool_name}>
                    <TableCell className="font-medium">{tool.tool_name}</TableCell>
                    <TableCell className="text-right">{tool.count}</TableCell>
                    <TableCell className="text-right">
                      {formatMs(tool.avg_duration_ms)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMs(tool.p50_duration_ms)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatMs(tool.p99_duration_ms)}
                    </TableCell>
                    <TableCell className="text-right">
                      {tool.trend !== null ? (
                        <span
                          className={
                            tool.trend > 0 ? "text-emerald-600" : "text-red-500"
                          }
                        >
                          {tool.trend > 0 ? "+" : ""}
                          {tool.trend.toFixed(1)}%
                        </span>
                      ) : (
                        <span className="text-muted-foreground">--</span>
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
