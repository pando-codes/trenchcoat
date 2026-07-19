"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { AgentTimeseriesPoint } from "@/types/analytics";

export function AgentTrendChart({
  data, dataKey, label,
}: {
  data: AgentTimeseriesPoint[];
  dataKey: "cost_usd" | "invocations" | "p50_latency_ms";
  label: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <XAxis
          dataKey="bucket"
          fontSize={11}
          tickMargin={6}
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <YAxis
          fontSize={11}
          width={48}
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
          formatter={(v: number | undefined) => [v ?? "--", label]}
        />
        <Line type="monotone" dataKey={dataKey} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
