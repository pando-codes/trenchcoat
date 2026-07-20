# Cache-Aware Agent Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent cost non-zero and correct by capturing the `usage` token breakdown and pricing cache tokens, which dominate real usage.

**Architecture:** Plugin flattens `usage` into four numeric fields → promotion writes them to **result-owned** columns → `get_agent_tree` coalesces (stop tokens preferred, result tokens as fallback) and prices cache-aware using rates synced from LiteLLM.

**Tech Stack:** Python plugin + pytest; Supabase/Postgres plpgsql; Next.js; `bun test`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-20-cache-aware-agent-cost-design.md`.
- **`usage` is NOT a passthrough.** Extract exactly four numeric fields, flattened onto `agent_result`. Never add `"usage"` to `AGENT_RESULT_FIELDS` — the nested object contains `iterations`, `service_tier`, `inference_geo`, `speed`, and adding it wholesale would breach the strict-allowlist discipline D1's privacy review established.
- **Single-writer ownership is preserved.** `subagent_stop` keeps sole ownership of `input_tokens`/`output_tokens`; the Agent `tool_result` branch writes ONLY the new `result_*` columns. No branch writes another's columns. The read side chooses.
- **`nullif(x, 0)` is load-bearing** in the coalesce: a stop-derived `0` must count as *absent*, or the fallback never engages — that is exactly today's bug.
- **Per-term coalesce everywhere in cost math** (the migration-023 null-zeroing bug must not regress).
- **Cache-rate fallback:** when `model_pricing` has no cache rate, use `input_cost_per_1m × 1.25` (creation) and `× 0.10` (read) — Anthropic's documented ratios. Comment it as an approximation.
- `get_agent_tree` returns `TABLE(...)` → changing its columns REQUIRES `drop function if exists` first.
- Migrations append-only from `030`.
- **Tests:** plugin → `cd claude-plugin && uv run --with pytest pytest tests/ -q` (baseline 144); app → `cd apps/app && bun test` (baseline 430).
- **Commit** after each task with the shown message.

---

## Task 1: Capture the `usage` breakdown

**Files:** Modify `claude-plugin/lib/telemetry.py`, `claude-plugin/.claude-plugin/plugin.json`; Test `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing tests**

Add to the existing `class TestSanitizeAgentResult`:

```python
    USAGE = {
        "status": "completed", "agentId": "ag-u", "totalTokens": 23964,
        "prompt": "SECRET PROMPT", "content": "SECRET CONTENT",
        "usage": {
            "input_tokens": 10, "output_tokens": 68,
            "cache_creation_input_tokens": 23886, "cache_read_input_tokens": 0,
            "service_tier": "standard", "inference_geo": "not_available", "speed": "standard",
            "server_tool_use": {"web_search_requests": 0},
            "iterations": [{"input_tokens": 10, "output_tokens": 68}],
        },
    }

    def test_flattens_usage_into_four_numeric_fields(self):
        got = telemetry.sanitize_agent_result(self.USAGE)
        assert got["usage_input_tokens"] == 10
        assert got["usage_output_tokens"] == 68
        assert got["usage_cache_creation_tokens"] == 23886
        assert got["usage_cache_read_tokens"] == 0

    def test_usage_blob_is_never_stored_wholesale(self):
        got = telemetry.sanitize_agent_result(self.USAGE)
        assert "usage" not in got, "the nested usage object must not be passed through"
        blob = json.dumps(got)
        for banned in ("iterations", "service_tier", "inference_geo", "speed", "server_tool_use", "SECRET"):
            assert banned not in blob, f"{banned} leaked: {blob}"

    def test_absent_usage_yields_no_usage_keys(self):
        got = telemetry.sanitize_agent_result({"status": "completed", "agentId": "ag-x"})
        assert not any(k.startswith("usage_") for k in got)

    def test_non_numeric_usage_values_are_skipped(self):
        got = telemetry.sanitize_agent_result({"agentId": "a", "usage": {"input_tokens": "lots"}})
        assert "usage_input_tokens" not in got
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k usage -q`
Expected: FAIL — no `usage_*` keys.

- [ ] **Step 3: Implement**

In `claude-plugin/lib/telemetry.py`, beside `AGENT_RESULT_FIELDS` (do NOT add `"usage"` to it):

