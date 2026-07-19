"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { AgentTimeseriesPoint } from "@/types/analytics";

export function AgentTrendChart({
  data, dataKey, label,
}: { data: AgentTimeseriesPoint[]; dataKey: "cost_usd" | "invocations"; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <XAxis dataKey="bucket" fontSize={11} tickMargin={6} />
        <YAxis fontSize={11} width={48} />
        <Tooltip formatter={(v: number | undefined) => [v ?? 0, label]} />
        <Line type="monotone" dataKey={dataKey} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
