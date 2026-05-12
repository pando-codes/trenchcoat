"use server";

import { createClient } from "@/lib/supabase/server";

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