```python
# Only these four numeric fields are lifted out of the nested `usage` object.
# The rest of it (iterations, service_tier, inference_geo, speed, server_tool_use)
# is deliberately dropped — a wholesale copy would breach the allowlist.
_USAGE_FIELD_MAP = {
    "input_tokens": "usage_input_tokens",
    "output_tokens": "usage_output_tokens",
    "cache_creation_input_tokens": "usage_cache_creation_tokens",
    "cache_read_input_tokens": "usage_cache_read_tokens",
}
```

and extend `sanitize_agent_result` (keep its existing allowlist comprehension intact, append this before the return):

```python
    usage = tool_response.get("usage")
    if isinstance(usage, dict):
        for src, dst in _USAGE_FIELD_MAP.items():
            value = usage.get(src)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                out[dst] = value
```

(Adjust `out` to whatever the existing local variable is named.)

- [ ] **Step 4: Bump the version**

`claude-plugin/.claude-plugin/plugin.json`: `"1.3.1"` → `"1.3.2"`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass (was 144).

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/.claude-plugin/plugin.json claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): capture usage token breakdown; bump to 1.3.2"
```

---

## Task 2: Schema — cache rates and result-owned token columns

**Files:** Create `supabase/migrations/030_cache_aware_cost.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 030: Cache-aware cost. Adds cache rates to pricing and result-sourced token
-- columns to agents. The result_* columns are written ONLY by the Agent
-- tool_result branch, preserving single-writer ownership; the read side
-- decides whether to use them.

alter table public.model_pricing
  add column if not exists cache_creation_cost_per_1m numeric(10, 6),
  add column if not exists cache_read_cost_per_1m     numeric(10, 6);

comment on column public.model_pricing.cache_creation_cost_per_1m is
  'Null means unknown, not free — readers fall back to input_cost_per_1m * 1.25.';
comment on column public.model_pricing.cache_read_cost_per_1m is
  'Null means unknown, not free — readers fall back to input_cost_per_1m * 0.10.';

alter table public.agents
  add column if not exists result_input_tokens          bigint,
  add column if not exists result_output_tokens         bigint,
  add column if not exists result_cache_creation_tokens bigint,
  add column if not exists result_cache_read_tokens     bigint;
```

- [ ] **Step 2: Verify by reading**

No local Postgres — do NOT run psql. Confirm: both tables altered additively with `if not exists`; all new columns nullable (nullable is required — null must remain distinguishable from zero); no data mutation.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/030_cache_aware_cost.sql
git commit -m "feat(cost): add cache pricing columns and result-sourced agent tokens"
```

---

## Task 3: Populate cache rates from LiteLLM

**Files:** Modify `apps/app/src/app/api/v1/admin/sync-pricing/route.ts`; Test `apps/app/src/lib/__tests__/sync-pricing.test.ts`

> LiteLLM publishes `cache_creation_input_token_cost` and `cache_read_input_token_cost` (verified live: 1.25e-06 and 1e-07 for Haiku 4.5). The sync currently reads only input/output.

- [ ] **Step 1: Write the failing test**

Read `apps/app/src/lib/__tests__/sync-pricing.test.ts` first and follow its style. Add tests proving:
1. A model whose LiteLLM entry has both cache costs yields `cache_creation_cost_per_1m` and `cache_read_cost_per_1m` in the upserted row, converted ×1e6.
2. A model with NO cache costs yields those fields as `null` (not `0`) — null means unknown, zero would mean free.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/sync-pricing.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In `apps/app/src/app/api/v1/admin/sync-pricing/route.ts`, widen the pricing record type:

```ts
  let pricing: Record<string, {
    input_cost_per_token?: number;
    output_cost_per_token?: number;
    cache_creation_input_token_cost?: number;
    cache_read_input_token_cost?: number;
  }>;
```

and add to the mapped row (keep the existing `.filter()` on input/output unchanged — cache rates are optional enrichment, not a requirement for inclusion):

```ts
      cache_creation_cost_per_1m:
        v.cache_creation_input_token_cost != null
          ? Number((v.cache_creation_input_token_cost * 1_000_000).toFixed(6))
          : null,
      cache_read_cost_per_1m:
        v.cache_read_input_token_cost != null
          ? Number((v.cache_read_input_token_cost * 1_000_000).toFixed(6))
          : null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test` → all pass (baseline 430).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/api/v1/admin/sync-pricing/route.ts apps/app/src/lib/__tests__/sync-pricing.test.ts
