# Migration validation notes — 001–031 against real Postgres

Date: 2026-07-20
Branch: `spec/cache-aware-session-cost`
Target: local Supabase only (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`). No remote/hosted project was touched.

## Summary

**Migrations 001–031 apply cleanly. Zero failures. No migration file was modified.**

Specs A, B, C, D1, D2 and E all recorded that 022–031 had never been executed against a real Postgres. They now have been. Every one applied on the first attempt.

## Step 1 — Start local Supabase

```
$ supabase start
...
Applying migration 031_agent_tree_cache_cost.sql...
WARN: no files matched pattern: supabase/seed.sql
Started supabase local development setup.
DB_URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
```

```
export TC_DB="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
```

## Step 2 — `supabase db reset`

```
$ supabase db reset
Resetting local database...
Recreating database...
Initialising schema...
Seeding globals from roles.sql...
Applying migration 001_user_profiles.sql...
NOTICE (00000): trigger "on_auth_user_created" for relation "auth.users" does not exist, skipping
Applying migration 002_api_keys.sql...
Applying migration 003_teams.sql...
Applying migration 004_events.sql...
Applying migration 005_sessions.sql...
Applying migration 006_daily_aggregates.sql...
Applying migration 007_functions.sql...
Applying migration 008_partition_cron.sql...
Applying migration 009_agent_calls.sql...
Applying migration 010_tool_trend.sql...
Applying migration 011_agent_functions.sql...
Applying migration 012_cost_schema.sql...
Applying migration 013_cost_rpcs.sql...
Applying migration 014_team_analytics.sql...
Applying migration 015_team_shares.sql...
Applying migration 016_check_shared_team.sql...
Applying migration 017_skill_stats.sql...
Applying migration 018_skill_indexes.sql...
Applying migration 019_universal_spawner_chain.sql...
Applying migration 020_fix_agent_type_empty_string.sql...
Applying migration 021_agent_type_general_purpose.sql...
Applying migration 022_agent_timeseries.sql...
Applying migration 023_tree_cost.sql...
Applying migration 024_agent_latency.sql...
Applying migration 025_tree_edge_label.sql...
Applying migration 026_eval_tagging.sql...
Applying migration 027_eval_rpcs.sql...
Applying migration 028_agents.sql...
Applying migration 029_agent_tree.sql...
Applying migration 030_cache_aware_cost.sql...
Applying migration 031_agent_tree_cache_cost.sql...
WARN: no files matched pattern: supabase/seed.sql
Restarting containers...
Finished supabase db reset on branch spec/cache-aware-session-cost.
```

The only diagnostic emitted is a benign `NOTICE` from 001's idempotent `drop trigger if exists`. Nothing failed. **No edits were made to any migration file.**

## Step 3 — RPC / schema verification

### `get_agent_tree` — verified signature

```
$ psql "$TC_DB" -c "\df public.get_agent_tree"
 Schema |      Name      | Result data type | Argument data types | Type
 public | get_agent_tree | TABLE(agent_id text, parent_agent_id text, agent_type text, edge_label text,
                                 depth integer, started_at timestamp with time zone,
                                 ended_at timestamp with time zone, duration_ms bigint,
                                 input_tokens bigint, output_tokens bigint,
                                 cache_creation_tokens bigint, cache_read_tokens bigint,
                                 estimated_cost_usd numeric)
                         | p_user_id uuid, p_session_id text | func
(1 row)
```

Canonical form for downstream tasks:

```
public.get_agent_tree(p_user_id uuid, p_session_id text)
  returns table (
    agent_id               text,
    parent_agent_id        text,
    agent_type             text,
    edge_label             text,
    depth                  integer,
    started_at             timestamptz,
    ended_at               timestamptz,
    duration_ms            bigint,
    input_tokens           bigint,
    output_tokens          bigint,
    cache_creation_tokens  bigint,
    cache_read_tokens      bigint,
    estimated_cost_usd     numeric
  )
```

**13 output columns — the brief's number is correct**, and the column order above is authoritative.

### `get_session_cost` — absent, as expected

```
$ psql "$TC_DB" -c "\df public.get_session_cost"
 Schema | Name | Result data type | Argument data types | Type
(0 rows)
```

Task 4 is free to create it.

### `public.agents` — all four cache/result columns present

```
$ psql "$TC_DB" -c "\d public.agents"
 result_input_tokens          | bigint
 result_output_tokens         | bigint
 result_cache_creation_tokens | bigint
 result_cache_read_tokens     | bigint
```

(Full table also has: `id uuid pk`, `user_id uuid not null`, `agent_id text not null`, `session_id text not null`,
`parent_agent_id text`, `agent_type text`, `edge_label text`, `status text`, `model text`,
`started_at`/`ended_at timestamptz`, `duration_ms bigint`, `input_tokens`/`output_tokens bigint`,
`tool_count integer`, `created_at timestamptz not null default now()`.
Unique constraint `agents_user_id_agent_id_key (user_id, agent_id)`; indexes `idx_agents_parent`, `idx_agents_user_session`; RLS on.)

### `public.model_pricing` — both cache pricing columns present

```
$ psql "$TC_DB" -c "\d public.model_pricing"
 model_id                   | text                     | not null
 input_cost_per_1m          | numeric(10,6)            | not null
 output_cost_per_1m         | numeric(10,6)            | not null
 updated_at                 | timestamp with time zone | default now()
 cache_creation_cost_per_1m | numeric(10,6)            |
 cache_read_cost_per_1m     | numeric(10,6)            |
```

Note both cache columns are **nullable** with no default — cost RPCs must `coalesce(..., 0)` (or fall back to input/output rates) or cache-aware cost silently becomes NULL for any model row seeded before 030.

## Step 4 — Smoke-call `get_agent_tree`

```
$ psql "$TC_DB" -c "select * from public.get_agent_tree('00000000-0000-0000-0000-000000000000'::uuid, 'nope');"
 agent_id | parent_agent_id | agent_type | edge_label | depth | started_at | ended_at | duration_ms | input_tokens | output_tokens | cache_creation_tokens | cache_read_tokens | estimated_cost_usd
----------+-----------------+------------+------------+-------+------------+----------+-------------+--------------+---------------+-----------------------+-------------------+--------------------
(0 rows)
```

Zero rows, no error. The recursive CTE in 029/031 compiles and executes.

## Step 5 — Known-suspect investigations (record only; **not fixed here**)

Both were checked by reading the emitting hooks *and* by executing the RPCs against seeded rows in a transaction that was rolled back.

### 5a. `get_session_tree`'s `edge_label` lateral (`025_tree_edge_label.sql:53-66`) — **CONFIRMED DEAD**

The lateral is gated on:

```sql
where ss_ev.event_type = 'session_start'
  and ss_ev.data->>'agent_id' is not null
```

`claude-plugin/hooks/session_start.py` builds its event payload as `{"cwd": ...}` plus optional `eval_id` / `eval_variant`. **It never writes `agent_id`.** Git history confirms this is exactly the D1 removal:

```
$ git log --oneline -S"agent_id" -- claude-plugin/hooks/session_start.py
0b98c78 refactor(plugin): delete dead agent spawn-context path; bump to 1.3.0
634c9ef fix(graph): resolve edge_label via session_start agent_id; record agent_id on session_start
```

634c9ef added the field specifically to feed this lateral; 0b98c78 (D1) deleted it. Migration 025 was never updated.

Empirical proof — seeded a session with a `session_start` in the current (post-D1) shape plus `tool_use`/`tool_result` rows carrying `agent_id` and `edge_label: "review"`:

```
### get_session_tree (session_start has NO agent_id -> edge_label expected NULL)
 session_id | depth | edge_label | tool_count | subagent_count
------------+-------+------------+------------+----------------
 sess-1     |     0 |            |          1 |              1

### control: add agent_id back onto session_start -> edge_label should populate
UPDATE 1
 session_id | edge_label
------------+------------
 sess-1     | review
```

The control confirms the lateral's SQL is correct in isolation; it is the *input* that no longer exists. **`get_session_tree.edge_label` is unconditionally NULL for all data emitted by plugin >= 1.3.0.** Any UI reading it is showing an empty column. Out of scope for this plan — flagged for a follow-up.

### 5b. `get_top_agents`' latency join (`024_agent_latency.sql:74-84`) — **PRESERVED (with one caveat)**

The join requires `tool_result` rows with `tool_name = 'Agent'`, non-null `duration_ms`, and non-null `data->>'agent_id'`, matched against `subagent_stop.data->>'agent_id'`.

D1 did **not** remove any of these:

- `claude-plugin/hooks/post_tool_use.py:81-82` — `if agent_id: event_data["agent_id"] = agent_id` (from the pending entry pushed by `pre_tool_use.py:59-62` for the `Agent` tool).
- `claude-plugin/hooks/post_tool_use.py:98-102` — when `agent_result` carries Claude Code's native `agentId`, it **overwrites** `event_data["agent_id"]`, explicitly so it matches what SubagentStop reports.
- `claude-plugin/hooks/subagent_stop.py:39-40` — `if agent_id: event_data["agent_id"] = agent_id`.
- `claude-plugin/lib/telemetry.py:56` — `"tool_end": "tool_result"`, so the `tool_end` events written by post_tool_use land in the DB as `event_type = 'tool_result'`. (Worth knowing: nothing in the codebase writes the literal string `tool_result`; the rename happens in the telemetry layer.)

Empirical proof, same seeded fixture:

```
### get_top_agents (latency join via subagent_stop.agent_id = tool_result.agent_id)
[{"agent_type":"code-reviewer","count":1,"avg_tool_count":null,"avg_turns":null,
  "total_input_tokens":0,"total_output_tokens":0,"total_cost_usd":0.000000,
  "p50_latency_ms":60000,"p99_latency_ms":60000,"latency_sample_count":1,"trend":null}]
```

Latency populates. **Caveat:** the id on the `tool_result` is the native `agentId` only when `agent_result` supplies it; otherwise it stays the locally-minted correlation id from `generate_correlation_id()`, which will never equal SubagentStop's `agent_id`. Those samples are dropped silently — `latency_sample_count` under-reports rather than erroring. Not fixed here.

## Files changed

None under `supabase/migrations/`. Only this notes document was added.

## Environment

- `supabase` CLI at `/opt/homebrew/bin/supabase`; `psql` at `/opt/homebrew/opt/postgresql@17/bin/psql`.
- All probe data was inserted inside `begin; ... rollback;` — the local database is left with schema only, no rows.
