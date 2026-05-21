import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { mapDailyActivity, mapDailyCost, mapOverviewStats } from "@/lib/mappers";
import { OverviewCards } from "@/components/dashboard/overview-cards";
import { DailyActivityChart } from "@/components/charts/daily-activity-chart";
import { ToolUsageChart } from "@/components/charts/tool-usage-chart";
import { DailyCostChart } from "@/components/charts/daily-cost-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ToolUsageStat } from "@/types/analytics";

// ─── Skeleton fallbacks ────────────────────────────────────────────────────────

function StatCardsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4 rounded" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ChartCardSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[300px] w-full rounded" />
      </CardContent>
    </Card>
  );
}

// ─── Async streaming sections ──────────────────────────────────────────────────

interface SectionProps {
  userId: string;
  p_from: string;
  p_to: string;
}

async function StatsSection({ userId, p_from, p_to }: SectionProps) {
  const supabase = await createClient();

  const fromMs = new Date(p_from).getTime();
  const toMs = new Date(p_to).getTime();
  const periodMs = toMs - fromMs;
  const prevTo = new Date(fromMs - 24 * 60 * 60 * 1000).toISOString().substring(0, 10);
  const prevFrom = new Date(fromMs - 24 * 60 * 60 * 1000 - periodMs).toISOString().substring(0, 10);

  const [statsResult, prevStatsResult] = await Promise.all([
    supabase.rpc("get_overview_stats", { p_user_id: userId, p_from, p_to }),
    supabase.rpc("get_overview_stats", { p_user_id: userId, p_from: prevFrom, p_to: prevTo }),
  ]);

  return (
    <OverviewCards
      stats={mapOverviewStats(statsResult.data)}
      prevStats={mapOverviewStats(prevStatsResult.data)}
    />
  );
}

async function ActivitySection({ userId, p_from, p_to }: SectionProps) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("daily_aggregates")
    .select("date, sessions, events, tool_uses")
    .eq("user_id", userId)
    .gte("date", p_from)
    .lte("date", p_to)
    .order("date", { ascending: true })
    .limit(30);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <DailyActivityChart data={mapDailyActivity(data ?? [])} />
      </CardContent>
    </Card>
  );
}

async function TopToolsSection({ userId, p_from, p_to }: SectionProps) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_top_tools", {
    p_user_id: userId,
    p_from,
    p_to,
    p_limit: 10,
  });
  const topTools: ToolUsageStat[] = (data as unknown as ToolUsageStat[]) ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Top Tools</CardTitle>
        <Link
          href="/tools"
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View all →
        </Link>
      </CardHeader>
      <CardContent>
        <ToolUsageChart data={topTools} />
      </CardContent>
    </Card>
  );
}

async function CostSection({ userId, p_from, p_to }: SectionProps) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_daily_cost", { p_user_id: userId, p_from, p_to });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Daily Cost</CardTitle>
      </CardHeader>
      <CardContent>
        <DailyCostChart data={mapDailyCost((data as Record<string, unknown>[]) ?? [])} />
      </CardContent>
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

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

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">
          Your Claude Code telemetry at a glance.
        </p>
      </div>

      <Suspense fallback={<StatCardsSkeleton />}>
        <StatsSection userId={user.id} p_from={p_from} p_to={p_to} />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-2">
        <Suspense fallback={<ChartCardSkeleton title="Daily Activity" />}>
          <ActivitySection userId={user.id} p_from={p_from} p_to={p_to} />
        </Suspense>
        <Suspense fallback={<ChartCardSkeleton title="Top Tools" />}>
          <TopToolsSection userId={user.id} p_from={p_from} p_to={p_to} />
        </Suspense>
      </div>

      <Suspense fallback={<ChartCardSkeleton title="Daily Cost" />}>
        <CostSection userId={user.id} p_from={p_from} p_to={p_to} />
      </Suspense>
    </div>
  );
}