git commit -m "feat(cost): sync cache pricing rates from LiteLLM"
```

---

## Task 4: Promote the result-sourced tokens

**Files:** Modify `apps/app/src/lib/services/events.service.ts`; Test `apps/app/src/lib/__tests__/events.service.test.ts`

- [ ] **Step 1: Write the failing tests**

Using the file's existing `createSpySupabase` pattern, add tests proving:
1. An Agent `tool_result` whose `agent_result` carries `usage_*` fields produces `result_input_tokens` / `result_output_tokens` / `result_cache_creation_tokens` / `result_cache_read_tokens` in the upsert payload.
2. That same payload does **not** contain `input_tokens` or `output_tokens` (those belong to `subagent_stop` — writing them here would reintroduce the dual-writer hazard).
3. A `subagent_stop` payload contains `input_tokens`/`output_tokens` and **no** `result_*` keys.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/events.service.test.ts` → FAIL.

- [ ] **Step 3: Implement**

In the Agent `tool_result` branch of the agent-promotion loop, alongside the existing `status`/`model` assignments:

```ts
        if (result.usage_input_tokens != null) row.result_input_tokens = result.usage_input_tokens;
        if (result.usage_output_tokens != null) row.result_output_tokens = result.usage_output_tokens;
        if (result.usage_cache_creation_tokens != null)
          row.result_cache_creation_tokens = result.usage_cache_creation_tokens;
        if (result.usage_cache_read_tokens != null)
          row.result_cache_read_tokens = result.usage_cache_read_tokens;
```

Do NOT touch `input_tokens`/`output_tokens` in this branch.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/services/events.service.ts apps/app/src/lib/__tests__/events.service.test.ts
git commit -m "feat(agents): promote result-sourced usage tokens"
```

---

## Task 5: Cache-aware cost in `get_agent_tree`

**Files:** Create `supabase/migrations/031_agent_tree_cache_cost.sql`

- [ ] **Step 1: Write the migration**

Return columns change, so the drop is REQUIRED. Base this on `029_agent_tree.sql` — preserve its `scoped`/`tree` CTEs, orphan-root anchor, and depth cap exactly; only the selected token/cost expressions change, plus the four new columns threaded through the CTEs.

```sql
-- 031: Cache-aware agent cost.
-- Prefers subagent_stop tokens; falls back to the Agent tool_response usage
-- breakdown when they are absent OR zero (nullif) — a stop-derived 0 means
-- "transcript parse failed", not "genuinely zero", which was the $0-cost bug.
-- Cache tokens dominate real usage and are priced with synced rates, falling
-- back to Anthropic's documented ratios (1.25x / 0.10x of input) when unknown.

drop function if exists public.get_agent_tree(uuid, text);
create or replace function public.get_agent_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  agent_id           text,
  parent_agent_id    text,
  agent_type         text,
  edge_label         text,
  depth              int,
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_ms        bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  cache_creation_tokens bigint,
  cache_read_tokens     bigint,
  estimated_cost_usd numeric
) language sql stable as $$
  with recursive scoped as (
    select a.agent_id, a.parent_agent_id, a.agent_type, a.edge_label,
           a.started_at, a.ended_at, a.duration_ms,
           a.input_tokens, a.output_tokens, a.model,
           a.result_input_tokens, a.result_output_tokens,
           a.result_cache_creation_tokens, a.result_cache_read_tokens
    from public.agents a
    where a.user_id = p_user_id
      and a.session_id = p_session_id
  ),
  tree as (
    select s.*, 0 as depth
    from scoped s
    where s.parent_agent_id is null
       or not exists (select 1 from scoped p where p.agent_id = s.parent_agent_id)

    union all

    select c.*, t.depth + 1
    from scoped c
    join tree t on c.parent_agent_id = t.agent_id
    where t.depth < 50
  ),
  eff as (
    select
      t.*,
      coalesce(nullif(t.input_tokens,  0), t.result_input_tokens,  0) as e_input,
      coalesce(nullif(t.output_tokens, 0), t.result_output_tokens, 0) as e_output,
      coalesce(t.result_cache_creation_tokens, 0) as e_cache_creation,
      coalesce(t.result_cache_read_tokens,     0) as e_cache_read
    from tree t
  )
  select
    e.agent_id,
    e.parent_agent_id,
    e.agent_type,
    e.edge_label,
    e.depth,
    e.started_at,
    e.ended_at,
    coalesce(e.duration_ms, 0)::bigint as duration_ms,
    e.e_input::bigint                  as input_tokens,
    e.e_output::bigint                 as output_tokens,
    e.e_cache_creation::bigint         as cache_creation_tokens,
    e.e_cache_read::bigint             as cache_read_tokens,
    round((
      e.e_input  * coalesce(mp.input_cost_per_1m,  0) / 1000000.0 +
      e.e_output * coalesce(mp.output_cost_per_1m, 0) / 1000000.0 +
      -- Cache rates: synced when available, else Anthropic's documented
      -- ratios (creation 1.25x input, read 0.10x input). Approximation.
      e.e_cache_creation *
        coalesce(mp.cache_creation_cost_per_1m, mp.input_cost_per_1m * 1.25, 0) / 1000000.0 +
      e.e_cache_read *
        coalesce(mp.cache_read_cost_per_1m,     mp.input_cost_per_1m * 0.10, 0) / 1000000.0
    )::numeric, 6) as estimated_cost_usd
  from eff e
  left join public.model_pricing mp on mp.model_id = e.model
  order by e.depth, e.started_at nulls last;
