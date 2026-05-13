"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TeamTrendPoint } from "@/types/teams";

interface TeamTrendChartProps {
  data: TeamTrendPoint[];
}

export function TeamTrendChart({ data }: TeamTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No activity data available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorTeamSessions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--color-chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) => {
            const d = new Date(value);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <YAxis
          allowDecimals={false}
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            color: "var(--color-popover-foreground)",
          }}
        />
        <Area
          type="monotone"
          dataKey="sessions"
          stroke="var(--color-chart-1)"
          fillOpacity={1}
          fill="url(#colorTeamSessions)"
          name="Sessions"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
