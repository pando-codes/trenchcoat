import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { listApiKeys } from "@/lib/services/api-keys.service";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const displayName =
    user.user_metadata?.display_name ??
    user.user_metadata?.full_name ??
    user.email ??
    "User";
  const avatarUrl = user.user_metadata?.avatar_url ?? null;

  // Machines = the user's API keys (one key per machine/environment).
  const keysResult = await listApiKeys(supabase, user.id);
  const machines = keysResult.success
    ? keysResult.data.map((k) => ({ id: k.id, name: k.name }))
    : [];

  return (
    <div className="flex min-h-screen">
      <Sidebar
        userName={displayName}
        avatarUrl={avatarUrl}
        userEmail={user.email ?? ""}
      />
      <div className="flex flex-1 flex-col md:ml-64 min-h-screen">
        <Topbar
          userName={displayName}
          avatarUrl={avatarUrl}
          userEmail={user.email ?? ""}
          machines={machines}
        />
        <main className="flex-1 bg-background">
          {children}
        </main>
      </div>
    </div>
  );
}
