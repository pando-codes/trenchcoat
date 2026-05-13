// apps/app/src/components/teams/team-overview-tab.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamMemberStatsTable } from "@/components/teams/team-member-stats-table";
import { TeamTrendChart } from "@/components/charts/team-trend-chart";
import { formatCost } from "@/lib/cost";
import type { TeamMemberStat, TeamTrendPoint } from "@/types/teams";

interface TeamOverviewTabProps {
  stats: {
    total_sessions:           number;
    active_members:           number;
    total_members:            number;
    avg_session_duration_min: number;
  };
  members: TeamMemberStat[];
  trend:   TeamTrendPoint[];
}

export function TeamOverviewTab({ stats, members, trend }: TeamOverviewTabProps) {
  const totalCostUsd = members.reduce((sum, m) => sum + (m.total_cost_usd ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_sessions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCost(totalCostUsd)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.active_members}/{stats.total_members}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avg_session_duration_min}m</div>
          </CardContent>
        </Card>
      </div>

      {/* Per-member table */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamMemberStatsTable members={members} />
        </CardContent>
      </Card>

      {/* Sessions trend */}
      <Card>
        <CardHeader>
          <CardTitle>Sessions over time</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamTrendChart data={trend} />
        </CardContent>
      </Card>
    </div>
  );
}
