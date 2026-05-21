"use client";

import {
  Terminal,
  Zap,
  Wrench,
  Bot,
  CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OverviewStats } from "@/types/analytics";

interface OverviewCardsProps {
  stats: OverviewStats;
  prevStats?: OverviewStats;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
  description?: string;
}

function calcTrend(current: number, previous: number): number | undefined {
  if (previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

function StatCard({ label, value, icon, trend, description }: StatCardProps) {
  const labelEl = description ? (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="underline decoration-dotted underline-offset-2 cursor-help">
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[200px] text-center">
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  ) : (
    label
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {labelEl}
        </CardTitle>
        <div className="text-muted-foreground">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        {trend !== undefined && trend !== 0 && (
          <p
            className={
              trend > 0
                ? "text-xs text-emerald-600"
                : "text-xs text-red-500"
            }
          >
            {trend > 0 ? "+" : ""}
            {trend.toFixed(1)}% from previous period
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function OverviewCards({ stats, prevStats }: OverviewCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        label="Total Sessions"
        value={stats.total_sessions}
        icon={<Terminal className="size-4" />}
        trend={prevStats ? calcTrend(stats.total_sessions, prevStats.total_sessions) : undefined}
      />
      <StatCard
        label="Total Events"
        value={stats.total_events}
        icon={<Zap className="size-4" />}
        trend={prevStats ? calcTrend(stats.total_events, prevStats.total_events) : undefined}
      />
      <StatCard
        label="Tool Uses"
        value={stats.total_tool_uses}
        icon={<Wrench className="size-4" />}
        trend={prevStats ? calcTrend(stats.total_tool_uses, prevStats.total_tool_uses) : undefined}
      />
      <StatCard
        label="Agent Calls"
        value={stats.total_agent_calls}
        icon={<Bot className="size-4" />}
        trend={prevStats ? calcTrend(stats.total_agent_calls, prevStats.total_agent_calls) : undefined}
      />
      <StatCard
        label="Active Days"
        value={stats.active_days}
        icon={<CalendarDays className="size-4" />}
        trend={prevStats ? calcTrend(stats.active_days, prevStats.active_days) : undefined}
        description="Days within the selected period where at least one session was recorded."
      />
    </div>
  );
}
