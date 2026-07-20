# Eval Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an AI Engineer group runs into an experiment, attach outcome scores, and compare variants' cost against their results.

**Architecture:** Env-var tags captured on `session_start` → promoted onto `sessions` → joined with an `eval_scores` table written by a new API endpoint → aggregated per variant by an RPC → rendered as a comparison view.

**Tech Stack:** Python plugin hooks + pytest; Supabase/Postgres plpgsql; Next.js 16 RSC; `bun test`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-eval-workflows-design.md`. This plan implements Spec C only.
- **Versioned agent identity is OUT OF SCOPE** — agent identity stays the `agent_type` string. Do not add version fields anywhere.
- Env var names are exactly `TRENCHCOAT_EVAL_ID` and `TRENCHCOAT_EVAL_VARIANT`. Values capped at 128 chars.
- Capture changes are ADDITIVE inside `session_start` event `data` — no ingest Zod change.
- Promotion onto `sessions` must EXTEND the existing `session_start` enrichment block in `events.service.ts` (the one handling `parent_session_id`/`spawner_id`/`spawner_type`), not duplicate it.
- The scores endpoint reuses the EXISTING `write:events` scope (no new scope, no key re-issuance). Batch cap 1000, mirroring `events/route.ts`.
- Unknown `session_id` on a posted score is ACCEPTED and stored (the comparison query inner-joins, so orphans are invisible until the session arrives). Do not reject.
- Cost math: `tokens × model_pricing / 1_000_000`, `left join public.model_pricing mp on mp.model_id = s.model`; null pricing contributes 0.
- New RPCs return `json` → `create or replace` only, no `drop function`.
- Migrations append-only, sequential from `026`.
- RLS on new tables mirrors `events` (`004_events.sql:45-58`): users select own rows; service role inserts/reads all.
- Averages must always be shown with their sample count; never assert a winner.
- **Tests:** plugin → `cd claude-plugin && uv run --with pytest pytest tests/ -q` (baseline 112); app → `cd apps/app && bun test` (baseline 403). Service tests mock via `createMockSupabase`. No component/DB harness — UI verified by `bunx tsc --noEmit` (a ~35-error pre-existing `bun:test` baseline) + manual run; RPCs by service shape tests + manual SQL smoke.
- **Commit** after each task with the shown message.

---

## File Structure

**New**
- `supabase/migrations/026_eval_tagging.sql` — `sessions.eval_id`/`eval_variant` + index; `eval_scores` table + RLS.
- `supabase/migrations/027_eval_rpcs.sql` — `get_eval_comparison`, `get_eval_list`.
- `apps/app/src/app/api/v1/evals/scores/route.ts` — POST endpoint.
- `apps/app/src/lib/services/evals.service.ts` (+ `apps/app/src/lib/__tests__/evals.service.test.ts`)
- `apps/app/src/lib/analytics/eval-comparison.ts` (+ tests) — pure delta/low-sample helper.
- `apps/app/src/app/(dashboard)/evals/page.tsx`, `evals/[id]/page.tsx`, `evals/loading.tsx`

**Modified**
- `claude-plugin/hooks/session_start.py` (+ `claude-plugin/tests/test_telemetry.py`)
- `apps/app/src/lib/services/events.service.ts` (+ its test)
- `apps/app/src/types/analytics.ts`
- `apps/docs/content/docs/plugin-sdk/event-schema.mdx`, `apps/docs/content/docs/api-reference/` (new endpoint)

---

## Task 1: Capture eval tags on `session_start`

**Files:** Modify `claude-plugin/hooks/session_start.py`; Test `claude-plugin/tests/test_telemetry.py`

**Interfaces:** Produces `session_start` events carrying optional `eval_id` / `eval_variant`.

- [ ] **Step 1: Write the failing tests**

Add to `class TestHookIntegration` in `claude-plugin/tests/test_telemetry.py` (reuse the existing `_run_hook` and `_read_events` helpers; `_run_hook` accepts `extra_env`):

```python
    def test_session_start_records_eval_tags_from_env(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s", "cwd": "/tmp"},
                       extra_env={"TRENCHCOAT_EVAL_ID": "deep-research",
                                  "TRENCHCOAT_EVAL_VARIANT": "v3"})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert start["data"]["eval_id"] == "deep-research"
        assert start["data"]["eval_variant"] == "v3"

    def test_session_start_without_eval_env_has_no_eval_keys(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s2", "cwd": "/tmp"})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert "eval_id" not in start["data"]
        assert "eval_variant" not in start["data"]

    def test_session_start_truncates_overlong_eval_values(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "e-s3", "cwd": "/tmp"},
                       extra_env={"TRENCHCOAT_EVAL_ID": "x" * 300})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert len(start["data"]["eval_id"]) == 128
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k eval -q`
Expected: FAIL — no `eval_id` key.

- [ ] **Step 3: Implement**

In `claude-plugin/hooks/session_start.py`, after the existing `event_data` construction and spawn-context block (ensure `import os` exists at top):

```python
    eval_id = os.environ.get("TRENCHCOAT_EVAL_ID")
    if eval_id:
        event_data["eval_id"] = eval_id[:128]

    eval_variant = os.environ.get("TRENCHCOAT_EVAL_VARIANT")
    if eval_variant:
        event_data["eval_variant"] = eval_variant[:128]
