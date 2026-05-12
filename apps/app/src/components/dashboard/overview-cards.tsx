"use client";

import {
  Terminal,
  Zap,
  Wrench,
  Bot,
  CalendarDays,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OverviewStats } from "@/types/analytics";

interface OverviewCardsProps {
  stats: OverviewStats;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  trend?: number;
}

function StatCard({ label, value, icon, trend }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
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

export function OverviewCards({ stats }: OverviewCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        label="Total Sessions"
        value={stats.total_sessions}
        icon={<Terminal className="size-4" />}
      />
      <StatCard
        label="Total Events"
        value={stats.total_events}
        icon={<Zap className="size-4" />}
      />
      <StatCard
        label="Tool Uses"
        value={stats.total_tool_uses}
        icon={<Wrench className="size-4" />}
      />
      <StatCard
        label="Agent Calls"
        value={stats.total_agent_calls}
        icon={<Bot className="size-4" />}
      />
      <StatCard
        label="Active Days"
        value={stats.active_days}
        icon={<CalendarDays className="size-4" />}
      />
    </div>
  );
}
