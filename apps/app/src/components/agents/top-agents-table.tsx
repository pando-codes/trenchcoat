"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentKind, AgentStat } from "@/types/analytics";
import { formatUsd, formatTokens, avgCostPerCall, formatLatency } from "@/lib/format/agents";

// Display order groups the "defined" kinds (plugin/project/user) ahead of the
// non-authored ones, matching how the filter chips read left-to-right.
const KIND_ORDER: AgentKind[] = ["plugin", "project", "user", "builtin", "ad_hoc"];

const KIND_META: Record<AgentKind, { label: string; badge: string }> = {
  plugin: {
    label: "Plugin",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
  },
  project: {
    label: "Project",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  user: {
    label: "User",
    badge: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
  builtin: {
    label: "Built-in",
    badge: "border-border bg-muted text-muted-foreground",
  },
  ad_hoc: {
    label: "Ad-hoc",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
};

type Filter = AgentKind | "all";

export function TopAgentsTable({ agents }: { agents: AgentStat[] }) {
  const [filter, setFilter] = useState<Filter>("all");

  // Count per kind, then build the chip list from kinds actually present so the
  // control never offers an empty bucket.
  const counts = useMemo(() => {
    const c = new Map<AgentKind, number>();
    for (const a of agents) c.set(a.agent_kind, (c.get(a.agent_kind) ?? 0) + 1);
    return c;
  }, [agents]);

  const presentKinds = KIND_ORDER.filter((k) => (counts.get(k) ?? 0) > 0);

  const visible =
    filter === "all" ? agents : agents.filter((a) => a.agent_kind === filter);

  const chip = (value: Filter, label: string, count: number) => {
    const active = filter === value;
    return (
      <button
        key={value}
        type="button"
        onClick={() => setFilter(value)}
        aria-pressed={active}
        className={
          "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
          (active
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border bg-transparent text-muted-foreground hover:bg-muted")
        }
      >
        {label} <span className="tabular-nums opacity-70">{count}</span>
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {chip("all", "All", agents.length)}
        {presentKinds.map((k) => chip(k, KIND_META[k].label, counts.get(k) ?? 0))}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent Type</TableHead>
            <TableHead>Origin</TableHead>
            <TableHead className="text-right">Calls</TableHead>
            <TableHead className="text-right">Avg Cost</TableHead>
            <TableHead className="text-right">Tokens (in/out)</TableHead>
            <TableHead className="text-right">Latency p50 / p99</TableHead>
            <TableHead className="text-right">Avg Tools/Call</TableHead>
            <TableHead className="text-right">Avg Turns</TableHead>
            <TableHead className="text-right">Trend</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="text-center text-muted-foreground">
                No agent data found.
              </TableCell>
            </TableRow>
          ) : (
            visible.map((stat) => {
              const meta = KIND_META[stat.agent_kind] ?? KIND_META.ad_hoc;
              return (
                <TableRow key={stat.agent_type}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/agents/${encodeURIComponent(stat.agent_type || "general-purpose")}`}
                      className="hover:underline"
                    >
                      {stat.agent_type || "general-purpose"}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={meta.badge}>
                      {meta.label}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">{stat.count}</TableCell>
                  <TableCell className="text-right">
                    {formatUsd(avgCostPerCall(stat.total_cost_usd, stat.count))}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatTokens(stat.total_input_tokens)} / {formatTokens(stat.total_output_tokens)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatLatency(stat.p50_latency_ms, stat.latency_sample_count)}
                    {" / "}
                    {formatLatency(stat.p99_latency_ms, stat.latency_sample_count)}
                  </TableCell>
                  <TableCell className="text-right">
                    {stat.avg_tool_count?.toFixed(1) ?? "--"}
                  </TableCell>
                  <TableCell className="text-right">
                    {stat.avg_turns?.toFixed(1) ?? "--"}
                  </TableCell>
                  <TableCell className="text-right">
                    {stat.trend === null ? (
                      <span className="text-muted-foreground">--</span>
                    ) : stat.trend > 0 ? (
                      <span className="text-emerald-600">+{stat.trend.toFixed(1)}%</span>
                    ) : (
                      <span className="text-red-500">{stat.trend.toFixed(1)}%</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
