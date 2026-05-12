import { getAdminClient } from "@/lib/supabase/admin";
import type { ApiKey, ApiKeyValidationResult } from "@/types/api-keys";

export { hasRequiredScopes, requireScopes, API_SCOPES } from "@/types/api-keys";
export type { ApiKey, ApiKeyValidationResult } from "@/types/api-keys";

function generateRandomString(length: number): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((x) => chars[x % chars.length])
    .join("");
}

export function generateApiKey(): {
  plaintext: string;
  hash: string;
  prefix: string;
} {
  const randomPart = generateRandomString(32);
  const plaintext = `ct_live_${randomPart}`;
  const prefix = plaintext.substring(0, 12); // "ct_live_xxxx"
  const hash = hashApiKey(plaintext);
  return { plaintext, hash, prefix };
}

export function hashApiKey(key: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(key).digest("hex");
}

export async function validateApiKey(
  request: Request
): Promise<ApiKeyValidationResult> {
  const apiKeyHeader = request.headers.get("x-api-key");

  if (!apiKeyHeader) {
    return { valid: false, error: "Missing X-API-Key header" };
  }

  if (!apiKeyHeader.startsWith("ct_live_") || apiKeyHeader.length !== 40) {
    return { valid: false, error: "Invalid API key format" };
  }

  const keyHash = hashApiKey(apiKeyHeader);
  const supabase = getAdminClient();

  const { data, error } = await supabase
    .from("api_keys")
    .select("*")
    .eq("key_hash", keyHash)
    .single();

  if (error || !data) {
    return { valid: false, error: "Invalid API key" };
  }

  const apiKey = data as unknown as ApiKey;

  if (apiKey.expires_at && new Date(apiKey.expires_at) < new Date()) {
    return { valid: false, error: "API key has expired" };
  }

  // Update last_used_at (non-blocking) — untyped Supabase client requires cast
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (supabase.from("api_keys") as any)
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", apiKey.id)
    .then(() => {});

  return {
    valid: true,
    key: apiKey,
    user_id: apiKey.user_id,
    scopes: apiKey.scopes || [],
  };
}
