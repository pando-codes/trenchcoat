import { describe, it, expect } from "bun:test";
import {
  successResponse,
  listResponse,
  errorResponse,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  rateLimited,
  internalError,
  created,
  noContent,
  handleSupabaseError,
  ErrorCodes,
} from "../api-response";

// --- successResponse ---

describe("successResponse", () => {
  it("returns 200 by default", () => {
    expect(successResponse({ id: 1 }).status).toBe(200);
  });

  it("wraps data in { data } envelope", async () => {
    const body = await successResponse({ name: "test" }).json();
    expect(body.data).toEqual({ name: "test" });
  });

  it("includes meta with requestId and timestamp", async () => {
    const body = await successResponse({}).json();
    expect(body.meta.requestId).toBeTruthy();
    expect(body.meta.timestamp).toBeTruthy();
  });

  it("accepts a custom status code", () => {
    expect(successResponse({}, { status: 202 }).status).toBe(202);
  });

  it("merges extra meta fields", async () => {
    const body = await successResponse({}, { meta: { page: 2 } }).json();
    expect(body.meta.page).toBe(2);
  });

  it("sets X-Request-ID response header", () => {
    const res = successResponse({});
    expect(res.headers.get("X-Request-ID")).toBeTruthy();
  });
});

// --- listResponse ---

describe("listResponse", () => {
  it("returns 200", () => {
    expect(listResponse([], { limit: 10, hasMore: false }).status).toBe(200);
  });

  it("includes data array and pagination in body", async () => {
    const body = await listResponse([1, 2], { total: 5, limit: 2, hasMore: true }).json();
    expect(body.data).toEqual([1, 2]);
    expect(body.pagination).toEqual({ total: 5, limit: 2, hasMore: true });
  });
});

// --- errorResponse status code mapping ---

describe("errorResponse", () => {
  it("BAD_REQUEST → 400", () => {
    expect(errorResponse(ErrorCodes.BAD_REQUEST, "bad").status).toBe(400);
  });

  it("UNAUTHORIZED → 401", () => {
    expect(errorResponse(ErrorCodes.UNAUTHORIZED, "x").status).toBe(401);
  });

  it("FORBIDDEN → 403", () => {
    expect(errorResponse(ErrorCodes.FORBIDDEN, "x").status).toBe(403);
  });

  it("NOT_FOUND → 404", () => {
    expect(errorResponse(ErrorCodes.NOT_FOUND, "x").status).toBe(404);
  });

  it("CONFLICT → 409", () => {
    expect(errorResponse(ErrorCodes.CONFLICT, "x").status).toBe(409);
  });

  it("VALIDATION_ERROR → 422", () => {
    expect(errorResponse(ErrorCodes.VALIDATION_ERROR, "x").status).toBe(422);
  });

  it("RATE_LIMITED → 429", () => {
    expect(errorResponse(ErrorCodes.RATE_LIMITED, "x").status).toBe(429);
  });

  it("INTERNAL_ERROR → 500", () => {
    expect(errorResponse(ErrorCodes.INTERNAL_ERROR, "x").status).toBe(500);
  });

  it("DATABASE_ERROR → 500", () => {
    expect(errorResponse(ErrorCodes.DATABASE_ERROR, "x").status).toBe(500);
  });

  it("places code and message inside error envelope", async () => {
    const body = await errorResponse(ErrorCodes.BAD_REQUEST, "invalid input").json();
    expect(body.error.code).toBe("BAD_REQUEST");
    expect(body.error.message).toBe("invalid input");
  });

  it("includes optional details", async () => {
    const body = await errorResponse(ErrorCodes.BAD_REQUEST, "x", { details: { field: "name" } }).json();
    expect(body.error.details).toEqual({ field: "name" });
  });
});

// --- shorthand helpers ---

describe("shorthand helpers", () => {
  it("badRequest returns 400", () => {
    expect(badRequest().status).toBe(400);
  });

  it("unauthorized returns 401", () => {
    expect(unauthorized().status).toBe(401);
  });

  it("forbidden returns 403", () => {
    expect(forbidden().status).toBe(403);
  });

  it("notFound returns 404", () => {
    expect(notFound().status).toBe(404);
  });

  it("rateLimited returns 429 with retryAfter in body", async () => {
    const res = rateLimited(30);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.details.retryAfter).toBe(30);
  });

  it("internalError returns 500", () => {
    expect(internalError().status).toBe(500);
  });

  it("created returns 201", () => {
    expect(created({ id: "x" }).status).toBe(201);
  });

  it("noContent returns 204", () => {
    expect(noContent().status).toBe(204);
  });
});

// --- handleSupabaseError ---

describe("handleSupabaseError", () => {
  it("PGRST116 (not found) → 404", () => {
    expect(handleSupabaseError({ code: "PGRST116" }).status).toBe(404);
  });

  it("23505 (unique violation) → 409", () => {
    expect(handleSupabaseError({ code: "23505" }).status).toBe(409);
  });

  it("42501 (permission denied) → 403", () => {
    expect(handleSupabaseError({ code: "42501" }).status).toBe(403);
  });

  it("unknown postgres code → 500", () => {
    expect(handleSupabaseError({ code: "99999" }).status).toBe(500);
  });

  it("missing code → 500", () => {
    expect(handleSupabaseError({}).status).toBe(500);
  });
});