```

Place this BEFORE the `write_event("session_start", session_id, event_data)` call.

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q`
Expected: all pass (was 112, now 115).

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/hooks/session_start.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): capture eval id/variant from env on session_start"
```

---

## Task 2: Storage — sessions columns, `eval_scores` table, promotion

**Files:** Create `supabase/migrations/026_eval_tagging.sql`; Modify `apps/app/src/lib/services/events.service.ts`; Test `apps/app/src/lib/__tests__/events.service.test.ts`

**Interfaces:** Produces `sessions.eval_id`/`eval_variant`; table `eval_scores`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/026_eval_tagging.sql`:

```sql
-- 026: Eval tagging — session eval columns + outcome scores table.

alter table public.sessions
  add column if not exists eval_id      text,
  add column if not exists eval_variant text;

create index if not exists idx_sessions_user_eval
  on public.sessions(user_id, eval_id)
  where eval_id is not null;

create table if not exists public.eval_scores (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  metric     text not null,
  value      numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, session_id, metric)
);

create index if not exists idx_eval_scores_user_session
  on public.eval_scores(user_id, session_id);

alter table public.eval_scores enable row level security;

create policy "Users can view own eval scores"
  on public.eval_scores for select
  using (auth.uid() = user_id);

create policy "Service role can insert eval scores"
  on public.eval_scores for insert
  with check (auth.role() = 'service_role');

create policy "Service role can read all eval scores"
  on public.eval_scores for select
  using (auth.role() = 'service_role');

create policy "Service role can update eval scores"
  on public.eval_scores for update
  using (auth.role() = 'service_role');
```

- [ ] **Step 2: Write the failing promotion test**

Add to `apps/app/src/lib/__tests__/events.service.test.ts` — match the file's existing mocking style for `ingestEvents` (read it first and mirror how it asserts session updates):

```ts
it("promotes eval_id and eval_variant from session_start onto the session", async () => {
  // Follow this file's existing ingestEvents + mock-client pattern.
  // Feed a session_start event with data { eval_id: "deep-research", eval_variant: "v3" }
  // and assert the sessions update payload contains both fields.
});
```

Replace the comment with a concrete test built on whatever helper the file already uses (do not invent a new mocking approach).

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/events.service.test.ts`
Expected: FAIL — fields not promoted.

- [ ] **Step 4: Extend the promotion block**

In `apps/app/src/lib/services/events.service.ts`, inside the EXISTING `if (e.event === "session_start")` block (currently reading `parent_session_id`/`spawner_id`/`spawner_type`), add:

```ts
      const evalId = (e.data?.eval_id as string) ?? null;
      const evalVariant = (e.data?.eval_variant as string) ?? null;
