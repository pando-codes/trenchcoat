import { getAdminClient } from "@/lib/supabase/admin";
import {
  createApiHandler,
  successResponse,
  badRequest,
} from "@/lib/api-middleware";
import { listSessions } from "@/lib/services/sessions.service";
import { NextRequest } from "next/server";

export const GET = createApiHandler(
  {
    scopes: ["read:sessions"],
    pagination: true,
  },
  async (request: NextRequest, context) => {
    const { userId, pagination } = context;
    const url = new URL(request.url);
    const from = url.searchParams.get("from") ?? undefined;
    const to = url.searchParams.get("to") ?? undefined;

    const adminClient = getAdminClient();
    const result = await listSessions(adminClient, userId, {
      limit: pagination?.limit,
      offset: pagination?.offset,
      from,
      to,
    });

    if (!result.success) {
      return badRequest(result.error.message);
    }

    return successResponse({
      sessions: result.data.sessions,
      pagination: {
        total: result.data.total,
        limit: pagination?.limit ?? 50,
        offset: pagination?.offset ?? 0,
        hasMore:
          (pagination?.offset ?? 0) + (pagination?.limit ?? 50) <
          result.data.total,
      },
    });
  }
);
