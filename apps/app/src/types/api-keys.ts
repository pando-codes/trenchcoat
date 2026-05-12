export const API_SCOPES = {
  "write:events": "Push telemetry events",
  "read:events": "Read telemetry events",
  "read:sessions": "Read session data",
  "read:analytics": "Read analytics and aggregates",
  admin: "Full access to all resources",
} as const;

export type ApiScopeName = keyof typeof API_SCOPES;

export interface ApiKey {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  rate_limit_tier: string;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface ApiKeyWithPlaintext extends ApiKey {
  plaintext_key: string;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: string[];
  expires_at?: string | null;
}

export interface ApiKeyValidationResult {
  valid: boolean;
  key?: ApiKey;
  user_id?: string;
  scopes?: string[];
  error?: string;
}

export const RATE_LIMIT_TIERS = {
  standard: {
    requests_per_minute: 60,
    requests_per_hour: 1000,
  },
  premium: {
    requests_per_minute: 200,
    requests_per_hour: 5000,
  },
  ingestion: {
    requests_per_minute: 200,
    requests_per_hour: 10000,
  },
} as const;

export type RateLimitTier = keyof typeof RATE_LIMIT_TIERS;

export function hasRequiredScopes(
  keyScopes: string[],
  requiredScopes: string[]
): boolean {
  if (keyScopes.includes("admin")) return true;
  return requiredScopes.every((scope) => keyScopes.includes(scope));
}

export function requireScopes(
  context: { scopes?: string[] },
  requiredScopes: string[]
): string | null {
  if (!context.scopes) return "No scopes available";
  if (!hasRequiredScopes(context.scopes, requiredScopes)) {
    return `Insufficient permissions. Required scopes: ${requiredScopes.join(", ")}`;
  }
  return null;
}
