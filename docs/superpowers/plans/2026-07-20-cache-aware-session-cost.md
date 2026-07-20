# Cache-Aware Session Cost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make session-level cost cache-aware end to end, and surface the `agents` table on session detail, so every cost number on the session surfaces comes from one SQL pricing function.

**Architecture:** The plugin starts capturing cache tokens that already exist in the transcript but were discarded. Those land in two new nullable `sessions` columns. A new SQL function `price_tokens` becomes the single place the cache-rate fallback lives; `get_agent_tree` is repointed at it and a new `get_session_cost` calls it too. The frontend deletes its own cost math and reads both RPCs.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase/Postgres, TypeScript, `bun test` for the app, `pytest` for the Python plugin, Recharts, ReactFlow.

**Spec:** `docs/superpowers/specs/2026-07-20-cache-aware-session-cost-design.md`

## Global Constraints

- Package manager is **bun**. Use `bun install`, `bun add`. Never npm.
- App tests: `cd apps/app && bun test <path>`. Plugin tests: `cd claude-plugin && python -m pytest tests/ -v`.
- Plugin version goes **1.3.2 → 1.3.3** in `claude-plugin/.claude-plugin/plugin.json`.
- New `sessions` columns are **nullable `bigint`, never defaulted to 0**. `null` = "plugin older than 1.3.3"; `0` = "captured, no cache". The UI renders these differently.
- Cost of an unpriced model is **null**, rendered `--`. Never `$0.00`.
- Migrations are sequential files in `supabase/migrations/`. The next free numbers are **032, 033, 034**.
- Cache-rate fallback ratios are **cache-creation = 1.25 × input rate, cache-read = 0.10 × input rate**, applied only when the synced rate is null. After Task 3 these numbers must appear in exactly one place in the repo.
- Commit after every task. Branch is `spec/cache-aware-session-cost` (already created, spec already committed on it).

---

### Task 0: Validate the migration stack

Specs A, B, C, D1, D2 and E all record that migrations 022–031 have **never run against a real Postgres**. Everything downstream builds on `get_agent_tree`. Verify it compiles before writing more SQL.

**Files:**
- Create: `docs/superpowers/plans/2026-07-20-migration-validation-notes.md`
- Modify: any of `supabase/migrations/022_*.sql` … `031_*.sql` that fail to apply

**Interfaces:**
- Consumes: nothing
- Produces: a working local Postgres with migrations 001–031 applied; `public.get_agent_tree(uuid, text)` callable

- [ ] **Step 1: Start a local Supabase**

```bash
cd /Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app
supabase start
```

Expected: a running stack and a printed `DB URL` like `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Export it:

```bash
export TC_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

- [ ] **Step 2: Apply every migration in order and capture failures**

```bash
supabase db reset
```

Expected: applies `001` … `031` in order. If it stops, the error names the failing file and line. **Do not skip past a failure.**

- [ ] **Step 3: Verify the four RPCs this plan depends on exist**

```bash
psql "$TC_DB" -c "\df public.get_agent_tree"
psql "$TC_DB" -c "\df public.get_session_cost"
psql "$TC_DB" -c "\d public.agents"
psql "$TC_DB" -c "\d public.model_pricing"
```

Expected: `get_agent_tree` exists with 13 output columns; `get_session_cost` does **not** exist yet (Task 4 creates it); `agents` has `result_input_tokens`, `result_output_tokens`, `result_cache_creation_tokens`, `result_cache_read_tokens`; `model_pricing` has `cache_creation_cost_per_1m`, `cache_read_cost_per_1m`.

- [ ] **Step 4: Smoke-call get_agent_tree**

```bash
psql "$TC_DB" -c "select * from public.get_agent_tree('00000000-0000-0000-0000-000000000000'::uuid, 'nope');"
```

Expected: zero rows, no error. An error here means the recursive CTE does not compile and must be fixed before continuing.

- [ ] **Step 5: Record findings**

Write `docs/superpowers/plans/2026-07-20-migration-validation-notes.md` containing: which migrations failed and what was changed, plus these two known-suspect checks (spec §3.0) — **record the answer, do not fix them in this plan**:

- `get_session_tree`'s `edge_label` lateral (`025_tree_edge_label.sql:53-66`) joins on `session_start.data->>'agent_id'`, a field D1 removed. Confirm the join is dead.
- `get_top_agents`' latency join (`024_agent_latency.sql:74-84`) requires `tool_result` rows carrying `agent_id`. Confirm whether D1's changes preserved that.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/plans/2026-07-20-migration-validation-notes.md supabase/migrations/
git commit -m "chore(db): validate migrations 022-031 against real postgres"
```

---

### Task 1: Plugin captures cache tokens

**Files:**
- Modify: `claude-plugin/lib/telemetry.py:569-617` (`parse_agent_transcript`)
- Modify: `claude-plugin/hooks/stop.py:25-30`
- Modify: `claude-plugin/.claude-plugin/plugin.json` (version → `1.3.3`)
- Test: `claude-plugin/tests/test_telemetry.py` (class `TestParseAgentTranscript`, around line 774)

**Interfaces:**
- Consumes: nothing
- Produces: `parse_agent_transcript()` returns two additional keys, `cache_creation_tokens: int` and `cache_read_tokens: int`. The `assistant_stop` event payload gains `cache_creation_tokens` and `cache_read_tokens`, both ints.

- [ ] **Step 1: Write the failing tests**

Add to `claude-plugin/tests/test_telemetry.py` inside `class TestParseAgentTranscript`:

```python
    def test_sums_cache_tokens(self, tmp_path):
        entries = [
            {"type": "assistant", "message": {
                "model": "claude-sonnet",
                "usage": {
                    "input_tokens": 10, "output_tokens": 5,
                    "cache_creation_input_tokens": 23886,
                    "cache_read_input_tokens": 0,
                },
                "content": [],
            }},
            {"type": "assistant", "message": {
                "model": "claude-sonnet",
                "usage": {
                    "input_tokens": 10, "output_tokens": 5,
                    "cache_creation_input_tokens": 8769,
                    "cache_read_input_tokens": 15121,
                },
                "content": [],
            }},
        ]
        path = self._write_transcript(tmp_path, entries)
        result = telemetry.parse_agent_transcript(path)
        assert result["cache_creation_tokens"] == 32655
        assert result["cache_read_tokens"] == 15121

    def test_cache_tokens_default_to_zero_when_absent(self, tmp_path):
        entries = [
            {"type": "assistant", "message": {
                "model": "m",
                "usage": {"input_tokens": 10, "output_tokens": 5},
                "content": [],
            }},
        ]
        path = self._write_transcript(tmp_path, entries)
        result = telemetry.parse_agent_transcript(path)
        assert result["cache_creation_tokens"] == 0
        assert result["cache_read_tokens"] == 0

    def test_cache_tokens_tolerate_null_values(self, tmp_path):
        entries = [
            {"type": "assistant", "message": {
                "model": "m",
                "usage": {
                    "input_tokens": 10, "output_tokens": 5,
                    "cache_creation_input_tokens": None,
                    "cache_read_input_tokens": None,
                },
                "content": [],
            }},
        ]
        path = self._write_transcript(tmp_path, entries)
        result = telemetry.parse_agent_transcript(path)
        assert result["cache_creation_tokens"] == 0
        assert result["cache_read_tokens"] == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestParseAgentTranscript -v
