import type { SupabaseClient } from "@supabase/supabase-js";
import { generateApiKey } from "@/lib/api-keys";
import {
  API_SCOPES,
  type ApiKey,
  type ApiKeyWithPlaintext,
  type CreateApiKeyInput,
  type ApiScopeName,
} from "@/types/api-keys";
import type { ServiceResult } from "./types";

// ---------------------------------------------------------------------------
// List API keys
// ---------------------------------------------------------------------------

export async function listApiKeys(
  supabase: SupabaseClient,
  userId: string
): Promise<ServiceResult<ApiKey[]>> {
  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to list API keys",
        details: error.message,
      },
    };
  }

  return { success: true, data: (data as ApiKey[]) ?? [] };
}

// ---------------------------------------------------------------------------
// Create API key
// ---------------------------------------------------------------------------

export async function createApiKey(
  supabase: SupabaseClient,
  userId: string,
  input: CreateApiKeyInput
): Promise<ServiceResult<ApiKeyWithPlaintext>> {
  // Validate scopes
  const validScopes = Object.keys(API_SCOPES) as ApiScopeName[];
  const invalidScopes = input.scopes.filter(
    (s) => !validScopes.includes(s as ApiScopeName)
  );

  if (invalidScopes.length > 0) {
    return {
      success: false,
      error: {
        code: "INVALID_SCOPES",
        message: `Invalid scopes: ${invalidScopes.join(", ")}`,
        details: { valid_scopes: validScopes },
      },
    };
  }

  if (input.scopes.length === 0) {
    return {
      success: false,
      error: {
        code: "INVALID_SCOPES",
        message: "At least one scope is required",
      },
    };
  }

  const { plaintext, hash, prefix } = generateApiKey();

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: userId,
      name: input.name,
      key_hash: hash,
      key_prefix: prefix,
      scopes: input.scopes,
      expires_at: input.expires_at ?? null,
    })
    .select()
    .single();

  if (error) {
    return {
      success: false,
      error: {
        code: "CREATE_FAILED",
        message: "Failed to create API key",
        details: error.message,
      },
    };
  }

  return {
    success: true,
    data: {
      ...(data as ApiKey),
      plaintext_key: plaintext,
    },
  };
}

// ---------------------------------------------------------------------------
// Revoke (delete) API key
// ---------------------------------------------------------------------------

export async function revokeApiKey(
  supabase: SupabaseClient,
  userId: string,
  keyId: string
): Promise<ServiceResult<{ revoked: boolean }>> {
  const { error, count } = await supabase
    .from("api_keys")
    .delete({ count: "exact" })
    .eq("id", keyId)
    .eq("user_id", userId);

  if (error) {
    return {
      success: false,
      error: {
        code: "DELETE_FAILED",
        message: "Failed to revoke API key",
        details: error.message,
      },
    };
  }

  if (count === 0) {
    return {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "API key not found",
      },
    };
  }

  return { success: true, data: { revoked: true } };
}
