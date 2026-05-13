// apps/app/src/app/(dashboard)/teams/[id]/page.tsx
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { parseDateRange } from "@/lib/date-range";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamOverviewTab } from "@/components/teams/team-overview-tab";
import { TeamMembersClient } from "@/components/teams/team-members-client";
import { TeamExportDropdown } from "@/components/teams/team-export-dropdown";
import type { TeamMemberStat, TeamTrendPoint } from "@/types/teams";

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id }      = await params;
  const { from, to } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", id)
    .eq("user_id", user.id)
    .single();
  if (!membership) notFound();

  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", id)
    .single();
  if (!team) notFound();

  const { data: members } = await supabase
    .from("team_members")
    .select("id, user_id, role, joined_at, user_profiles(display_name, email, avatar_url)")
    .eq("team_id", id)
    .order("joined_at", { ascending: true });

  const admin = getAdminClient();

  const [overviewRes, memberStatsRes, trendRes] = await Promise.all([
    admin.rpc("get_team_overview_stats", {
      p_team_id: id,
      p_from:    p_from,
      p_to:      p_to,
    }),
    admin.rpc("get_team_member_stats", {
      p_team_id: id,
      p_from:    p_from,
      p_to:      p_to,
    }),
    admin.rpc("get_team_trend", {
      p_team_id: id,
      p_from:    p_from,
      p_to:      p_to,
    }),
  ]);

  const overviewStats = overviewRes.data as {
    total_sessions: number;
    total_events: number;
    total_tool_uses: number;
    active_members: number;
    total_members: number;
    avg_session_duration_min: number;
  } | null ?? {
    total_sessions: 0, total_events: 0, total_tool_uses: 0,
    active_members: 0, total_members: members?.length ?? 0,
    avg_session_duration_min: 0,
  };

  const memberStats: TeamMemberStat[] = (memberStatsRes.data as TeamMemberStat[] | null) ?? [];
  const trend:       TeamTrendPoint[] = (trendRes.data  as TeamTrendPoint[]  | null) ?? [];

  const formattedMembers = (members ?? []).map((m) => ({
    id:           m.id,
    user_id:      m.user_id,
    role:         m.role as string,
    joined_at:    m.joined_at as string,
    display_name: (m.user_profiles as unknown as Record<string, unknown>)?.display_name as string ?? "Unknown",
    email:        (m.user_profiles as unknown as Record<string, unknown>)?.email        as string ?? "",
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
          <p className="text-muted-foreground">{formattedMembers.length} members</p>
        </div>
        <TeamExportDropdown
          teamId={id}
          teamName={team.name}
          teamSlug={team.slug}
          dateFrom={p_from}
          dateTo={p_to}
          members={memberStats}
          totalSessions={overviewStats.total_sessions}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <TeamOverviewTab
            stats={overviewStats}
            members={memberStats}
            trend={trend}
          />
        </TabsContent>

        <TabsContent value="members" className="mt-6">
          <TeamMembersClient
            teamId={id}
            members={formattedMembers}
            currentUserRole={membership.role as string}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
