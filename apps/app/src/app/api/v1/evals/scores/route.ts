import { z } from "zod";
import { getAdminClient } from "@/lib/supabase/admin";
import { createApiHandler, successResponse, badRequest } from "@/lib/api-middleware";
import { upsertEvalScores } from "@/lib/services/evals.service";

const scoreSchema = z.object({
  session_id: z.string().min(1),
  metric: z.string().min(1).max(64),
  value: z.number().finite(),
});

export const bodySchema = z.object({
  scores: z.array(scoreSchema).min(1).max(1000),
});

type Body = z.infer<typeof bodySchema>;

export const POST = createApiHandler<Body>(
  {
    scopes: ["write:events"],
    bodySchema,
    rateLimitTier: "ingestion",
  },
  async (_request, context) => {
    const { userId, body } = context;
    const result = await upsertEvalScores(getAdminClient(), userId, body.scores);

    if (!result.success) {
      return badRequest(result.error.message);
    }

    return successResponse(result.data, { status: 201 });
  }
);
