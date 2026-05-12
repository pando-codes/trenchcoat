import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  createApiHandler,
  successResponse,
  badRequest,
  type ApiContext,
} from "@/lib/api-middleware";
import { ingestEvents } from "@/lib/services/events.service";
import type { IngestPayload } from "@/types/events";

const eventSchema = z.object({
  ts: z.string().datetime({ offset: true }),
  event: z.enum([
    "session_start",
    "session_end",
    "tool_use",
    "tool_result",
    "prompt_submit",
    "assistant_stop",
    "subagent_stop",
    "pre_compact",
    "error",
  ]),
  session_id: z.string().min(1),
  seq: z.number().int().min(0),
  data: z.record(z.string(), z.unknown()).default({}),
});

const bodySchema = z.object({
  events: z.array(eventSchema).min(1).max(1000),
});

export const POST = createApiHandler<IngestPayload>(
  {
    scopes: ["write:events"],
    bodySchema,
    rateLimitTier: "ingestion",
  },
  async (_request, context) => {
    const { userId, body } = context;
    const adminClient = getAdminClient();

    const result = await ingestEvents(adminClient, userId, body.events);

    if (!result.success) {
      return badRequest(result.error.details ? `${result.error.message}: ${result.error.details}` : result.error.message);
    }

    return successResponse(result.data, { status: 201 });
  }
);
