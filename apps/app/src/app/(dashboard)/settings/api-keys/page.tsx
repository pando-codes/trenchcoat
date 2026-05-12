import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ApiKeyList } from "@/components/settings/api-key-list";
import type { ApiKey } from "@/types/api-keys";

export default async function ApiKeysPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data } = await supabase
    .from("api_keys")
    .select("id, user_id, name, key_prefix, scopes, rate_limit_tier, last_used_at, expires_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const apiKeys: ApiKey[] = data ?? [];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Keys</h1>
        <p className="text-sm text-muted-foreground">
          Manage your API keys for telemetry ingestion.
        </p>
      </div>

      <ApiKeyList initialKeys={apiKeys} />
    </div>
  );
}
