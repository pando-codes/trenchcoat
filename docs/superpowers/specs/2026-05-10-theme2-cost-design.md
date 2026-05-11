# Theme 2 Cost Transparency Design

**Date:** 2026-05-10  
**Scope:** Theme 2 — Cost Transparency and Session Spend  
**Approach:** Tokens in plugin → denormalized to sessions table → cost computed on read from `model_pricing`

---

## Background

Token and cost data are completely absent from the current implementation. The plugin hooks fire but discard the `usage` field present on every assistant message in the transcript JSONL files. The `sessions` table already has a `model` column but it is never populated. This design fills that gap end-to-end: plugin instrumentation, schema additions, a daily pricing sync, and UI surfaces across four locations.

---

## Section 1: Plugin Changes

### `telemetry.py` — extend `parse_agent_transcript`

The function already iterates every `assistant` entry in a transcript JSONL for tool counts. Extend it to also:
- Sum `entry["message"]["usage"]["input_tokens"]` and `entry["message"]["usage"]["output_tokens"]` across all turns (skip entries where `usage` is absent)
- Capture `model` from the last assistant message (`entry["message"]["model"]`)

Return signature expands to:
```python
{
    "tool_counts": {...},
    "total_tools": int,
    "turns": int,
    "input_tokens": int,
    "output_tokens": int,
    "model": str | None,
}
```

### `subagent_stop.py`

Pass `input_tokens`, `output_tokens`, `model` from the parsed transcript through to the `write_event` call:
```python
write_event("subagent_stop", session_id, {
    "agent_type": agent_type,
    "reason": stop_reason,
    "tool_counts": tool_summary.get("tool_counts", {}),
    "tool_count_total": tool_summary.get("total_tools", 0),
    "turns": tool_summary.get("turns", 0),
    "input_tokens": tool_summary.get("input_tokens", 0),
    "output_tokens": tool_summary.get("output_tokens", 0),
    "model": tool_summary.get("model"),
})
```

### `stop.py`

The `Stop` hook receives `transcript_path` in its input — currently ignored. Parse it with `parse_agent_transcript` and write session-level token totals into the event:
```python
write_event("stop", session_id, {
    "reason": reason,
    "input_tokens": transcript.get("input_tokens", 0),
    "output_tokens": transcript.get("output_tokens", 0),
    "model": transcript.get("model"),
})
```

### Ingestion service (`events.service.ts`)

When processing a `stop` event, extend the session upsert to also write `input_tokens`, `output_tokens`, `model` alongside the existing `duration_ms` / `stop_reason` fields.

---

## Section 2: Database Schema

### Migration `012_cost_schema.sql`

**`sessions` table — two new columns:**
```sql
alter table public.sessions
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer;
```
The `model` column already exists; ingestion will now populate it. Existing rows retain `null` for token columns; the UI renders these as `--`.

**`model_pricing` table — new:**
```sql
create table if not exists public.model_pricing (
  model_id              text primary key,
  input_cost_per_1m     numeric(10, 6) not null,
  output_cost_per_1m    numeric(10, 6) not null,
  updated_at            timestamptz default now()
);
```
Seeded with current Anthropic rates for active Claude models. The pricing sync job upserts into this table daily.

**`daily_aggregates` table — two new columns:**
```sql
alter table public.daily_aggregates
  add column if not exists input_tokens bigint default 0,
  add column if not exists output_tokens bigint default 0;
```
Updated by `update_daily_aggregate()` summing token columns from sessions on the given date.

### Migration `013_cost_rpcs.sql`

**`get_daily_cost(p_user_id, p_from, p_to)`**

Sums sessions per day, joined to `model_pricing`, returning accurate per-day cost even across mixed models:
```
returns: [{ date, total_cost_usd, input_tokens, output_tokens }]
```

**`get_cost_by_model(p_user_id, p_from, p_to)`**

Groups sessions by model, joins pricing:
```
returns: [{ model, session_count, input_tokens, output_tokens, total_cost_usd }]
```

**`get_top_agents` — extended**

Add `input_tokens` and `output_tokens` aggregation from `data->>'input_tokens'` and `data->>'output_tokens'` on `subagent_stop` events. Include `avg_cost_usd` joined against `model_pricing` on `data->>'model'`.

---

## Section 3: Pricing Sync

### Data source

`https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json` — community-maintained, updated within hours of Anthropic pricing changes. Keys are model IDs (e.g. `"claude-sonnet-4-6"`); values include `input_cost_per_token` and `output_cost_per_token` as per-token floats. Multiply by 1,000,000 for per-1M rates. Filter to keys starting with `"claude-"`.

### API route: `POST /api/v1/admin/sync-pricing`

- Protected by `Authorization: Bearer <CRON_SECRET>` header check
- Uses the Supabase admin client
- Fetches the LiteLLM JSON, extracts Claude models, upserts into `model_pricing`
- Returns `{ synced: N }` on success, `{ error }` on failure
- On fetch failure: logs and returns 500 — existing `model_pricing` rows are untouched

### `vercel.json` cron entry

```json
{
  "crons": [{
    "path": "/api/v1/admin/sync-pricing",
    "schedule": "0 2 * * *"
  }]
}
```

Runs daily at 02:00 UTC. `CRON_SECRET` set as a Vercel environment variable.

---

## Section 4: UI

### Sessions list (`/sessions`)

Add a `Cost` column (rightmost). Cost computed as:
```
(input_tokens * input_cost_per_1m + output_tokens * output_cost_per_1m) / 1_000_000
```
The page fetches `model_pricing` server-side and passes a rate map to compute cost per session row. Rendered as `$0.0042` (4 decimal places for sub-cent amounts) or `$1.23` for larger values. Sessions with null tokens render `--`.

### Session detail (`/sessions/[id]`)

Add a `Cost` stat card alongside Duration / Events / Tools / Branch. Per-agent cost shown in the Agents section — each agent card gains an estimated cost derived from its `input_tokens` + `output_tokens` fields (now populated by the extended `subagent_stop` event).

### Overview page (`/`)

Add a `Daily Cost` card below the existing charts. A line chart of `cost_usd` by date using `get_daily_cost`, consistent with the `DailyActivityChart` pattern. Respects `?from=`/`?to=` params.

### Cost page (`/cost`)

New route added to the sidebar between Agents and Activity (use `DollarSign` icon from lucide-react).

Three sections:

1. **Daily Spend** — line chart of `total_cost_usd` by date. Data from `get_daily_cost`.
2. **Cost by Model** — ranked table: model | sessions | input tokens | output tokens | total cost. Data from `get_cost_by_model`.
3. **Cost by Agent** — ranked table: agent type | calls | avg cost/call | total cost. Extended from `get_top_agents`.

All sections respect the global `?from=`/`?to=` date range from the topbar.

---

## What This Does Not Include

- Per-tool-call token attribution (tokens can only be captured at the turn/session level from transcripts)
- Real-time cost tracking during a session
- Team-level cost aggregation (Theme 3)
- Budget alerts or spending limits (Theme 3)
