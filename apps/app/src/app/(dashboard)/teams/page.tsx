import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TeamListClient } from "@/components/teams/team-list-client";

export default async function TeamsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: memberships } = await supabase
    .from("team_members")
    .select("team_id, role, teams(id, name, slug, created_at)")
    .eq("user_id", user.id);

  const teams = (memberships || []).map((m) => ({
    ...(m.teams as unknown as Record<string, unknown>),
    role: m.role,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="text-muted-foreground">Manage your teams and view aggregate analytics.</p>
        </div>
      </div>
      <TeamListClient teams={teams as Array<{ id: string; name: string; slug: string; created_at: string; role: string }>} />
    </div>
  );
}