```

Expected: the three new tests FAIL with `KeyError: 'cache_creation_tokens'`. The pre-existing tests in the class PASS.

- [ ] **Step 3: Add the counters to `parse_agent_transcript`**

In `claude-plugin/lib/telemetry.py`, beside the existing `input_tokens = 0` / `output_tokens = 0` initialisers (lines 577-578), add:

```python
    cache_creation_tokens = 0
    cache_read_tokens = 0
```

In the accumulation block beside lines 601-602, add:

```python
            cache_creation_tokens += int(usage.get("cache_creation_input_tokens") or 0)
            cache_read_tokens += int(usage.get("cache_read_input_tokens") or 0)
```

The `or 0` matters — it handles both a missing key and an explicit `null`, matching how `input_tokens` is already read.

In the return dict (lines 610-617), add:

```python
        "cache_creation_tokens": cache_creation_tokens,
        "cache_read_tokens": cache_read_tokens,
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestParseAgentTranscript -v
```

Expected: all tests PASS, including the pre-existing `test_sums_tokens` and `test_returns_empty_dict_for_missing_file`.

Note: `parse_agent_transcript` returns `{}` for a missing file, so callers must use `.get(key, 0)` — `stop.py` already does.

- [ ] **Step 5: Emit the fields from the stop hook**

In `claude-plugin/hooks/stop.py`, extend the `write_event` call (lines 25-30) to:

```python
    write_event("stop", session_id, {
        "reason": reason,
        "input_tokens": transcript.get("input_tokens", 0),
        "output_tokens": transcript.get("output_tokens", 0),
        "cache_creation_tokens": transcript.get("cache_creation_tokens", 0),
        "cache_read_tokens": transcript.get("cache_read_tokens", 0),
        "model": transcript.get("model"),
    })
```

- [ ] **Step 6: Bump the plugin version**

In `claude-plugin/.claude-plugin/plugin.json`, change `"version": "1.3.2"` to `"version": "1.3.3"`.

- [ ] **Step 7: Run the full plugin suite**

```bash
cd claude-plugin && python -m pytest tests/ -v
```

Expected: all PASS. No ingest or schema change is involved — `POST /api/v1/events` validates `data` as `z.record(z.string(), z.unknown())`, so new keys pass through untouched.

- [ ] **Step 8: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/hooks/stop.py \
        claude-plugin/tests/test_telemetry.py claude-plugin/.claude-plugin/plugin.json
git commit -m "feat(plugin): capture session cache tokens; bump to 1.3.3"
```

---

### Task 2: Store cache tokens on sessions

**Files:**
- Create: `supabase/migrations/032_session_cache_tokens.sql`
- Modify: `apps/app/src/lib/services/events.service.ts:124-146`
- Test: `apps/app/src/lib/__tests__/events.service.test.ts`

**Interfaces:**
- Consumes: `assistant_stop` payload keys `cache_creation_tokens`, `cache_read_tokens` (Task 1)
- Produces: `public.sessions.cache_creation_tokens bigint null`, `public.sessions.cache_read_tokens bigint null`, populated on ingest

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/032_session_cache_tokens.sql`:

```sql
-- 032: Session-level cache tokens.
-- Nullable, NOT defaulted to 0. null = "captured by a plugin older than 1.3.3";
-- 0 = "captured, genuinely no cache". The UI renders these differently ("--"
-- vs "$0.00"), and a default of 0 would erase the distinction for every
-- historic row permanently.

alter table public.sessions
  add column if not exists cache_creation_tokens bigint,
  add column if not exists cache_read_tokens     bigint;
```

- [ ] **Step 2: Apply and verify**

```bash
psql "$TC_DB" -f supabase/migrations/032_session_cache_tokens.sql
psql "$TC_DB" -c "\d public.sessions" | grep cache
```

Expected: two rows, both `bigint`, neither showing a default.

- [ ] **Step 3: Write the failing ingest test**

Add to `apps/app/src/lib/__tests__/events.service.test.ts`:

```typescript
// Returns the argument object of every `.update(...)` call the ingest made.
function updateArgs(calls: { method: string; args: unknown[] }[]) {
  return calls
    .filter((c) => c.method === "update")
    .map((c) => c.args[0] as Record<string, unknown>);
}

it("promotes cache tokens from assistant_stop onto the session", async () => {
  const { client, calls } = createSpySupabase({
    events: OK,
    sessions: [NOT_FOUND, OK, OK],
  });

  const events = [
    makeEvent({
      seq: 1,
      event: "assistant_stop",
      data: {
        input_tokens: 10,
        output_tokens: 5,
        cache_creation_tokens: 32655,
        cache_read_tokens: 15121,
        model: "claude-sonnet",
      },
    }),
  ];

  const result = await ingestEvents(client, USER_ID, events);
  expect(result.success).toBe(true);

  const update = updateArgs(calls).find((u) => u.cache_creation_tokens !== undefined);
  expect(update).toBeDefined();
  expect(update!.cache_creation_tokens).toBe(32655);
  expect(update!.cache_read_tokens).toBe(15121);
});

it("omits cache token columns when the payload lacks them", async () => {
  const { client, calls } = createSpySupabase({
    events: OK,
    sessions: [NOT_FOUND, OK, OK],
  });

  const events = [
    makeEvent({
      seq: 1,
      event: "assistant_stop",
      data: { input_tokens: 10, output_tokens: 5, model: "claude-sonnet" },
    }),
  ];

  await ingestEvents(client, USER_ID, events);

  for (const u of updateArgs(calls)) {
    expect(u).not.toHaveProperty("cache_creation_tokens");
    expect(u).not.toHaveProperty("cache_read_tokens");
  }
});
```

`createSpySupabase` is already imported at the top of this test file, and `OK` / `NOT_FOUND` / `makeEvent` are already defined in it — no new imports or fixtures needed.

The second test is the important one: it proves a pre-1.3.3 plugin leaves the columns `null` rather than writing `0`.

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd apps/app && bun test src/lib/__tests__/events.service.test.ts
```