```

extend the guard so eval-only sessions still update:

```ts
      if (parentSessionId || spawnerId || evalId || evalVariant) {
```

and add to the `update` object:

```ts
        if (evalId) update.eval_id = evalId;
        if (evalVariant) update.eval_variant = evalVariant;
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/app && bun test src/lib/__tests__/events.service.test.ts` → PASS. Then `bun test` (full app suite) → all pass.

- [ ] **Step 6: Manual SQL smoke (pending-manual if no DB available)**

Apply migration; confirm `sessions` has the two columns and `eval_scores` exists with its unique constraint and RLS enabled.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/026_eval_tagging.sql apps/app/src/lib/services/events.service.ts apps/app/src/lib/__tests__/events.service.test.ts
git commit -m "feat(evals): add eval columns, eval_scores table, and tag promotion"
```

---

## Task 3: Scores ingest endpoint

**Files:** Create `apps/app/src/lib/services/evals.service.ts`, `apps/app/src/app/api/v1/evals/scores/route.ts`; Test `apps/app/src/lib/__tests__/evals.service.test.ts`

**Interfaces:** Produces `upsertEvalScores(supabase, userId, scores): Promise<ServiceResult<{ inserted: number }>>`; `POST /api/v1/evals/scores`.

- [ ] **Step 1: Write the failing service test**

Create `apps/app/src/lib/__tests__/evals.service.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { upsertEvalScores } from "../services/evals.service";
import { createMockSupabase } from "./helpers/supabase-mock";

const USER_ID = "user-abc";

describe("upsertEvalScores", () => {
  it("returns the number of scores written on success", async () => {
    const supabase = createMockSupabase({ eval_scores: { data: [], error: null } });
    const result = await upsertEvalScores(supabase, USER_ID, [
      { session_id: "s1", metric: "accuracy", value: 0.82 },
      { session_id: "s1", metric: "pass_rate", value: 1 },
    ]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.inserted).toBe(2);
  });

  it("returns QUERY_FAILED on db error", async () => {
    const supabase = createMockSupabase({
      eval_scores: { data: null, error: { message: "boom" } },
    });
    const result = await upsertEvalScores(supabase, USER_ID, [
      { session_id: "s1", metric: "accuracy", value: 0.5 },
    ]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("QUERY_FAILED");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/evals.service.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement the service**

Create `apps/app/src/lib/services/evals.service.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceResult } from "./types";

export interface EvalScoreInput {
  session_id: string;
  metric: string;
  value: number;
}

export async function upsertEvalScores(
  supabase: SupabaseClient,
  userId: string,
  scores: EvalScoreInput[]
): Promise<ServiceResult<{ inserted: number }>> {
  const rows = scores.map((s) => ({
    user_id: userId,
    session_id: s.session_id,
    metric: s.metric,
    value: s.value,
  }));

  const { error } = await supabase
    .from("eval_scores")
    .upsert(rows, { onConflict: "user_id,session_id,metric" });

  if (error) {
    return {
      success: false,
      error: { code: "QUERY_FAILED", message: "Failed to write eval scores", details: error.message },
    };
  }

  return { success: true, data: { inserted: rows.length } };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test src/lib/__tests__/evals.service.test.ts` → PASS.

- [ ] **Step 5: Add the route**

Create `apps/app/src/app/api/v1/evals/scores/route.ts`, mirroring `apps/app/src/app/api/v1/events/route.ts`:

```ts
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
```

- [ ] **Step 6: Typecheck + full suite**

Run: `cd apps/app && bunx tsc --noEmit` (no new errors) and `bun test` (all pass).

- [ ] **Step 7: Commit**

```bash
git add apps/app/src/lib/services/evals.service.ts apps/app/src/lib/__tests__/evals.service.test.ts apps/app/src/app/api/v1/evals/
git commit -m "feat(evals): add eval scores ingest endpoint"
```

---

## Task 4: Comparison RPCs + service methods

**Files:** Create `supabase/migrations/027_eval_rpcs.sql`; Modify `apps/app/src/types/analytics.ts`, `apps/app/src/lib/services/evals.service.ts`; Test `apps/app/src/lib/__tests__/evals.service.test.ts`

**Interfaces:** Produces types `EvalListEntry`, `EvalVariantStat`; `getEvalList(supabase, userId, from, to)`, `getEvalComparison(supabase, userId, evalId)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/027_eval_rpcs.sql`:

```sql
-- 027: Eval list + per-variant comparison. Both return json (no drop needed).

create or replace function public.get_eval_list(
  p_user_id uuid,
  p_from    date,
  p_to      date
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.last_run desc), '[]') into result
  from (
    select
      s.eval_id,
      count(distinct s.eval_variant) as variant_count,
      count(*)                       as session_count,
      max(s.started_at)              as last_run
    from public.sessions s
    where s.user_id = p_user_id
      and s.eval_id is not null
      and s.started_at::date between p_from and p_to
    group by s.eval_id
  ) t;
  return result;
