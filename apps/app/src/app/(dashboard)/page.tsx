import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { mapDailyActivity, mapDailyCost, mapOverviewStats } from "@/lib/mappers";
import { OverviewCards } from "@/components/dashboard/overview-cards";
import { DailyActivityChart } from "@/components/charts/daily-activity-chart";
import { ToolUsageChart } from "@/components/charts/tool-usage-chart";
import { DailyCostChart } from "@/components/charts/daily-cost-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ToolUsageStat } from "@/types/analytics";

export default async function OverviewPage({
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

  const [statsResult, dailyResult, toolsResult, costResult] = await Promise.all([
    supabase.rpc("get_overview_stats", { p_user_id: user.id, p_from, p_to }),
    supabase
      .from("daily_aggregates")
      .select("date, sessions, events, tool_uses")
      .eq("user_id", user.id)
      .gte("date", p_from)
      .lte("date", p_to)
      .order("date", { ascending: true })
      .limit(30),
    supabase.rpc("get_top_tools", { p_user_id: user.id, p_from, p_to, p_limit: 10 }),
    supabase.rpc("get_daily_cost", { p_user_id: user.id, p_from, p_to }),
  ]);

  const stats = mapOverviewStats(statsResult.data);
  const dailyActivity = mapDailyActivity(dailyResult.data ?? []);
  const topTools: ToolUsageStat[] = ((toolsResult.data as unknown as ToolUsageStat[]) ?? []);
  const dailyCost = mapDailyCost((costResult.data as Record<string, unknown>[]) ?? []);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Your Claude Code telemetry at a glance.
        </p>
      </div>

      <OverviewCards stats={stats} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Daily Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <DailyActivityChart data={dailyActivity} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top Tools</CardTitle>
          </CardHeader>
          <CardContent>
            <ToolUsageChart data={topTools} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Daily Cost</CardTitle>
        </CardHeader>
        <CardContent>
          <DailyCostChart data={dailyCost} />
        </CardContent>
      </Card>
    </div>
  );
}