Expected: the first new test FAILS (`update` is `undefined`); the second already passes, which is correct — it is a regression guard, not a driver.

Note `createSpySupabase`'s `rpc` always resolves `{ data: null, error: null }`, so the `update_daily_aggregate` call inside `ingestEvents` succeeds without configuration.

- [ ] **Step 5: Promote the columns on ingest**

In `apps/app/src/lib/services/events.service.ts`, inside the `assistant_stop` loop (lines 124-146), add beside the existing reads:

```typescript
      const cacheCreationTokens = (e.data?.cache_creation_tokens as number | null) ?? null;
      const cacheReadTokens = (e.data?.cache_read_tokens as number | null) ?? null;
```

and beside the existing guards:

```typescript
      if (cacheCreationTokens !== null) update.cache_creation_tokens = cacheCreationTokens;
      if (cacheReadTokens !== null) update.cache_read_tokens = cacheReadTokens;
```

The `!== null` guard is what keeps a pre-1.3.3 payload from overwriting a populated column, matching the existing treatment of `input_tokens`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
cd apps/app && bun test src/lib/__tests__/events.service.test.ts
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/032_session_cache_tokens.sql \
        apps/app/src/lib/services/events.service.ts \
        apps/app/src/lib/__tests__/events.service.test.ts
git commit -m "feat(cost): store session cache tokens from assistant_stop"
```

---

### Task 3: One pricing function; repoint get_agent_tree

**Files:**
- Create: `supabase/migrations/033_price_tokens.sql`

**Interfaces:**
- Consumes: `model_pricing.cache_creation_cost_per_1m` / `cache_read_cost_per_1m` (migration 030)
- Produces:
  - `public.price_tokens(p_model text, p_input bigint, p_output bigint, p_cache_creation bigint, p_cache_read bigint) returns numeric` — **null when `p_model` has no `model_pricing` row**
  - `public.get_agent_tree(uuid, text)` returning 16 columns: the previous 13 plus `status text`, `model text`, `tool_count integer`. `estimated_cost_usd` becomes nullable.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/033_price_tokens.sql`:

```sql
-- 033: Single pricing authority.
--
-- The cache-rate fallback (creation = 1.25x input, read = 0.10x input) was
-- inlined in 031. get_session_cost (034) needs the identical ladder, so it is
-- extracted here and 031's copy is removed by recreating get_agent_tree
-- against it. After this migration the 1.25/0.10 ratios exist in exactly one
-- place in the repo.
--
-- Behaviour change: a model with no model_pricing row now prices as NULL, not
-- 0. The `select ... from model_pricing where model_id = p_model` returns no
-- row for an unknown model, so the function returns null. 031 coalesced every
-- rate to 0, which rendered unpriced models as a confident $0.00 -- the exact
-- failure mode that made Spec E's $0.000000 read as a rendering bug.

create or replace function public.price_tokens(
  p_model          text,
  p_input          bigint,
  p_output         bigint,
  p_cache_creation bigint,
  p_cache_read     bigint
) returns numeric
language sql
stable
as $$
  select round((
    coalesce(p_input,  0) * coalesce(mp.input_cost_per_1m,  0) / 1000000.0 +
    coalesce(p_output, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0 +
    coalesce(p_cache_creation, 0) *
      coalesce(mp.cache_creation_cost_per_1m, mp.input_cost_per_1m * 1.25, 0) / 1000000.0 +
    coalesce(p_cache_read, 0) *
      coalesce(mp.cache_read_cost_per_1m,     mp.input_cost_per_1m * 0.10, 0) / 1000000.0
  )::numeric, 6)
  from public.model_pricing mp
  where mp.model_id = p_model;
$$;

drop function if exists public.get_agent_tree(uuid, text);
create or replace function public.get_agent_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  agent_id              text,
  parent_agent_id       text,
  agent_type            text,
  edge_label            text,
  depth                 int,
  started_at            timestamptz,
  ended_at              timestamptz,
  duration_ms           bigint,
  input_tokens          bigint,
  output_tokens         bigint,
  cache_creation_tokens bigint,
  cache_read_tokens     bigint,
  estimated_cost_usd    numeric,
  status                text,
  model                 text,
  tool_count            integer
) language sql stable as $$
  with recursive scoped as (
    select a.agent_id, a.parent_agent_id, a.agent_type, a.edge_label,
           a.started_at, a.ended_at, a.duration_ms,
           a.input_tokens, a.output_tokens, a.model,
           a.status, a.tool_count,
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
    public.price_tokens(e.model, e.e_input::bigint, e.e_output::bigint,
                        e.e_cache_creation::bigint, e.e_cache_read::bigint)
                                       as estimated_cost_usd,
    e.status,
    e.model,
    e.tool_count
  from eff e
  order by e.depth, e.started_at nulls last;
$$;
```

Note the `left join public.model_pricing` from 031 is gone — `price_tokens` does its own lookup.

- [ ] **Step 2: Apply the migration**

```bash
psql "$TC_DB" -f supabase/migrations/033_price_tokens.sql
```

Expected: `CREATE FUNCTION` twice, `DROP FUNCTION` once. No errors.

- [ ] **Step 3: Seed pricing fixtures and assert the three pricing cases**

```bash
psql "$TC_DB" <<'SQL'
insert into public.model_pricing (model_id, input_cost_per_1m, output_cost_per_1m,
                                  cache_creation_cost_per_1m, cache_read_cost_per_1m)
values ('test-synced', 3.0, 15.0, 3.75, 0.30)
on conflict (model_id) do update set
  input_cost_per_1m = excluded.input_cost_per_1m,
  output_cost_per_1m = excluded.output_cost_per_1m,
  cache_creation_cost_per_1m = excluded.cache_creation_cost_per_1m,
  cache_read_cost_per_1m = excluded.cache_read_cost_per_1m;

insert into public.model_pricing (model_id, input_cost_per_1m, output_cost_per_1m)
values ('test-nocache', 3.0, 15.0)
on conflict (model_id) do update set
  input_cost_per_1m = excluded.input_cost_per_1m,
  output_cost_per_1m = excluded.output_cost_per_1m,
  cache_creation_cost_per_1m = null,
  cache_read_cost_per_1m = null;

-- Case 1: synced cache rates are used.
-- 1M input @3 + 1M output @15 + 1M creation @3.75 + 1M read @0.30 = 22.05
select 'synced' as case,
       public.price_tokens('test-synced', 1000000, 1000000, 1000000, 1000000) as got,
       22.05 as want;

-- Case 2: null cache rates fall back to 1.25x / 0.10x of input (3.75 / 0.30).
-- Same total by construction: 22.05
select 'fallback' as case,
       public.price_tokens('test-nocache', 1000000, 1000000, 1000000, 1000000) as got,
       22.05 as want;

-- Case 3: unknown model returns NULL, not 0.
select 'unknown' as case,
       public.price_tokens('no-such-model', 1000000, 1000000, 1000000, 1000000) as got,
       null as want;

-- Case 4: null model returns NULL.
select 'null-model' as case,
       public.price_tokens(null, 1000, 1000, 1000, 1000) as got,
       null as want;
SQL
```

