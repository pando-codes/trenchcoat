"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ToolUsageStat } from "@/types/analytics";

interface ToolUsageChartProps {
  data: ToolUsageStat[];
}

export function ToolUsageChart({ data }: ToolUsageChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No tool usage data available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          type="number"
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <YAxis
          type="category"
          dataKey="tool_name"
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
          width={80}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            color: "var(--color-popover-foreground)",
          }}
        />
        <Bar
          dataKey="count"
          fill="var(--color-chart-1)"
          radius={[0, 4, 4, 0]}
          name="Uses"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
