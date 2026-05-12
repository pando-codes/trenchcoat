import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Team,
  TeamWithMembers,
  TeamMember,
  TeamRole,
} from "@/types/teams";
import type { ServiceResult } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// List teams for a user
// ---------------------------------------------------------------------------

export async function listTeams(
  supabase: SupabaseClient,
  userId: string
): Promise<ServiceResult<Team[]>> {
  // Get teams where user is a member
  const { data: memberships, error: memberError } = await supabase
    .from("team_members")
    .select("team_id")
    .eq("user_id", userId);

  if (memberError) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to list teams",
        details: memberError.message,
      },
    };
  }

  if (!memberships || memberships.length === 0) {
    return { success: true, data: [] };
  }

  const teamIds = memberships.map((m) => m.team_id);

  const { data, error } = await supabase
    .from("teams")
    .select("*")
    .in("id", teamIds)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to list teams",
        details: error.message,
      },
    };
  }

  return { success: true, data: (data as Team[]) ?? [] };
}

// ---------------------------------------------------------------------------
// Create team
// ---------------------------------------------------------------------------

export async function createTeam(
  supabase: SupabaseClient,
  userId: string,
  input: { name: string }
): Promise<ServiceResult<Team>> {
  const slug = slugify(input.name) || `team-${Date.now().toString(36)}`;

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .insert({
      name: input.name,
      slug,
      created_by: userId,
    })
    .select()
    .single();

  if (teamError) {
    return {
      success: false,
      error: {
        code: teamError.code === "23505" ? "CONFLICT" : "CREATE_FAILED",
        message:
          teamError.code === "23505"
            ? "A team with this slug already exists"
            : "Failed to create team",
        details: teamError.message,
      },
    };
  }

  // Auto-add creator as owner
  const { error: memberError } = await supabase.from("team_members").insert({
    team_id: team.id,
    user_id: userId,
    role: "owner",
  });

  if (memberError) {
    // Roll back team creation on membership failure
    await supabase.from("teams").delete().eq("id", team.id);
    return {
      success: false,
      error: {
        code: "CREATE_FAILED",
        message: "Failed to add creator as team owner",
        details: memberError.message,
      },
    };
  }

  return { success: true, data: team as Team };
}

// ---------------------------------------------------------------------------
// Get team with members
// ---------------------------------------------------------------------------

export async function getTeam(
  supabase: SupabaseClient,
  userId: string,
  teamId: string
): Promise<ServiceResult<TeamWithMembers>> {
  // Verify user is a member of this team
  const { data: membership, error: memberCheckError } = await supabase
    .from("team_members")
    .select("id")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .single();

  if (memberCheckError || !membership) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Team not found or you are not a member",
      },
    };
  }

  const { data: team, error: teamError } = await supabase
    .from("teams")
    .select("*")
    .eq("id", teamId)
    .single();

  if (teamError || !team) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Team not found",
      },
    };
  }

  const { data: members, error: membersError } = await supabase
    .from("team_members")
    .select("*")
    .eq("team_id", teamId)
    .order("joined_at", { ascending: true });

  if (membersError) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to fetch team members",
        details: membersError.message,
      },
    };
  }

  return {
    success: true,
    data: {
      ...(team as Team),
      members: (members as TeamMember[]) ?? [],
      member_count: members?.length ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Invite member
// ---------------------------------------------------------------------------

export async function inviteMember(
  supabase: SupabaseClient,
  userId: string,
  teamId: string,
  input: { email: string; role: TeamRole }
): Promise<ServiceResult<{ invited: boolean }>> {
  // Verify the inviting user is owner or admin
  const { data: inviterMembership, error: inviterError } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .single();

  if (inviterError || !inviterMembership) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "You are not a member of this team",
      },
    };
  }

  if (
    inviterMembership.role !== "owner" &&
    inviterMembership.role !== "admin"
  ) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Only owners and admins can invite members",
      },
    };
  }

  // Prevent inviting someone as owner (only one owner via creation)
  const inviteRole = input.role === "owner" ? "admin" : input.role;

  const { error: inviteError } = await supabase
    .from("team_invitations")
    .insert({
      team_id: teamId,
      email: input.email,
      role: inviteRole,
      invited_by: userId,
    });

  if (inviteError) {
    return {
      success: false,
      error: {
        code: "INVITE_FAILED",
        message: "Failed to create invitation",
        details: inviteError.message,
      },
    };
  }

  return { success: true, data: { invited: true } };
}

// ---------------------------------------------------------------------------
// Remove member
// ---------------------------------------------------------------------------

export async function removeMember(
  supabase: SupabaseClient,
  userId: string,
  teamId: string,
  memberId: string
): Promise<ServiceResult<{ removed: boolean }>> {
  // Verify the requesting user is owner or admin
  const { data: requesterMembership, error: requesterError } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .single();

  if (requesterError || !requesterMembership) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "You are not a member of this team",
      },
    };
  }

  if (
    requesterMembership.role !== "owner" &&
    requesterMembership.role !== "admin"
  ) {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Only owners and admins can remove members",
      },
    };
  }

  // Fetch the member to remove
  const { data: targetMember, error: targetError } = await supabase
    .from("team_members")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("team_id", teamId)
    .single();

  if (targetError || !targetMember) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Team member not found",
      },
    };
  }

  // Prevent removing the owner
  if (targetMember.role === "owner") {
    return {
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "Cannot remove the team owner",
      },
    };
  }

  const { error: deleteError } = await supabase
    .from("team_members")
    .delete()
    .eq("id", memberId)
    .eq("team_id", teamId);

  if (deleteError) {
    return {
      success: false,
      error: {
        code: "DELETE_FAILED",
        message: "Failed to remove team member",
        details: deleteError.message,
      },
    };
  }

  return { success: true, data: { removed: true } };
}