$$;
```

- [ ] **Step 2: Extend the type**

In `apps/app/src/types/analytics.ts`, add to `AgentTreeNode`:

```ts
  cache_creation_tokens: number;
  cache_read_tokens: number;
```

- [ ] **Step 3: Typecheck + suite**

Run: `cd apps/app && bunx tsc --noEmit` (no new errors) and `bun test` (baseline 430) — `buildAgentGraph` reads `estimated_cost_usd`/`duration_ms` and is unaffected by the added fields; confirm that holds.

- [ ] **Step 4: Verify by reading**

Confirm against `029_agent_tree.sql`: the orphan-root anchor, the `depth < 50` cap, and the `scoped` filtering are unchanged; only tokens/cost changed and four columns were threaded through.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/031_agent_tree_cache_cost.sql apps/app/src/types/analytics.ts
git commit -m "feat(cost): price agent cost cache-aware with usage fallback"
```

---

## Task 6: Deploy and verify live

**Files:** none (operational)

- [ ] **Step 1: Push migrations**

```bash
cd <repo> && export SUPABASE_DB_PASSWORD=$(grep -m1 '^SUPABASE_DB_PASSWORD=' .env.local | cut -d= -f2- | sed 's/^["'"'"']//; s/["'"'"']$//')
supabase db push --linked --dry-run     # expect exactly 030 and 031
supabase db push --linked
```

- [ ] **Step 2: Backfill cache rates**

The nightly LiteLLM cron populates them, but trigger a sync (or upsert the rates for the models in use) so verification isn't blocked on the cron. Confirm:
`select model_id, input_cost_per_1m, cache_creation_cost_per_1m, cache_read_cost_per_1m from public.model_pricing where model_id like 'claude-haiku-4-5%';`

- [ ] **Step 3: Update the plugin**

```bash
claude plugin marketplace update pando-plugins
claude plugin update trenchcoat@pando-plugins   # expect 1.3.1 -> 1.3.2
```
Restart Claude Code (required for new hooks to load).

- [ ] **Step 4: Spawn a test agent and flush**

Spawn one agent, then flush the queue (the SessionEnd path):
```bash
python3 -c "import sys;sys.path.insert(0,'<install>/lib');import telemetry;telemetry.flush_push_queue()"
```

- [ ] **Step 5: Verify cost is non-zero and correctly cache-dominated**

```sql
select agent_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, estimated_cost_usd
from public.get_agent_tree('<user>', '<session>');
```
Expected per spec §6: roughly **$0.03** for a trivial agent, dominated by cache creation — not `$0.000000`.

---

## Self-Review

**Spec coverage:** §3.1 usage capture → Task 1 ✓; §3.2 pricing columns + sync → Tasks 2, 3 ✓; §3.3 result-owned storage → Tasks 2, 4 ✓; §3.4 coalesced cache-aware cost → Task 5 ✓; §6 expected result verified → Task 6 ✓.

**Placeholder scan:** Tasks 3 and 4 describe their tests by reference to the existing file patterns (which the implementer must read anyway) rather than restating them; all other steps carry literal code.

**Type consistency:** `usage_*` keys emitted in Task 1 are consumed verbatim in Task 4; `result_*` columns created in Task 2 are written in Task 4 and read in Task 5; `AgentTreeNode`'s two new fields (Task 5) match the RPC's added columns.

**Ownership invariant:** `subagent_stop` → `input_tokens`/`output_tokens`; Agent `tool_result` → `result_*`. Tasks 4 and 5 both depend on this holding; the tests in Task 4 assert it directly.