Expected: `got = 22.05` for cases 1 and 2, `got` empty (NULL) for cases 3 and 4. Cases 1 and 2 producing the same number is deliberate — the fixture's synced rates are exactly the fallback ratios, so any divergence means the fallback ladder is wrong.

- [ ] **Step 4: Assert the repoint is behaviour-preserving**

Insert one priced agent and confirm `get_agent_tree` returns the same cost the 031 arithmetic would have:

```bash
psql "$TC_DB" <<'SQL'
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'plan-test@example.com')
on conflict (id) do nothing;

insert into public.agents
  (user_id, agent_id, session_id, agent_type, model, status, tool_count,
   duration_ms, input_tokens, output_tokens,
   result_cache_creation_tokens, result_cache_read_tokens)
values
  ('11111111-1111-1111-1111-111111111111', 'agent-1', 'sess-1', 'Explore',
   'test-synced', 'completed', 7, 4200, 1000000, 1000000, 1000000, 1000000)
on conflict (user_id, agent_id) do update set
  model = excluded.model, status = excluded.status, tool_count = excluded.tool_count;

select agent_id, estimated_cost_usd, status, model, tool_count, cache_creation_tokens
from public.get_agent_tree('11111111-1111-1111-1111-111111111111'::uuid, 'sess-1');
SQL
```

Expected: one row — `estimated_cost_usd = 22.050000`, `status = completed`, `model = test-synced`, `tool_count = 7`, `cache_creation_tokens = 1000000`. The cost matches Case 1, proving the extraction preserved 031's arithmetic.

- [ ] **Step 5: Confirm the ratios now live in exactly one place**

```bash
cd /Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app
grep -rn "1\.25\|0\.10" supabase/migrations/ | grep -i cache
```

Expected: hits only in `033_price_tokens.sql`. Migration `031` still contains its original text as an applied historical file — that is fine and expected, since migrations are immutable history. What must **not** appear is the ratio in any file numbered above 031 other than 033.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/033_price_tokens.sql
git commit -m "feat(cost): extract price_tokens as sole pricing authority"
```

---

### Task 4: get_session_cost RPC

**Files:**
- Create: `supabase/migrations/034_session_cost.sql`

**Interfaces:**
- Consumes: `public.price_tokens(...)` (Task 3), `sessions.cache_creation_tokens` / `cache_read_tokens` (Task 2)
- Produces: `public.get_session_cost(p_user_id uuid, p_session_ids text[])` returning `(session_id text, input_tokens bigint, output_tokens bigint, cache_creation_tokens bigint, cache_read_tokens bigint, cost_usd numeric)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/034_session_cost.sql`:

```sql
-- 034: Cache-aware session cost.
--
-- Array-keyed so the sessions list resolves a full page in one round trip
-- instead of N calls. Cache columns pass through unmodified so the caller can
-- still distinguish null ("plugin older than 1.3.3") from 0 ("no cache").
-- cost_usd is null when the session's model has no model_pricing row.

create or replace function public.get_session_cost(
  p_user_id     uuid,
  p_session_ids text[]
) returns table (
  session_id            text,
  input_tokens          bigint,
  output_tokens         bigint,
  cache_creation_tokens bigint,
  cache_read_tokens     bigint,
  cost_usd              numeric
) language sql stable as $$
  select
    s.session_id,
    coalesce(s.input_tokens,  0)::bigint as input_tokens,
    coalesce(s.output_tokens, 0)::bigint as output_tokens,
    s.cache_creation_tokens,
    s.cache_read_tokens,
    public.price_tokens(
      s.model,
      coalesce(s.input_tokens,  0)::bigint,
      coalesce(s.output_tokens, 0)::bigint,
      coalesce(s.cache_creation_tokens, 0)::bigint,
      coalesce(s.cache_read_tokens,     0)::bigint
    ) as cost_usd
  from public.sessions s
  where s.user_id = p_user_id
    and s.session_id = any(p_session_ids);
$$;
```

- [ ] **Step 2: Apply the migration**

```bash
psql "$TC_DB" -f supabase/migrations/034_session_cost.sql
```

Expected: `CREATE FUNCTION`, no error.

- [ ] **Step 3: Assert against three session shapes**

```bash
psql "$TC_DB" <<'SQL'
insert into public.sessions
  (user_id, session_id, started_at, model, input_tokens, output_tokens,
   cache_creation_tokens, cache_read_tokens)
values
  -- captured by 1.3.3, has cache
  ('11111111-1111-1111-1111-111111111111', 'sc-cached', now(), 'test-synced',
   1000000, 1000000, 1000000, 1000000),
  -- captured by 1.3.3, genuinely no cache
  ('11111111-1111-1111-1111-111111111111', 'sc-zero', now(), 'test-synced',
   1000000, 1000000, 0, 0),
  -- pre-1.3.3: cache columns null
  ('11111111-1111-1111-1111-111111111111', 'sc-legacy', now(), 'test-synced',
   1000000, 1000000, null, null),
  -- unpriced model
  ('11111111-1111-1111-1111-111111111111', 'sc-unpriced', now(), 'mystery-model',
   1000000, 1000000, 1000, 1000)
on conflict (user_id, session_id) do nothing;

select session_id, cache_creation_tokens, cache_read_tokens, cost_usd
from public.get_session_cost(
  '11111111-1111-1111-1111-111111111111'::uuid,
  array['sc-cached','sc-zero','sc-legacy','sc-unpriced']
)
order by session_id;
SQL
```

Expected:

| session_id | cache_creation_tokens | cache_read_tokens | cost_usd |
|---|---|---|---|
| sc-cached | 1000000 | 1000000 | 22.050000 |
| sc-legacy | (null) | (null) | 18.000000 |
| sc-unpriced | 1000 | 1000 | (null) |
| sc-zero | 0 | 0 | 18.000000 |

`sc-legacy` and `sc-zero` produce the same cost but differ in their cache columns — that is precisely the distinction the frontend renders as "Not captured" versus "0".

If the `on conflict (user_id, session_id)` clause errors, check the actual unique constraint with `\d public.sessions` and use the real one.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/034_session_cost.sql
git commit -m "feat(cost): add cache-aware get_session_cost RPC"
```

