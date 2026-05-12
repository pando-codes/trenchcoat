import { NextResponse } from "next/server";

export interface ApiSuccessResponse<T> {
  data: T;
  meta?: { requestId?: string; timestamp?: string; [key: string]: unknown };
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
    timestamp?: string;
  };
}

export interface ApiListResponse<T> {
  data: T[];
  pagination: {
    total?: number;
    limit: number;
    offset?: number;
    hasMore: boolean;
  };
  meta?: { requestId?: string; timestamp?: string };
}

export const ErrorCodes = {
  BAD_REQUEST: "BAD_REQUEST",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  RATE_LIMITED: "RATE_LIMITED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  DATABASE_ERROR: "DATABASE_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getStatusFromCode(code: ErrorCode): number {
  const map: Record<string, number> = {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    VALIDATION_ERROR: 422,
    RATE_LIMITED: 429,
    PAYLOAD_TOO_LARGE: 413,
    INTERNAL_ERROR: 500,
    DATABASE_ERROR: 500,
  };
  return map[code] ?? 500;
}

export function successResponse<T>(
  data: T,
  options?: { status?: number; meta?: Record<string, unknown> }
): NextResponse<ApiSuccessResponse<T>> {
  const requestId = generateRequestId();
  return NextResponse.json(
    {
      data,
      meta: { requestId, timestamp: new Date().toISOString(), ...options?.meta },
    },
    {
      status: options?.status ?? 200,
      headers: { "X-Request-ID": requestId },
    }
  );
}

export function listResponse<T>(
  data: T[],
  pagination: ApiListResponse<T>["pagination"]
): NextResponse<ApiListResponse<T>> {
  const requestId = generateRequestId();
  return NextResponse.json(
    {
      data,
      pagination,
      meta: { requestId, timestamp: new Date().toISOString() },
    },
    { status: 200, headers: { "X-Request-ID": requestId } }
  );
}

export function errorResponse(
  code: ErrorCode,
  message: string,
  options?: { status?: number; details?: unknown }
): NextResponse<ApiErrorResponse> {
  const requestId = generateRequestId();
  const status = options?.status ?? getStatusFromCode(code);
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details: options?.details,
        requestId,
        timestamp: new Date().toISOString(),
      },
    },
    { status, headers: { "X-Request-ID": requestId } }
  );
}

export function badRequest(message = "Bad request", details?: unknown) {
  return errorResponse(ErrorCodes.BAD_REQUEST, message, { details });
}

export function unauthorized(message = "Unauthorized") {
  return errorResponse(ErrorCodes.UNAUTHORIZED, message);
}

export function forbidden(message = "Forbidden") {
  return errorResponse(ErrorCodes.FORBIDDEN, message);
}

export function notFound(message = "Resource not found") {
  return errorResponse(ErrorCodes.NOT_FOUND, message);
}

export function rateLimited(retryAfterSeconds: number) {
  return errorResponse(ErrorCodes.RATE_LIMITED, "Too many requests", {
    details: { retryAfter: retryAfterSeconds },
  });
}

export function internalError(message = "Internal server error") {
  return errorResponse(ErrorCodes.INTERNAL_ERROR, message);
}

export function created<T>(data: T) {
  return successResponse(data, { status: 201 });
}

export function noContent() {
  return new NextResponse(null, { status: 204 });
}

export function handleSupabaseError(error: {
  code?: string;
  message?: string;
  details?: string;
}): NextResponse<ApiErrorResponse> {
  if (error.code === "PGRST116") return notFound();
  if (error.code === "23505") return errorResponse(ErrorCodes.CONFLICT, "Resource already exists");
  if (error.code === "42501") return forbidden("Permission denied");
  return errorResponse(ErrorCodes.DATABASE_ERROR, "Database operation failed");
}
