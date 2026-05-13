"use server";

import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import type { TeamShareSnapshot, TeamMemberStat, TeamTrendPoint } from "@/types/teams";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function createTeamAction(input: {
  name: string;
}): Promise<ActionResult<{ id: string; name: string; slug: string; created_at: string }>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const slug = input.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const { data: team, error } = await supabase
    .from("teams")
    .insert({ name: input.name, slug, created_by: user.id })
    .select()
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  // Add creator as owner
  await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: user.id,
    role: "owner",
  });

  return { success: true, data: team };
}

export async function inviteMemberAction(
  teamId: string,
  input: { email: string; role: string }
): Promise<ActionResult<{ id: string }>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { data: invitation, error } = await supabase
    .from("team_invitations")
    .insert({
      team_id: teamId,
      email: input.email,
      role: input.role,
      invited_by: user.id,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: { id: invitation.id } };
}

export async function removeMemberAction(
  teamId: string,
  memberId: string
): Promise<ActionResult<void>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("team_id", teamId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: undefined };
}

export async function createTeamShareAction(
  teamId:   string,
  dateFrom: string,
  dateTo:   string,
): Promise<ActionResult<{ token: string; url: string }>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Not authenticated" };

  // Verify caller is a team member.
  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .single();
  if (!membership) return { success: false, error: "Not a team member" };

  const { data: team } = await supabase
    .from("teams")
    .select("name, slug")
    .eq("id", teamId)
    .single();
  if (!team) return { success: false, error: "Team not found" };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  const admin = getAdminClient();

  const [overviewRes, membersRes, trendRes] = await Promise.all([
    admin.rpc("get_team_overview_stats", {
      p_team_id: teamId,
      p_from:    dateFrom,
      p_to:      dateTo,
    }),
    admin.rpc("get_team_member_stats", {
      p_team_id: teamId,
      p_from:    dateFrom,
      p_to:      dateTo,
    }),
    admin.rpc("get_team_trend", {
      p_team_id: teamId,
      p_from:    dateFrom,
      p_to:      dateTo,
    }),
  ]);

  if (overviewRes.error || membersRes.error || trendRes.error) {
    return { success: false, error: "Failed to fetch analytics data" };
  }

  const rawStats = overviewRes.data as Record<string, number> | null;
  const totalCost = ((membersRes.data as TeamMemberStat[] | null) ?? []).reduce(
    (sum: number, m: TeamMemberStat) => sum + (m.total_cost_usd ?? 0), 0
  );

  const snapshot: TeamShareSnapshot = {
    team:  { name: team.name, slug: team.slug },
    stats: {
      total_sessions:              rawStats?.total_sessions              ?? 0,
      total_cost_usd:              totalCost,
      active_members:              rawStats?.active_members              ?? 0,
      total_members:               rawStats?.total_members               ?? 0,
      avg_session_duration_min:    rawStats?.avg_session_duration_min    ?? 0,
    },
    members:     (membersRes.data as TeamMemberStat[] | null) ?? [],
    trend:       (trendRes.data  as TeamTrendPoint[]  | null) ?? [],
    shared_by:   profile?.display_name ?? user.email ?? "Unknown",
    captured_at: new Date().toISOString(),
  };

  const { data: share, error: insertError } = await admin
    .from("team_shares")
    .insert({ team_id: teamId, created_by: user.id, date_from: dateFrom, date_to: dateTo, snapshot })
    .select("token")
    .single();

  if (insertError || !share) {
    return { success: false, error: "Failed to create share link" };
  }

  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.trenchcoat.io"}/share/${share.token}`;
  return { success: true, data: { token: share.token as string, url } };
}