---

### Task 5: Service layer and types

**Files:**
- Modify: `apps/app/src/types/analytics.ts` (`AgentTreeNode`, around line 112)
- Modify: `apps/app/src/lib/services/analytics.service.ts` (append after `getAgentTree`, line 308)
- Modify: `apps/app/src/lib/graph/spawn-graph.ts:2-12, 32-40, 47, 116-129`
- Test: `apps/app/src/lib/__tests__/analytics.service.test.ts`
- Test: `apps/app/src/lib/graph/__tests__/spawn-graph.test.ts`

**Interfaces:**
- Consumes: `get_session_cost` (Task 4), extended `get_agent_tree` (Task 3)
- Produces:
  - `interface SessionCost { session_id: string; input_tokens: number; output_tokens: number; cache_creation_tokens: number | null; cache_read_tokens: number | null; cost_usd: number | null }`
  - `AgentTreeNode` gains `status: string | null`, `model: string | null`, `tool_count: number | null`; its `estimated_cost_usd` becomes `number | null`
  - `getSessionCosts(supabase: SupabaseClient, userId: string, sessionIds: string[]): Promise<ServiceResult<SessionCost[]>>`

- [ ] **Step 1: Write the failing service tests**

Add to `apps/app/src/lib/__tests__/analytics.service.test.ts` (and add `getSessionCosts` to the import block at the top):

```typescript
describe("getSessionCosts", () => {
  it("returns cost rows from the RPC on success", async () => {
    const rows = [
      {
        session_id: "sc-cached",
        input_tokens: 1000000,
        output_tokens: 1000000,
        cache_creation_tokens: 1000000,
        cache_read_tokens: 1000000,
        cost_usd: 22.05,
      },
      {
        session_id: "sc-legacy",
        input_tokens: 1000000,
        output_tokens: 1000000,
        cache_creation_tokens: null,
        cache_read_tokens: null,
        cost_usd: 18.0,
      },
    ];
    const supabase = createMockSupabase({}, { get_session_cost: { data: rows } });
    const result = await getSessionCosts(supabase, USER_ID, ["sc-cached", "sc-legacy"]);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(rows);
  });

  it("returns an empty array without calling the RPC for no ids", async () => {
    const supabase = createMockSupabase({}, {});
    const result = await getSessionCosts(supabase, USER_ID, []);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it("returns RPC_FAILED on RPC error", async () => {
    const supabase = createMockSupabase({}, {
      get_session_cost: { data: null, error: { message: "rpc failed" } },
    });
    const result = await getSessionCosts(supabase, USER_ID, ["x"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});
```

The empty-ids test matters: the sessions list renders an empty page when a filter matches nothing, and `array[]::text[]` round trips are a needless call.

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts
```

Expected: FAIL — `getSessionCosts` is not exported.

- [ ] **Step 3: Add the type**

In `apps/app/src/types/analytics.ts`, add after the `AgentTreeNode` interface:

```typescript
export interface SessionCost {
  session_id: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number | null;
  cache_read_tokens: number | null;
  cost_usd: number | null;
}
```

And update `AgentTreeNode` — change `estimated_cost_usd: number;` to `estimated_cost_usd: number | null;` and add three fields:

```typescript
  estimated_cost_usd: number | null;
  status: string | null;
  model: string | null;
  tool_count: number | null;
```

- [ ] **Step 4: Add the service function**

Append to `apps/app/src/lib/services/analytics.service.ts` (import `SessionCost` from `@/types/analytics` alongside the existing type imports):

```typescript
// ---------------------------------------------------------------------------
// Session cost
// ---------------------------------------------------------------------------

export async function getSessionCosts(
  supabase: SupabaseClient,
  userId: string,
  sessionIds: string[]
): Promise<ServiceResult<SessionCost[]>> {
  if (sessionIds.length === 0) return { success: true, data: [] };

  const { data, error } = await supabase.rpc("get_session_cost", {
    p_user_id: userId,
    p_session_ids: sessionIds,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get session costs", details: error.message },
    };
  }

  return { success: true, data: (data as SessionCost[]) ?? [] };
}
```

- [ ] **Step 5: Widen the graph builder for null costs**

`estimated_cost_usd` is now nullable, so `spawn-graph.ts` must stop assuming `number`. In `apps/app/src/lib/graph/spawn-graph.ts`:

Change `SpawnGraphNode.costUsd` (line 8) and `GraphInputNode.costUsd` (line 33) from `costUsd: number;` to:

```typescript
  costUsd: number | null;
```

Change `weightOf` (line 47) to treat an unpriced node as cold rather than crashing:

```typescript
  const weightOf = (n: GraphInputNode) => (weight === "cost" ? n.costUsd ?? 0 : n.durationMs);
```

`buildAgentGraph` (line 116) needs no change — it already passes `n.estimated_cost_usd` straight through. `buildSpawnGraph` also needs none: `SessionTreeNode.estimated_cost_usd` stays non-null.

`SpawnGraphView` needs no change either — `formatUsd` (`lib/format/agents.ts:1`) already takes `number | null` and returns `"--"` for null, so an unpriced node renders `--` instead of `$0.00` with no further edit.

- [ ] **Step 6: Add a graph test for the null cost**

The file's `agent()` factory at `spawn-graph.test.ts:86` builds `AgentTreeNode` and must gain the three new fields or it will stop type-checking. Add these to its return object beside `estimated_cost_usd`:

```typescript
    status: p.status ?? null,
    model: p.model ?? null,
    tool_count: p.tool_count ?? null,
```

Then add to the `describe("buildAgentGraph", ...)` block:

```typescript
  it("treats an unpriced agent as zero-weight without dropping it", () => {
    const g = buildAgentGraph([
      agent({ agent_id: "a", depth: 0, duration_ms: 10, estimated_cost_usd: null }),
      agent({ agent_id: "b", parent_agent_id: "a", depth: 1, duration_ms: 10, estimated_cost_usd: 0.5 }),
    ]);
    expect(g.nodes).toHaveLength(2);
    const unpriced = g.nodes.find((n) => n.id === "a")!;
    expect(unpriced.costUsd).toBeNull();
    expect(unpriced.costHeat).toBe(0);
  });
```

Note the factory's `estimated_cost_usd: p.estimated_cost_usd ?? 0` line coerces an explicit `null` back to `0`. Change it to preserve null:

```typescript
    estimated_cost_usd: p.estimated_cost_usd === undefined ? 0 : p.estimated_cost_usd,
