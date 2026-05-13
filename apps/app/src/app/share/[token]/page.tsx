// apps/app/src/app/share/[token]/page.tsx
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TeamTrendChart } from "@/components/charts/team-trend-chart";
import { formatCost } from "@/lib/cost";
import type { TeamShareSnapshot, TeamMemberStat } from "@/types/teams";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const adminAny = getAdminClient() as any;
  const { data: share } = await adminAny
    .from("team_shares")
    .select("*")
    .eq("token", token)
    .single();

  if (!share) notFound();

  const snap = share.snapshot as TeamShareSnapshot;

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
  }

  function formatLastActive(date: string | null): string {
    if (!date) return "--";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short", day: "numeric",
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">

        {/* Header */}
        <div>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-2">
            Trenchcoat
          </p>
          <h1 className="text-2xl font-bold">{snap.team.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {share.date_from} – {share.date_to} · Shared by {snap.shared_by}
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{snap.stats.total_sessions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCost(snap.stats.total_cost_usd)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Active Members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {snap.stats.active_members}/{snap.stats.total_members}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{snap.stats.avg_session_duration_min}m</div>
            </CardContent>
          </Card>
        </div>

        {/* Per-member table (read-only, no links) */}
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Top Tool</TableHead>
                  <TableHead className="text-right">Last Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snap.members.map((m: TeamMemberStat) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">
                      {m.display_name ?? "Unknown"}
                    </TableCell>
                    <TableCell className="text-right">{m.sessions}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCost(m.total_cost_usd)}
                    </TableCell>
                    <TableCell className="text-right">{m.top_tool ?? "--"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatLastActive(m.last_active)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Sessions trend */}
        <Card>
          <CardHeader>
            <CardTitle>Sessions over time</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamTrendChart data={snap.trend} />
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-6 text-sm text-muted-foreground">
          <span>Snapshot captured {formatDate(snap.captured_at)}</span>
          <a
            href="https://trenchcoat.com"
            className="font-medium text-foreground hover:underline"
          >
            Get Trenchcoat →
          </a>
        </div>

      </div>
    </div>
  );
}
