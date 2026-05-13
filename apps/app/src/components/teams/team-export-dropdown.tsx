// apps/app/src/components/teams/team-export-dropdown.tsx
"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createTeamShareAction } from "@/lib/actions/teams.actions";
import { formatCost } from "@/lib/cost";
import type { TeamMemberStat } from "@/types/teams";

interface TeamExportDropdownProps {
  teamId:   string;
  teamName: string;
  teamSlug: string;
  dateFrom: string;
  dateTo:   string;
  members:  TeamMemberStat[];
  totalSessions: number;
}

export function TeamExportDropdown({
  teamId, teamName, teamSlug, dateFrom, dateTo, members, totalSessions,
}: TeamExportDropdownProps) {
  const [sharing, setSharing] = useState(false);

  function downloadCsv() {
    const totalCost = members.reduce((sum, m) => sum + (m.total_cost_usd ?? 0), 0);

    const rows: string[][] = [
      [`Team: ${teamName}`],
      [`Period: ${dateFrom} to ${dateTo}`],
      [],
      ["Member", "Sessions", "Cost (USD)", "Top Tool", "Last Active"],
      ...members.map((m) => [
        m.display_name ?? "Unknown",
        String(m.sessions),
        m.total_cost_usd != null ? m.total_cost_usd.toFixed(4) : "0.0000",
        m.top_tool ?? "--",
        m.last_active ?? "--",
      ]),
      [],
      ["Total", String(totalSessions), totalCost.toFixed(4), "", ""],
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${teamSlug}-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyShareLink() {
    setSharing(true);
    try {
      const result = await createTeamShareAction(teamId, dateFrom, dateTo);
      if (result.success) {
        await navigator.clipboard.writeText(result.data.url);
        // Brief visual feedback via window title (avoids alert dialogs).
        const prev = document.title;
        document.title = "✓ Link copied!";
        setTimeout(() => { document.title = prev; }, 2000);
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Export <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={downloadCsv}>
          Download CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyShareLink} disabled={sharing}>
          {sharing ? "Creating link…" : "Copy share link"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