```

- [ ] **Step 7: Run the full app suite**

```bash
cd apps/app && bun test
```

Expected: all PASS. `cost.test.ts` still passes — `computeCost` is not removed until Task 8.

- [ ] **Step 8: Typecheck**

```bash
cd apps/app && bunx tsc --noEmit
```

Expected: no errors. If `sessions/[id]/page.tsx` or `sessions/page.tsx` error on `estimated_cost_usd`, those are fixed in Tasks 7 and 8 — note them and proceed only if the error is confined to those two files.

- [ ] **Step 9: Commit**

```bash
git add apps/app/src/types/analytics.ts apps/app/src/lib/services/analytics.service.ts \
        apps/app/src/lib/graph/spawn-graph.ts \
        apps/app/src/lib/__tests__/analytics.service.test.ts \
        apps/app/src/lib/graph/__tests__/spawn-graph.test.ts
git commit -m "feat(cost): add getSessionCosts service and nullable agent cost"
```

---

### Task 6: Cache summary helpers

**Files:**
- Create: `apps/app/src/lib/analytics/session-cache.ts`
- Test: `apps/app/src/lib/analytics/__tests__/session-cache.test.ts`

**Interfaces:**
- Consumes: `SessionCost` (Task 5)
- Produces:
  - `interface SessionCacheSummary { captured: boolean; creationTokens: number; readTokens: number; hitRatio: number | null }`
  - `summariseSessionCache(cost: SessionCost | undefined): SessionCacheSummary`

- [ ] **Step 1: Write the failing tests**

Create `apps/app/src/lib/analytics/__tests__/session-cache.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { summariseSessionCache } from "../session-cache";
import type { SessionCost } from "@/types/analytics";

function cost(p: Partial<SessionCost>): SessionCost {
  return {
    session_id: p.session_id ?? "s1",
    input_tokens: p.input_tokens ?? 0,
    output_tokens: p.output_tokens ?? 0,
    cache_creation_tokens: p.cache_creation_tokens ?? null,
    cache_read_tokens: p.cache_read_tokens ?? null,
    cost_usd: p.cost_usd ?? null,
  };
}

