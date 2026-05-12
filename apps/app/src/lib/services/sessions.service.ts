import type { SupabaseClient } from "@supabase/supabase-js";
import type { SessionSummary } from "@/types/analytics";
import type { TelemetryEvent } from "@/types/events";
import type { ServiceResult } from "./types";

// ---------------------------------------------------------------------------
// List sessions
// ---------------------------------------------------------------------------

export interface ListSessionsParams {
  limit?: number;
  offset?: number;
  from?: string; // ISO date string
  to?: string;
}

export async function listSessions(
  supabase: SupabaseClient,
  userId: string,
  params: ListSessionsParams = {}
): Promise<ServiceResult<{ sessions: SessionSummary[]; total: number }>> {
  const limit = params.limit ?? 50;
  const offset = params.offset ?? 0;

  let query = supabase
    .from("sessions")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("started_at", { ascending: false });

  if (params.from) {
    query = query.gte("started_at", params.from);
  }
  if (params.to) {
    query = query.lte("started_at", params.to);
  }

  query = query.range(offset, offset + limit - 1);

  const { data, error, count } = await query;

  if (error) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to list sessions",
        details: error.message,
      },
    };
  }

  return {
    success: true,
    data: {
      sessions: (data as SessionSummary[]) ?? [],
      total: count ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Get single session
// ---------------------------------------------------------------------------

export async function getSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<ServiceResult<SessionSummary>> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .single();

  if (error) {
    return {
      success: false,
      error: {
        code: error.code === "PGRST116" ? "NOT_FOUND" : "QUERY_FAILED",
        message:
          error.code === "PGRST116"
            ? "Session not found"
            : "Failed to get session",
        details: error.message,
      },
    };
  }

  return { success: true, data: data as SessionSummary };
}

// ---------------------------------------------------------------------------
// Get events for a session
// ---------------------------------------------------------------------------

export interface GetSessionEventsParams {
  limit?: number;
  offset?: number;
}

export async function getSessionEvents(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  params: GetSessionEventsParams = {}
): Promise<ServiceResult<{ events: TelemetryEvent[]; total: number }>> {
  const limit = params.limit ?? 100;
  const offset = params.offset ?? 0;

  const { data, error, count } = await supabase
    .from("events")
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .eq("session_id", sessionId)
    .order("seq", { ascending: true })
    .range(offset, offset + limit - 1);

  if (error) {
    return {
      success: false,
      error: {
        code: "QUERY_FAILED",
        message: "Failed to get session events",
        details: error.message,
      },
    };
  }

  return {
    success: true,
    data: {
      events: (data as TelemetryEvent[]) ?? [],
      total: count ?? 0,
    },
  };
}
