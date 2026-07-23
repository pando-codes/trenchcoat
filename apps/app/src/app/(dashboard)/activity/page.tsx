import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { mapDailyActivity } from "@/lib/mappers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HourlyHeatmap } from "@/components/charts/hourly-heatmap";
import { DailyActivityChart } from "@/components/charts/daily-activity-chart";
import type { HourlyHeatmapEntry } from "@/types/analytics";

export default async function ActivityPage({
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

  let dailyActivity: ReturnType<typeof mapDailyActivity>;
  const heatmapData: HourlyHeatmapEntry[] = [];
  let stopReasons: { reason: string; count: number }[];

  if (apiKeyId) {
    // Machine filter active → daily_aggregates has no key dimension. Recompute
    // daily activity, heatmap, and stop reasons from raw events via RPCs.
    const [dailyRes, heatmapRes, reasonsRes] = await Promise.all([
      supabase.rpc("get_daily_activity_for_key", {
        p_user_id: user.id, p_from, p_to, p_api_key_id: apiKeyId,
      }),
      supabase.rpc("get_hourly_heatmap_for_key", {
        p_user_id: user.id, p_from, p_to, p_api_key_id: apiKeyId,
      }),
      supabase.rpc("get_stop_reasons_for_key", {
        p_user_id: user.id, p_from, p_to, p_api_key_id: apiKeyId,
      }),
    ]);

    dailyActivity = mapDailyActivity(
      (dailyRes.data as unknown as Parameters<typeof mapDailyActivity>[0]) ?? []
    );

    const counts = new Map<string, number>();
    for (const row of (heatmapRes.data as unknown as Record<string, unknown>[]) ?? []) {
      counts.set(`${row.day_of_week}:${row.hour}`, (row.count as number) ?? 0);
    }
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        heatmapData.push({ day_of_week: dow, hour, count: counts.get(`${dow}:${hour}`) ?? 0 });
      }
    }

    const reasonObj = (reasonsRes.data as Record<string, number> | null) ?? {};
    stopReasons = Object.entries(reasonObj)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  } else {
    const aggregatesResult = await supabase
      .from("daily_aggregates")
      .select("date, sessions, events, tool_uses, hourly_distribution, stop_reasons")
      .eq("user_id", user.id)
      .gte("date", p_from)
      .lte("date", p_to)
      .order("date", { ascending: true });

    const rows = aggregatesResult.data ?? [];

    // Build daily activity
    dailyActivity = mapDailyActivity(rows);

    // Build heatmap from hourly_distribution (7x24 grid by day-of-week)
    const buckets = new Map<string, number>();
    for (const row of rows) {
      const dayOfWeek = new Date(row.date).getDay();
      const hourly = row.hourly_distribution as number[];
      if (!Array.isArray(hourly)) continue;
      for (let hour = 0; hour < hourly.length && hour < 24; hour++) {
        const key = `${dayOfWeek}:${hour}`;
        buckets.set(key, (buckets.get(key) ?? 0) + (hourly[hour] ?? 0));
      }
    }
    for (let dow = 0; dow < 7; dow++) {
      for (let hour = 0; hour < 24; hour++) {
        heatmapData.push({
          day_of_week: dow,
          hour,
          count: buckets.get(`${dow}:${hour}`) ?? 0,
        });
      }
    }

    // Aggregate stop reasons across all days
    const reasonTotals = new Map<string, number>();
    for (const row of rows) {
      const sr = row.stop_reasons as Record<string, number> | null;
      if (!sr) continue;
      for (const [reason, count] of Object.entries(sr)) {
        reasonTotals.set(reason, (reasonTotals.get(reason) ?? 0) + count);
      }
    }
    stopReasons = Array.from(reasonTotals.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">
          Patterns and trends in your Claude Code usage.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity Heatmap</CardTitle>
        </CardHeader>
        <CardContent>
          <HourlyHeatmap data={heatmapData} />
        </CardContent>
      </Card>

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
            <CardTitle>Stop Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            {stopReasons.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data available.</p>
            ) : (
              <div className="space-y-3">
                {stopReasons.map((item) => {
                  const total = stopReasons.reduce((sum, r) => sum + r.count, 0);
                  const pct = total > 0 ? (item.count / total) * 100 : 0;
                  return (
                    <div key={item.reason} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium">
                          {item.reason || "unknown"}
                        </span>
                        <span className="text-muted-foreground">
                          {item.count} ({pct.toFixed(0)}%)
                        </span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-chart-1"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