describe("summariseSessionCache", () => {
  it("reports not captured when both cache columns are null", () => {
    const s = summariseSessionCache(cost({ cache_creation_tokens: null, cache_read_tokens: null }));
    expect(s.captured).toBe(false);
    expect(s.hitRatio).toBeNull();
  });

  it("reports captured when the columns are zero", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 0, cache_read_tokens: 0, input_tokens: 100 })
    );
    expect(s.captured).toBe(true);
    expect(s.creationTokens).toBe(0);
    expect(s.readTokens).toBe(0);
    expect(s.hitRatio).toBe(0);
  });

  it("computes hit ratio as read / (read + input)", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 500, cache_read_tokens: 900, input_tokens: 100 })
    );
    expect(s.hitRatio).toBeCloseTo(0.9, 6);
  });

  it("returns a null ratio when read and input are both zero", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 42, cache_read_tokens: 0, input_tokens: 0 })
    );
    expect(s.captured).toBe(true);
    expect(s.hitRatio).toBeNull();
  });

  it("treats a single populated column as captured", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 10, cache_read_tokens: null, input_tokens: 90 })
    );
    expect(s.captured).toBe(true);
    expect(s.readTokens).toBe(0);
  });

  it("reports not captured for a missing cost row", () => {
    const s = summariseSessionCache(undefined);
    expect(s.captured).toBe(false);
    expect(s.creationTokens).toBe(0);
    expect(s.hitRatio).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd apps/app && bun test src/lib/analytics/__tests__/session-cache.test.ts
```

Expected: FAIL — module `../session-cache` not found.

- [ ] **Step 3: Implement**

Create `apps/app/src/lib/analytics/session-cache.ts`:

```typescript
import type { SessionCost } from "@/types/analytics";

export interface SessionCacheSummary {
  /** False when the plugin predates 1.3.3 — render "Not captured", not "0". */
  captured: boolean;
  creationTokens: number;
  readTokens: number;
  /** read / (read + input). Null when the denominator is zero. */
  hitRatio: number | null;
}

const NOT_CAPTURED: SessionCacheSummary = {
  captured: false,
  creationTokens: 0,
  readTokens: 0,
  hitRatio: null,
};

export function summariseSessionCache(cost: SessionCost | undefined): SessionCacheSummary {
  if (!cost) return NOT_CAPTURED;

  const captured = cost.cache_creation_tokens !== null || cost.cache_read_tokens !== null;
  if (!captured) return NOT_CAPTURED;

  const creationTokens = cost.cache_creation_tokens ?? 0;
  const readTokens = cost.cache_read_tokens ?? 0;
  const denominator = readTokens + cost.input_tokens;

  return {
    captured: true,
    creationTokens,
    readTokens,
    hitRatio: denominator > 0 ? readTokens / denominator : null,
  };
}
```

- [ ] **Step 4: Run to verify passing**

```bash
cd apps/app && bun test src/lib/analytics/__tests__/session-cache.test.ts
```

Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/analytics/session-cache.ts \
        apps/app/src/lib/analytics/__tests__/session-cache.test.ts
git commit -m "feat(cost): add session cache summary helper"
```

---

### Task 7: Sessions list reads cost from the RPC

**Files:**
- Modify: `apps/app/src/app/(dashboard)/sessions/page.tsx:96, 113-123, 225-232`

**Interfaces:**
- Consumes: `getSessionCosts` (Task 5)
- Produces: nothing consumed by later tasks

- [ ] **Step 1: Replace the pricing fetch with the cost RPC**

In `apps/app/src/app/(dashboard)/sessions/page.tsx`:

Delete the `supabase.from("model_pricing").select(...)` entry from the `Promise.all` array (line 96) and remove `pricingResult` from the destructuring on the left of that `Promise.all`. Delete the `rates` construction at lines 113-123 entirely.

After `sessions` is built (line 111), add:

```typescript
  const costResult = await getSessionCosts(
    supabase,
    viewUserId,
    sessions.map((s) => s.session_id)
  );
  const costById = new Map(
    (costResult.success ? costResult.data : []).map((c) => [c.session_id, c])
  );
```

A failed RPC yields an empty map, so every cost cell renders `--` and the page still loads — matching the existing degraded-state behaviour elsewhere in the app.

Update the imports at the top of the file: drop `computeCost` and `RateMap`, keep `formatCost`, and add:

```typescript
import { getSessionCosts } from "@/lib/services/analytics.service";
```

- [ ] **Step 2: Render cost from the map**

Replace the cost cell (lines 225-232) with:

```typescript
                    <TableCell className="text-right font-mono text-sm">
                      {formatCost(costById.get(session.session_id)?.cost_usd ?? null)}
                    </TableCell>
```

- [ ] **Step 3: Typecheck and lint**

```bash
cd apps/app && bunx tsc --noEmit && bun run lint
```

Expected: no errors from `sessions/page.tsx`. Errors remaining in `sessions/[id]/page.tsx` are expected until Task 8.

- [ ] **Step 4: Verify in the running app**

```bash
cd /Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app && bun run dev:app
```

Open `http://localhost:3000/sessions`. Expected: the Cost column populates for sessions whose model is in `model_pricing`, and shows `--` (not `$0.00`) for sessions with an unpriced model. Cache-bearing sessions should now show a **higher** number than before this change — that is the fix working.

- [ ] **Step 5: Commit**

```bash
git add "apps/app/src/app/(dashboard)/sessions/page.tsx"
git commit -m "feat(cost): price sessions list from get_session_cost"
```

---

### Task 8: Session detail — cost, Cache card, Agents table

The largest task. It removes the last `computeCost` callers, so `lib/cost.ts` loses its cost math here.

**Files:**
- Create: `apps/app/src/lib/format/duration.ts`
- Create: `apps/app/src/lib/format/__tests__/duration.test.ts`
- Create: `apps/app/src/components/sessions/agents-table.tsx`
- Modify: `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx:19-26, 105-128, 155-220, 222-275, 277-311`
- Modify: `apps/app/src/app/(dashboard)/sessions/page.tsx:29-35`
- Modify: `apps/app/src/lib/cost.ts`
- Modify: `apps/app/src/lib/__tests__/cost.test.ts`

**Interfaces:**
- Consumes: `getSessionCosts` (Task 5), `summariseSessionCache` (Task 6), extended `AgentTreeNode` (Task 5)
- Produces: `<AgentsTable agents={AgentTreeNode[]} />`, `formatDuration(ms: number | null): string`

- [ ] **Step 1: Extract formatDuration into a shared module**

`formatDuration` is currently defined twice — `sessions/[id]/page.tsx:19-26` and `sessions/page.tsx:29-35` — with slightly different bodies that happen to behave identically. The new Agents table needs it too, so make it shared rather than adding a third copy.

Create `apps/app/src/lib/format/duration.ts`:

```typescript
export function formatDuration(ms: number | null): string {
  if (ms === null) return "--";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
```

Create `apps/app/src/lib/format/__tests__/duration.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { formatDuration } from "../duration";

describe("formatDuration", () => {
  it("returns -- for null", () => {
    expect(formatDuration(null)).toBe("--");
  });

  it("renders sub-hour durations in minutes", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(90_000)).toBe("1m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("renders hour-plus durations as h m", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h 0m");
    expect(formatDuration(95 * 60_000)).toBe("1h 35m");
  });
});
```

Delete the local `formatDuration` from both pages and add to each:

```typescript
import { formatDuration } from "@/lib/format/duration";
```

Run:

```bash
cd apps/app && bun test src/lib/format/__tests__/duration.test.ts
```

Expected: 3 PASS.

- [ ] **Step 2: Create the Agents table component**

Create `apps/app/src/components/sessions/agents-table.tsx`:

```typescript
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatUsd, formatTokens } from "@/lib/format/agents";
import { formatDuration } from "@/lib/format/duration";
import type { AgentTreeNode } from "@/types/analytics";

export function AgentsTable({ agents }: { agents: AgentTreeNode[] }) {
  if (agents.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Agents</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Tools</TableHead>
              <TableHead className="text-right">In / Out</TableHead>
              <TableHead className="text-right">Cache R / C</TableHead>
              <TableHead className="text-right">Cost</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((a) => (
              <TableRow key={a.agent_id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-muted-foreground"
                      style={{ paddingLeft: `${a.depth * 12}px` }}
                    />
                    <span className="font-medium">
                      {a.agent_type || a.agent_id.slice(0, 8)}
                    </span>
                    {a.edge_label && <Badge variant="outline">{a.edge_label}</Badge>}
                  </div>
                </TableCell>
                <TableCell>
                  {a.status ? (
                    <Badge variant={a.status === "completed" ? "secondary" : "destructive"}>
                      {a.status}
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {a.model ?? "--"}
                </TableCell>
                <TableCell className="text-right">{formatDuration(a.duration_ms)}</TableCell>
                <TableCell className="text-right">{a.tool_count ?? "--"}</TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatTokens(a.input_tokens)} / {formatTokens(a.output_tokens)}
                </TableCell>
                <TableCell className="text-right font-mono text-xs">
                  {formatTokens(a.cache_read_tokens)} / {formatTokens(a.cache_creation_tokens)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatUsd(a.estimated_cost_usd)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

Before running, confirm the import paths for `formatDuration` — grep for it (`grep -rn "export function formatDuration" apps/app/src`) and use the real module. If it lives elsewhere (for example `@/lib/format`), fix the import rather than creating a duplicate.

Rows arrive pre-sorted by `depth, started_at` from the RPC, so no client-side sort. The `depth * 12px` indent makes lineage readable without re-deriving the tree.

- [ ] **Step 3: Fetch costs on the detail page**

In `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`, delete the `model_pricing` query and `rates` construction (lines 105-113) and the `sessionCost = computeCost(...)` block (lines 115-120). Replace with:

```typescript
  const costSessionIds = [typedSession.session_id, ...childSessions.map((c) => c.session_id)];
  const costResult = await getSessionCosts(supabase, user.id, costSessionIds);
  const costById = new Map(
    (costResult.success ? costResult.data : []).map((c) => [c.session_id, c])
  );
  const sessionCostRow = costById.get(typedSession.session_id);
  const sessionCost = sessionCostRow?.cost_usd ?? null;
  const cacheSummary = summariseSessionCache(sessionCostRow);
```

One RPC call covers the session and every child, so the "Subagent Sessions" card is priced from the same authority.

If `childSessions` rows expose only the DB `id` and not `session_id`, extend the child query's `.select(...)` to include `session_id`.

Update imports: drop `computeCost` and `RateMap`, keep `formatCost`, and add:

```typescript
import { getSessionCosts } from "@/lib/services/analytics.service";
import { summariseSessionCache } from "@/lib/analytics/session-cache";
import { AgentsTable } from "@/components/sessions/agents-table";
```

- [ ] **Step 4: Add the Cache card**

The stat grid at line 155 is `lg:grid-cols-5`. Change it to `lg:grid-cols-6` and add this card after the existing Cost card (which ends at line 218):

```typescript
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Cache
            </CardTitle>
          </CardHeader>
          <CardContent>
            {cacheSummary.captured ? (
              <>
                <div className="text-2xl font-bold font-mono">
                  {cacheSummary.hitRatio === null
                    ? "--"
                    : `${Math.round(cacheSummary.hitRatio * 100)}%`}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatTokens(cacheSummary.readTokens)} read ·{" "}
                  {formatTokens(cacheSummary.creationTokens)} written
                </p>
              </>
            ) : (
              <>
                <div className="text-base text-muted-foreground">Not captured</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Requires plugin 1.3.3+
                </p>
              </>
            )}
          </CardContent>
        </Card>
```

Add `formatTokens` to the imports from `@/lib/format/agents`. This mirrors the existing plugin-version hint at `agents/page.tsx:70-75`.

- [ ] **Step 5: Replace the Agents card**

Delete the entire IIFE block at lines 222-275 — the one opening `{(() => { const agentEvents = typedEvents.filter((e) => e.event_type === "subagent_stop");` — and replace it with:

```typescript
      <AgentsTable agents={agents} />
```

`agents` is already in scope from the `getAgentTree` call at line 126. `AgentsTable` returns null for an empty array, so no conditional wrapper is needed.

- [ ] **Step 6: Price child sessions from the map**

In the "Subagent Sessions" card, replace the `childCost = computeCost(...)` block with:

```typescript
                const childCost = costById.get(child.session_id)?.cost_usd ?? null;
```

- [ ] **Step 7: Strip the cost math from lib/cost.ts**

`apps/app/src/lib/cost.ts` now has no `computeCost` callers. Replace the whole file with:

```typescript
export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "--";
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
```

Confirm nothing else imports the removed symbols:

```bash
cd apps/app && grep -rn "computeCost\|RateMap" src/
```

Expected: only hits in `src/lib/__tests__/cost.test.ts`, cleaned up in the next step. Any other hit must be migrated before proceeding.

- [ ] **Step 8: Trim the cost tests**

In `apps/app/src/lib/__tests__/cost.test.ts`, delete the entire `describe("computeCost", ...)` block and the `rates` fixture above it, and change the import line to:

```typescript
import { formatCost } from "../cost";
```

Keep the whole `describe("formatCost", ...)` block unchanged — that behaviour is unaffected.

- [ ] **Step 9: Run the full suite and typecheck**

```bash
cd apps/app && bun test && bunx tsc --noEmit && bun run lint
```

Expected: all tests PASS, no type errors anywhere, no lint errors.

- [ ] **Step 10: Verify in the running app**

```bash
cd /Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app && bun run dev:app
```

Open a session detail page with subagents. Confirm:
- The Cost card matches that session's row in the sessions list.
- The Cache card shows a percentage for a 1.3.3-captured session and "Not captured" for an older one.
- The Agents table shows status, model and tool count — data that was previously unreachable — and its per-agent costs match the spawn graph node labels below it. **These two numbers agreeing is the headline outcome of this plan.**

- [ ] **Step 11: Commit**

```bash
git add "apps/app/src/app/(dashboard)/sessions/[id]/page.tsx" \
        apps/app/src/components/sessions/agents-table.tsx \
        apps/app/src/lib/cost.ts apps/app/src/lib/__tests__/cost.test.ts
git commit -m "feat(cost): cache-aware session detail and agents table"
```

---

### Task 9: Label the surfaces that stay cache-blind

Spec §7: `/cost` and `/agents` still price input and output only, so a session's cost on `/sessions` now visibly exceeds its contribution to the `/cost` daily total. Label it so it reads as a known limit, not a bug.

**Files:**
- Modify: `apps/app/src/app/(dashboard)/cost/page.tsx`
- Modify: `apps/app/src/app/(dashboard)/agents/page.tsx`
- Modify: `docs/changelog.md`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Label the cost page**

In `apps/app/src/app/(dashboard)/cost/page.tsx`, under the page's `<h1>`, add:

```typescript
        <p className="text-sm text-muted-foreground">
          Excludes cache tokens. Session-level costs on{" "}
          <Link href="/sessions" className="text-primary underline-offset-4 hover:underline">
            Sessions
          </Link>{" "}
          are cache-aware and will be higher.
        </p>
```

Add `import Link from "next/link";` if the file does not already import it.

- [ ] **Step 2: Label the agents page**

In `apps/app/src/app/(dashboard)/agents/page.tsx`, add the same note under the page heading, adjusted:

```typescript
        <p className="text-sm text-muted-foreground">
          Cost excludes cache tokens. Per-agent cache-aware cost is on each session&apos;s detail page.
        </p>
```

Place it above the existing `latency_sample_count` banner at lines 70-75 rather than replacing it — the two notes cover different gaps.

- [ ] **Step 3: Record the change**

Add to `docs/changelog.md`, matching the file's existing format:

```markdown
- Session cost is now cache-aware end to end: the plugin (1.3.3) captures cache
  tokens from the transcript, `sessions` stores them, and all session-surface
  pricing runs through the single `price_tokens` SQL function. Session detail
  gains a Cache card and an Agents table sourced from the `agents` table
  (status, model, tool count, cache tokens). Unpriced models now render `--`
  rather than `$0.00`. The Cost and Agents pages remain cache-blind and are
  labelled as such.
```

- [ ] **Step 4: Verify**

```bash
cd apps/app && bunx tsc --noEmit && bun run lint && bun test
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add "apps/app/src/app/(dashboard)/cost/page.tsx" \
        "apps/app/src/app/(dashboard)/agents/page.tsx" docs/changelog.md
git commit -m "docs(cost): label cache-blind surfaces and record spec F"
```

---

## Deviation from the spec

Spec §3.5 ends with "Node tooltips gain the cache breakdown, since the data arrives in the same fetch." **This plan drops that item.**

`SpawnGraphView` renders ReactFlow's default node type, which displays `data.label` and nothing else — a tooltip needs a registered custom node component, which is materially more work than the sentence implies. The Agents table from Task 8 sits directly above the graph and already shows per-agent cache read and creation tokens for every node in it, so the tooltip would duplicate visible information at real cost.

If tooltips are still wanted, they belong in a separate change alongside a custom node type.

## Follow-on, not in this plan

Spec §7 records the unification work: repoint `get_daily_cost`, `get_cost_by_model`, `get_top_agents`, `get_agent_timeseries` and `get_eval_comparison` at `price_tokens`, which removes the Task 9 labels. That is deliberately deferred until plugin 1.3.3 has produced real cache-token traffic to validate against. `get_top_agents` will need the most care — it aggregates `subagent_stop` events, not the `agents` table, so it needs its own cache-token source.
