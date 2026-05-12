import { getAdminClient } from "@/lib/supabase/admin";
import {
  createApiHandler,
  successResponse,
  badRequest,
} from "@/lib/api-middleware";
import { getOverviewStats } from "@/lib/services/analytics.service";
import { NextRequest } from "next/server";

export const GET = createApiHandler(
  {
    scopes: ["read:analytics"],
  },
  async (request: NextRequest, context) => {
    const { userId } = context;
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to) {
      return badRequest("Missing required query parameters: from, to (YYYY-MM-DD)");
    }

    const adminClient = getAdminClient();
    const result = await getOverviewStats(adminClient, userId, from, to);

    if (!result.success) {
      return badRequest(result.error.message);
    }

    return successResponse(result.data);
  }
);
