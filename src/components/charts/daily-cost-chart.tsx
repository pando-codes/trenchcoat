"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyCost } from "@/types/analytics";

interface DailyCostChartProps {
  data: DailyCost[];
}

export function DailyCostChart({ data }: DailyCostChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
        No cost data available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
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
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
          tickFormatter={(v: number) => `$${v.toFixed(2)}`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            color: "var(--color-popover-foreground)",
          }}
          labelFormatter={(label) => new Date(String(label)).toLocaleDateString()}
        />
        <Line
          type="monotone"
          dataKey="total_cost_usd"
          stroke="var(--color-chart-4)"
          strokeWidth={2}
          dot={false}
          name="Cost (USD)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
