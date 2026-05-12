import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamMembersClient } from "@/components/teams/team-members-client";

export default async function TeamDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Verify membership
  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", id)
    .eq("user_id", user.id)
    .single();

  if (!membership) notFound();

  // Fetch team
  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", id)
    .single();

  if (!team) notFound();

  // Fetch members with profiles
  const { data: members } = await supabase
    .from("team_members")
    .select("id, user_id, role, joined_at, user_profiles(display_name, email, avatar_url)")
    .eq("team_id", id)
    .order("joined_at", { ascending: true });

  // Fetch team stats
  const today = new Date().toISOString().split("T")[0];
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
  const { data: teamStats } = await supabase.rpc("get_team_overview_stats", {
    p_team_id: id,
    p_from: thirtyDaysAgo,
    p_to: today,
  });

  const stats = teamStats || {
    total_sessions: 0,
    total_events: 0,
    total_tool_uses: 0,
    active_members: 0,
    total_members: members?.length || 0,
    avg_session_duration_min: 0,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
        <p className="text-muted-foreground">Team dashboard - last 30 days</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.active_members}/{stats.total_members}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_sessions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Tool Uses</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_tool_uses}</div>
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

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamMembersClient
            teamId={id}
            members={(members || []).map((m) => ({
              id: m.id,
              user_id: m.user_id,
              role: m.role as string,
              joined_at: m.joined_at as string,
              display_name: (m.user_profiles as unknown as Record<string, unknown>)?.display_name as string || "Unknown",
              email: (m.user_profiles as unknown as Record<string, unknown>)?.email as string || "",
            }))}
            currentUserRole={membership.role as string}
          />
        </CardContent>
      </Card>
    </div>
  );
}