end;
$$ language plpgsql security definer;


create or replace function public.get_eval_comparison(
  p_user_id uuid,
  p_eval_id text
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.eval_variant), '[]') into result
  from (
    select
      coalesce(v.eval_variant, 'untagged') as eval_variant,
      v.session_count,
      v.total_input_tokens,
      v.total_output_tokens,
      round(v.total_cost_usd::numeric, 6) as total_cost_usd,
      round(v.avg_duration_ms::numeric, 0) as avg_duration_ms,
      coalesce(sc.scores, '{}'::jsonb)     as scores
    from (
      select
        s.eval_variant,
        count(*)                                        as session_count,
        sum(coalesce(s.input_tokens, 0))                as total_input_tokens,
        sum(coalesce(s.output_tokens, 0))               as total_output_tokens,
        sum(
          coalesce(s.input_tokens, 0)  * coalesce(mp.input_cost_per_1m, 0)  / 1000000.0 +
          coalesce(s.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
        )                                               as total_cost_usd,
        avg(s.duration_ms)                              as avg_duration_ms
      from public.sessions s
      left join public.model_pricing mp on mp.model_id = s.model
      where s.user_id = p_user_id
        and s.eval_id = p_eval_id
      group by s.eval_variant
    ) v
    left join (
      select
        m.eval_variant,
        jsonb_object_agg(m.metric, jsonb_build_object('avg', m.avg_value, 'count', m.n)) as scores
      from (
        select s3.eval_variant, es.metric,
               avg(es.value) as avg_value,
               count(*)      as n
        from public.eval_scores es
        join public.sessions s3
          on  s3.session_id = es.session_id
          and s3.user_id    = es.user_id
        where es.user_id = p_user_id
          and s3.eval_id = p_eval_id
        group by s3.eval_variant, es.metric
      ) m
      group by m.eval_variant
    ) sc on sc.eval_variant is not distinct from v.eval_variant
  ) t;
  return result;
end;
$$ language plpgsql security definer;
```

> Note the `is not distinct from` joins: `eval_variant` may be NULL for untagged-variant sessions, and plain `=` would drop those rows.

- [ ] **Step 2: Add types**

In `apps/app/src/types/analytics.ts`:

```ts
export interface EvalListEntry {
  eval_id: string;
  variant_count: number;
  session_count: number;
  last_run: string;
}

export interface EvalScoreSummary {
  avg: number;
  count: number;
}

export interface EvalVariantStat {
  eval_variant: string;
  session_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_cost_usd: number;
  avg_duration_ms: number | null;
  scores: Record<string, EvalScoreSummary>;
}
```

- [ ] **Step 3: Write the failing service tests**

Add to `apps/app/src/lib/__tests__/evals.service.test.ts`:

```ts
import { getEvalList, getEvalComparison } from "../services/evals.service";

describe("getEvalList", () => {
  it("maps eval rows", async () => {
    const rows = [{ eval_id: "deep-research", variant_count: 2, session_count: 9, last_run: "2026-07-19T00:00:00Z" }];
    const supabase = createMockSupabase({}, { get_eval_list: { data: rows } });
    const result = await getEvalList(supabase, USER_ID, "2026-07-01", "2026-07-19");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0].variant_count).toBe(2);
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, { get_eval_list: { data: null, error: { message: "boom" } } });
    const result = await getEvalList(supabase, USER_ID, "2026-07-01", "2026-07-19");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});

