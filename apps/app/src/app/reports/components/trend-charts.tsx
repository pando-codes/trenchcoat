"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { ReportsSummary } from "../mock-data";

function formatDate(value: string): string {
  const d = new Date(value);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const tooltipStyle = {
  backgroundColor: "var(--tc-surface-2)",
  border: "1px solid var(--tc-border-strong)",
  borderRadius: "var(--tc-radius-sm)",
  color: "var(--tc-ink-primary)",
  fontSize: "var(--tc-text-caption-size)",
};

const tickStyle = { fill: "var(--tc-ink-secondary)", fontSize: 12 };

export function ActivityChart({ data }: { data: ReportsSummary["dailyActivity"] }) {
  return (
    <div
      role="img"
      aria-label="Area chart of daily agent sessions over the last 14 days"
    >
      <ResponsiveContainer width="100%" height={240}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--tc-border)" />
          <XAxis dataKey="date" tickFormatter={formatDate} tick={tickStyle} />
          <YAxis tick={tickStyle} width={32} />
          <Tooltip
            contentStyle={tooltipStyle}
            labelFormatter={(l) => new Date(String(l)).toLocaleDateString()}
          />
          <Area
            type="monotone"
            dataKey="sessions"
            name="Sessions"
            stroke="var(--tc-accent)"
            fill="var(--tc-accent-subtle)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CostChart({ data }: { data: ReportsSummary["dailyCost"] }) {
  return (
    <div role="img" aria-label="Bar chart of daily spend in USD over the last 14 days">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--tc-border)" />
          <XAxis dataKey="date" tickFormatter={formatDate} tick={tickStyle} />
          <YAxis tick={tickStyle} width={40} tickFormatter={(v: number) => `$${v}`} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v) => [`$${Number(v).toFixed(2)}`, "Cost"]}
            labelFormatter={(l) => new Date(String(l)).toLocaleDateString()}
          />
          <Bar dataKey="costUsd" name="Cost (USD)" fill="var(--tc-accent-emphasis)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
