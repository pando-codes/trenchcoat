import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  validateApiKey,
  requireScopes,
  type ApiKeyValidationResult,
} from "./api-keys";
import {
  successResponse,
  listResponse,
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  created,
  noContent,
  rateLimited,
  internalError,
  handleSupabaseError,
  ErrorCodes,
  type ApiSuccessResponse,
  type ApiListResponse,
  type ApiErrorResponse,
} from "./api-response";
import { createRateLimiter, rateLimitHeaders, getClientIdentifier } from "./rate-limit";
import { createClient } from "./supabase/server";

// ============================================================================
// Types
// ============================================================================

export interface ApiContext {
  requestId: string;
  userId: string;
  scopes: string[];
  apiKey: ApiKeyValidationResult["key"];
  body?: unknown;
  query?: Record<string, string | undefined>;
  pagination?: { limit: number; offset: number };
}

export interface ApiHandlerOptions<TBody = unknown> {
  scopes?: string[];
  bodySchema?: z.ZodSchema<TBody>;
  pagination?: boolean;
  rateLimitTier?: "standard" | "premium" | "ingestion";
}

export type ApiHandler<TBody = unknown> = (
  request: NextRequest,
  context: ApiContext & { body: TBody },
  params: { params: Promise<Record<string, string>> }
) => Promise<NextResponse>;

// ============================================================================
// Rate Limiters
// ============================================================================

const apiKeyRateLimiters = {
  standard: createRateLimiter({ limit: 60, windowMs: 60_000, prefix: "api:std" }),
  premium: createRateLimiter({ limit: 200, windowMs: 60_000, prefix: "api:pre" }),
  ingestion: createRateLimiter({ limit: 200, windowMs: 60_000, prefix: "api:ing" }),
};

// ============================================================================
// Combined Handler Factory
// ============================================================================

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createApiHandler<TBody = unknown>(
  options: ApiHandlerOptions<TBody>,
  handler: ApiHandler<TBody>
) {
  return async (
    request: NextRequest,
    routeContext: { params: Promise<Record<string, string>> }
  ): Promise<NextResponse> => {
    const requestId = generateRequestId();

    try {
      // CORS preflight
      if (request.method === "OPTIONS") {
        return new NextResponse(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
            "Access-Control-Max-Age": "86400",
          },
        });
      }

      // Authenticate via API key
      const validation = await validateApiKey(request);
      if (!validation.valid) {
        return unauthorized(validation.error || "Invalid API key");
      }

      // Check scopes
      if (options.scopes?.length) {
        const scopeError = requireScopes(
          { scopes: validation.scopes },
          options.scopes
        );
        if (scopeError) return forbidden(scopeError);
      }

      // Rate limit
      const tier = options.rateLimitTier || validation.key?.rate_limit_tier || "standard";
      const limiter =
        apiKeyRateLimiters[tier as keyof typeof apiKeyRateLimiters] ||
        apiKeyRateLimiters.standard;
      const identifier = validation.key?.id || getClientIdentifier(request);
      const rlResult = await limiter.check(identifier);
      if (!rlResult.success) {
        return rateLimited(Math.ceil(rlResult.retryAfter / 1000));
      }

      // Build context
      const context: ApiContext = {
        requestId,
        userId: validation.user_id!,
        scopes: validation.scopes || [],
        apiKey: validation.key,
      };

      // Validate body
      if (options.bodySchema && ["POST", "PUT", "PATCH"].includes(request.method)) {
        const body = await request.json();
        const parsed = options.bodySchema.safeParse(body);
        if (!parsed.success) {
          const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
          return badRequest(msg);
        }
        (context as ApiContext & { body: TBody }).body = parsed.data;
      }

      // Parse pagination
      if (options.pagination) {
        const url = new URL(request.url);
        const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
        const offset = parseInt(url.searchParams.get("offset") || "0");
        context.pagination = { limit, offset };
      }

      // Call handler
      const response = await handler(
        request,
        context as ApiContext & { body: TBody },
        routeContext
      );

      // Add headers
      response.headers.set("X-Request-ID", requestId);
      response.headers.set("Access-Control-Allow-Origin", "*");
      Object.entries(rateLimitHeaders(rlResult)).forEach(([key, value]) => {
        response.headers.set(key, value);
      });

      return response;
    } catch (error) {
      console.error("API request failed:", error);
      return internalError();
    }
  };
}

// ============================================================================
// Session Authentication (for dashboard API routes)
// ============================================================================

export async function authenticateSession() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return { user: null, supabase, error: "Not authenticated" } as const;
  }

  return { user, supabase, error: null } as const;
}

// Re-exports
export {
  successResponse,
  listResponse,
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  created,
  noContent,
  rateLimited,
  internalError,
  handleSupabaseError,
  ErrorCodes,
  type ApiSuccessResponse,
  type ApiListResponse,
  type ApiErrorResponse,
};