describe("getEvalComparison", () => {
  it("maps variant stats including scores", async () => {
    const rows = [{
      eval_variant: "v3", session_count: 5, total_input_tokens: 100, total_output_tokens: 20,
      total_cost_usd: 1.25, avg_duration_ms: 42000,
      scores: { accuracy: { avg: 0.82, count: 5 } },
    }];
    const supabase = createMockSupabase({}, { get_eval_comparison: { data: rows } });
    const result = await getEvalComparison(supabase, USER_ID, "deep-research");
    if (result.success) {
      expect(result.data[0].eval_variant).toBe("v3");
      expect(result.data[0].scores.accuracy.avg).toBeCloseTo(0.82);
      expect(result.data[0].scores.accuracy.count).toBe(5);
    }
  });

  it("defaults missing scores to an empty object", async () => {
    const rows = [{
      eval_variant: "v2", session_count: 1, total_input_tokens: 0, total_output_tokens: 0,
      total_cost_usd: 0, avg_duration_ms: null,
    }];
    const supabase = createMockSupabase({}, { get_eval_comparison: { data: rows } });
    const result = await getEvalComparison(supabase, USER_ID, "deep-research");
    if (result.success) expect(result.data[0].scores).toEqual({});
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/evals.service.test.ts` → FAIL.

- [ ] **Step 5: Implement the service methods**

Append to `apps/app/src/lib/services/evals.service.ts` (import the new types and `SupabaseClient` already present):

```ts
export async function getEvalList(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string
): Promise<ServiceResult<EvalListEntry[]>> {
  const { data, error } = await supabase.rpc("get_eval_list", {
    p_user_id: userId,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get eval list", details: error.message },
    };
  }

  return { success: true, data: (data as EvalListEntry[]) ?? [] };
}

export async function getEvalComparison(
  supabase: SupabaseClient,
  userId: string,
  evalId: string
): Promise<ServiceResult<EvalVariantStat[]>> {
  const { data, error } = await supabase.rpc("get_eval_comparison", {
    p_user_id: userId,
    p_eval_id: evalId,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get eval comparison", details: error.message },
    };
  }

  const variants: EvalVariantStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    eval_variant: row.eval_variant as string,
    session_count: (row.session_count as number) ?? 0,
    total_input_tokens: (row.total_input_tokens as number) ?? 0,
    total_output_tokens: (row.total_output_tokens as number) ?? 0,
    total_cost_usd: (row.total_cost_usd as number) ?? 0,
    avg_duration_ms: (row.avg_duration_ms as number | null) ?? null,
    scores: (row.scores as Record<string, EvalScoreSummary>) ?? {},
  }));

  return { success: true, data: variants };
}
```

- [ ] **Step 6: Run tests + manual SQL smoke**

Run: `cd apps/app && bun test src/lib/__tests__/evals.service.test.ts` → PASS.
Manual (pending if no DB): `select public.get_eval_comparison('<user-uuid>', 'deep-research');`

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/027_eval_rpcs.sql apps/app/src/types/analytics.ts apps/app/src/lib/services/evals.service.ts apps/app/src/lib/__tests__/evals.service.test.ts
git commit -m "feat(evals): add eval list and variant comparison RPCs"
```

---

## Task 5: Comparison helper (pure)

**Files:** Create `apps/app/src/lib/analytics/eval-comparison.ts` (+ `__tests__/eval-comparison.test.ts`)

**Interfaces:** Produces `LOW_SAMPLE_THRESHOLD`, `isLowSample(n)`, `metricNames(variants)`, `deltaVsBaseline(variants, metric)`.

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/lib/analytics/__tests__/eval-comparison.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { isLowSample, metricNames, deltaVsBaseline } from "../eval-comparison";
import type { EvalVariantStat } from "@/types/analytics";

function variant(p: Partial<EvalVariantStat> & { eval_variant: string }): EvalVariantStat {
  return {
    eval_variant: p.eval_variant,
    session_count: p.session_count ?? 5,
    total_input_tokens: p.total_input_tokens ?? 0,
    total_output_tokens: p.total_output_tokens ?? 0,
    total_cost_usd: p.total_cost_usd ?? 0,
    avg_duration_ms: p.avg_duration_ms ?? null,
    scores: p.scores ?? {},
  };
}

describe("isLowSample", () => {
  it("flags fewer than 3 sessions", () => {
    expect(isLowSample(1)).toBe(true);
    expect(isLowSample(2)).toBe(true);
    expect(isLowSample(3)).toBe(false);
  });
});

describe("metricNames", () => {
  it("returns the sorted union of metrics across variants", () => {
    const vs = [
      variant({ eval_variant: "v2", scores: { accuracy: { avg: 0.6, count: 3 } } }),
      variant({ eval_variant: "v3", scores: { accuracy: { avg: 0.8, count: 3 }, cost_score: { avg: 1, count: 3 } } }),
    ];
    expect(metricNames(vs)).toEqual(["accuracy", "cost_score"]);
  });

  it("returns an empty array when no variant has scores", () => {
    expect(metricNames([variant({ eval_variant: "v1" })])).toEqual([]);
  });
});

describe("deltaVsBaseline", () => {
  it("computes the second variant's delta against the first for a metric", () => {
    const vs = [
      variant({ eval_variant: "v2", scores: { accuracy: { avg: 0.60, count: 5 } } }),
      variant({ eval_variant: "v3", scores: { accuracy: { avg: 0.75, count: 5 } } }),
    ];
    expect(deltaVsBaseline(vs, "accuracy")).toBeCloseTo(0.15);
  });

  it("returns null unless there are exactly two variants", () => {
    const one = [variant({ eval_variant: "v2", scores: { accuracy: { avg: 0.6, count: 5 } } })];
    expect(deltaVsBaseline(one, "accuracy")).toBeNull();
  });

  it("returns null when either variant lacks the metric", () => {
    const vs = [
      variant({ eval_variant: "v2" }),
      variant({ eval_variant: "v3", scores: { accuracy: { avg: 0.75, count: 5 } } }),
    ];
    expect(deltaVsBaseline(vs, "accuracy")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/analytics/__tests__/eval-comparison.test.ts` → FAIL.

- [ ] **Step 3: Implement**

Create `apps/app/src/lib/analytics/eval-comparison.ts`:

```ts
import type { EvalVariantStat } from "@/types/analytics";

/** Below this many sessions, an average is annotated rather than presented as comparable. */
export const LOW_SAMPLE_THRESHOLD = 3;

export function isLowSample(sessionCount: number): boolean {
  return sessionCount < LOW_SAMPLE_THRESHOLD;
}

export function metricNames(variants: EvalVariantStat[]): string[] {
  const names = new Set<string>();
  for (const v of variants) {
    for (const name of Object.keys(v.scores ?? {})) names.add(name);
  }
  return [...names].sort();
}

/**
 * Delta of the second variant's metric against the first (the baseline).
 * Only defined for an exactly-two-variant comparison where both carry the metric.
 */
export function deltaVsBaseline(variants: EvalVariantStat[], metric: string): number | null {
  if (variants.length !== 2) return null;
  const [baseline, candidate] = variants;
  const b = baseline.scores?.[metric];
  const c = candidate.scores?.[metric];
  if (!b || !c) return null;
  return c.avg - b.avg;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test src/lib/analytics/__tests__/eval-comparison.test.ts` → PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/analytics/eval-comparison.ts apps/app/src/lib/analytics/__tests__/eval-comparison.test.ts
git commit -m "feat(evals): add pure eval-comparison helpers"
```

---

## Task 6: Evals list + comparison pages

**Files:** Create `apps/app/src/app/(dashboard)/evals/page.tsx`, `evals/loading.tsx`, `evals/[id]/page.tsx`

**Interfaces:** Consumes `getEvalList`/`getEvalComparison` (Task 4), `isLowSample`/`metricNames`/`deltaVsBaseline` (Task 5), `formatUsd`/`formatTokens` (`@/lib/format/agents`).

> No component harness — verify by `bunx tsc --noEmit` + manual run.

- [ ] **Step 1: Build the list page**

Create `apps/app/src/app/(dashboard)/evals/page.tsx`, following the structure of `apps/app/src/app/(dashboard)/agents/page.tsx` (read it first: `createClient`, `parseDateRange`, redirect when no user, shadcn `Card`/`Table`):

- Heading "Evals" with a one-line description.
- Table: Eval ID (link to `/evals/<id>`), Variants, Sessions, Last Run.
- Empty state (no rows): explain tagging — set `TRENCHCOAT_EVAL_ID` and `TRENCHCOAT_EVAL_VARIANT` in the environment when running your eval, and scores can be posted to `POST /api/v1/evals/scores`.

Create `evals/loading.tsx` mirroring `agents/loading.tsx`.

- [ ] **Step 2: Build the comparison page**

Create `apps/app/src/app/(dashboard)/evals/[id]/page.tsx`:

- `const { id } = await params;` then `decodeURIComponent(id)`.
- Call `getEvalComparison`; on empty → empty state.
- Render one column (or row) per variant with: Sessions, Total Cost (`formatUsd`), Tokens in/out (`formatTokens`), Avg Duration, then one row per metric from `metricNames(variants)` showing `avg` and its `count`.
- Annotate any variant where `isLowSample(session_count)` — e.g. a "low sample" badge next to its session count.
- When `deltaVsBaseline(variants, metric)` is non-null, show the delta beside that metric (positive/negative styling), labeled as "vs <baseline variant name>".
- Do NOT declare a winner anywhere in the copy.

- [ ] **Step 3: Typecheck**

Run: `cd apps/app && bunx tsc --noEmit` — no NEW errors above the pre-existing `bun:test` baseline. Confirm no error references the new eval files.

- [ ] **Step 4: Verify (manual, pending)**

Note in the report that visual verification requires running the app and is pending-manual.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(dashboard\)/evals/
git commit -m "feat(evals): add evals list and variant comparison pages"
```

---

## Task 7: Document eval tagging and the scores endpoint

**Files:** Modify `apps/docs/content/docs/plugin-sdk/event-schema.mdx`; create/modify the API reference page for the scores endpoint under `apps/docs/content/docs/api-reference/`

- [ ] **Step 1: Document the capture side**

In `event-schema.mdx`, in the `session_start` field list, document the optional `eval_id` and `eval_variant` fields: sourced from the `TRENCHCOAT_EVAL_ID` / `TRENCHCOAT_EVAL_VARIANT` environment variables, values capped at 128 characters, absent when unset. Verify against `claude-plugin/hooks/session_start.py` before writing — document only what the code emits.

- [ ] **Step 2: Document the scores endpoint**

Add an API-reference section for `POST /api/v1/evals/scores` matching the existing docs' conventions (read a sibling page under `apps/docs/content/docs/api-reference/` first):
- Auth: `X-API-Key` with the `write:events` scope.
- Body: `{ "scores": [ { "session_id", "metric", "value" } ] }`, 1–1000 items.
- Behavior: upsert on `(user_id, session_id, metric)` — re-posting a metric replaces its value. Scores for unknown session ids are accepted and stored; they surface once that session exists.
- Response: `201` with `{ inserted: <n> }`.

- [ ] **Step 3: Verify + commit**

Re-read each documented field/behavior against `session_start.py`, `evals.service.ts`, and `evals/scores/route.ts` to confirm accuracy.

```bash
git add apps/docs/content/docs/
git commit -m "docs: document eval tagging env vars and the scores endpoint"
```

---

## Self-Review

**Spec coverage:**
- §3.1 env-var capture → Task 1 ✓
- §3.2 sessions columns + promotion → Task 2 ✓
- §3.3 eval_scores table, RLS, upsert endpoint, unknown-session tolerance → Tasks 2, 3 ✓
- §3.4 `get_eval_comparison` + `get_eval_list` → Task 4 ✓
- §3.5 list page, comparison view, sample counts, low-sample annotation, empty state, no winner claim → Tasks 5, 6 ✓
- §4 testing at every layer → Tasks 1–5 (plugin, ingest, API/service, pure helper) ✓
- Docs → Task 7 ✓
- Out-of-scope honored: no versioned agent identity anywhere in this plan ✓

**Placeholder scan:** one deliberate instruction-not-code spot — Task 2 Step 2 directs the implementer to mirror `events.service.test.ts`'s existing mocking style rather than inventing one, because that file's harness differs from `createMockSupabase`. Every other step carries real code.

**Type consistency:** `EvalScoreInput` defined Task 3, used by Task 3's route; `EvalListEntry`/`EvalVariantStat`/`EvalScoreSummary` defined Task 4, consumed by Tasks 5 and 6; `isLowSample`/`metricNames`/`deltaVsBaseline` defined Task 5, consumed Task 6; service function names consistent between definition and call sites.

**Carried limitations (documented, not gaps):** parallel-spawn attribution ambiguity (Spec B) affects only per-agent breakdowns, not eval-level aggregates; migrations 022–027 remain unverified against a real Postgres.
