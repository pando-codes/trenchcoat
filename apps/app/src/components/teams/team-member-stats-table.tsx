// apps/app/src/components/teams/team-member-stats-table.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCost } from "@/lib/cost";
import type { TeamMemberStat } from "@/types/teams";

type SortKey = "sessions" | "total_cost_usd";

interface TeamMemberStatsTableProps {
  members: TeamMemberStat[];
}

const COLUMN_COUNT = 5;

function formatLastActive(date: string | null): string {
  if (!date) return "--";
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day:   "numeric",
  });
}

function SortHeader({
  label,
  field,
  currentSort,
  onSort,
}: {
  label: string;
  field: SortKey;
  currentSort: SortKey;
  onSort: (field: SortKey) => void;
}) {
  return (
    <TableHead
      className="cursor-pointer select-none text-right"
      onClick={() => onSort(field)}
    >
      {label} {currentSort === field ? "↓" : ""}
    </TableHead>
  );
}

export function TeamMemberStatsTable({ members }: TeamMemberStatsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sessions");

  const sorted = [...members].sort((a, b) => (b[sortKey] ?? 0) - (a[sortKey] ?? 0));

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <SortHeader label="Sessions" field="sessions" currentSort={sortKey} onSort={setSortKey} />
          <SortHeader label="Cost"     field="total_cost_usd" currentSort={sortKey} onSort={setSortKey} />
          <TableHead className="text-right">Top Tool</TableHead>
          <TableHead className="text-right">Last Active</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={COLUMN_COUNT} className="text-center text-muted-foreground">
              No members found.
            </TableCell>
          </TableRow>
        ) : (
          sorted.map((m) => (
            <TableRow key={m.user_id}>
              <TableCell className="font-medium">
                <Link
                  href={`/sessions?user_id=${m.user_id}`}
                  className="hover:underline underline-offset-4"
                >
                  {m.display_name ?? "Unknown"}
                </Link>
              </TableCell>
              <TableCell className="text-right">{m.sessions}</TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCost(m.total_cost_usd)}
              </TableCell>
              <TableCell className="text-right">
                {m.top_tool ?? "--"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatLastActive(m.last_active)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
