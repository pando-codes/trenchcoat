"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api-keys";
import type { ApiKey } from "@/types/api-keys";

interface CreateApiKeyInput {
  name: string;
  scopes: string[];
}

interface ActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

export async function createApiKeyAction(
  input: CreateApiKeyInput
): Promise<ActionResult<{ key: ApiKey; plaintext_key: string }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { plaintext, hash, prefix } = generateApiKey();

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: user.id,
      name: input.name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: input.scopes,
      rate_limit_tier: "standard",
    })
    .select("id, user_id, name, key_prefix, scopes, rate_limit_tier, last_used_at, expires_at, created_at")
    .single();

  if (error || !data) {
    return {
      success: false,
      error: error?.message ?? "Failed to create API key",
    };
  }

  return {
    success: true,
    data: {
      key: data as ApiKey,
      plaintext_key: plaintext,
    },
  };
}

export async function revokeApiKeyAction(
  keyId: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { error } = await supabase
    .from("api_keys")
    .delete()
    .eq("id", keyId)
    .eq("user_id", user.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
