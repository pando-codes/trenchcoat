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

  const apiKeys: ApiKey[] = (data ?? []) as unknown as ApiKey[];

  return <ApiKeyList initialKeys={apiKeys} />;
}
