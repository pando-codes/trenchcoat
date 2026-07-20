# Spec F — Cache-Aware Session Cost & Agent Table Surfacing

**Date:** 2026-07-20
**Status:** Draft (awaiting review)
**Predecessors:** D1 (agent-native capture), D2 (agent-native lineage), E (cache-aware agent cost) — all shipped

## 1. Problem

Spec E made agent cost cache-aware. It also, unavoidably, made the product internally inconsistent: the same agent now costs one number in the spawn graph and a smaller number in the session card directly above it.

Three distinct gaps, all verified against the code:

1. **Two contradictory cost bases.** `get_agent_tree` (031) prices input, output, cache-creation and cache-read. `lib/cost.ts:13` prices input and output only, and `sessions/page.tsx:96` / `sessions/[id]/page.tsx:107` fetch only `input_cost_per_1m, output_cost_per_1m`. Spec E §1 measured cache at ~99% of all tokens in live data, so the session-level numbers are not slightly low — they are wrong by orders of magnitude.

2. **Session-level cache tokens do not exist anywhere in the pipeline.** `sessions` has only `input_tokens` / `output_tokens` (`012_cost_schema.sql:7-8`). `parse_agent_transcript` (`claude-plugin/lib/telemetry.py:600-602`) reads `msg["usage"]` but pulls only `input_tokens` and `output_tokens`, discarding `cache_creation_input_tokens` and `cache_read_input_tokens` from the same dict. Agents have cache tokens via `agent_result` → `agents.result_*`; the main thread — usually the largest share of a session's spend — has none. **This gap cannot be closed in the frontend.**

3. **Cache is invisible, and the `agents` table is barely read.** `cache_creation_tokens` / `cache_read_tokens` are returned by `get_agent_tree`, typed at `types/analytics.ts:124-125`, and dropped by `buildAgentGraph` (`lib/graph/spawn-graph.ts:116-129`) — Spec E has no pixel. Meanwhile `sessions/[id]/page.tsx:222-275` still reconstructs its Agents card from raw `subagent_stop` events, so `agents.status`, `agents.model` and `agents.tool_count` are written by `events.service.ts:203-222` and never read by anything.

## 2. Scope

**In scope**
- Plugin captures cache tokens on `assistant_stop`. Plugin `1.3.2` → `1.3.3`.
- `sessions` gains `cache_creation_tokens` and `cache_read_tokens`; `events.service.ts` promotes them.
- A single SQL pricing function, `price_tokens`, becomes the sole authority. `get_agent_tree` is repointed at it.
- New `get_session_cost` RPC. `get_agent_tree` gains `status`, `model`, `tool_count`.
- `lib/cost.ts` loses its cost math; sessions list and session detail read cost from the RPC.
- Session detail gains a Cache card; its Agents card is rebuilt on `get_agent_tree`.

**Out of scope (explicitly)**
- `get_daily_cost`, `get_cost_by_model`, `get_top_agents`, `get_agent_timeseries`, `get_eval_comparison` remain cache-blind. This is the same debt Spec E §7 recorded, and it now becomes **visible**: a session's cost on `/sessions` will exceed its contribution to the `/cost` daily total. Mitigated by labelling, closed by a follow-on spec. See §7.
- Backfill. Sessions predating plugin 1.3.3 keep null cache columns and render as "not captured".
- `subagent_stop` emitting cache tokens. The parser change makes it nearly free, but nothing would consume it — `agents.result_*` already covers agents.
- Gaps 4 and 5 from the frontend audit (eval drill-down; `get_session_tree` / `get_entity_rollup` UI). Separate specs.

## 3. Design

### 3.0 Step zero — validate the migration stack

Every 2026-07 spec (A, B, C, D1, D2, E) records that migrations 022–031 have **never been executed against a real Postgres**. This spec adds 032 and 033 on top of ten unvalidated migrations and builds UI against RPCs whose compilation is unverified.

Before any work below: apply 022–031 to a real Postgres (local Supabase or a scratch project) and fix what does not compile. Two known suspects to check while there:

- `get_session_tree`'s `edge_label` lateral (`025:53-66`) joins on `session_start.data->>'agent_id'`, a field D1 deleted. The join is dead. It is not on this spec's path — `getSessionTree` has no call sites — so record the finding, do not fix it here.
- `get_top_agents`' latency join (`024:74-84`) depends on `tool_result` rows carrying `agent_id`, which D1 changed.

### 3.1 Capture — plugin 1.3.2 → 1.3.3

`parse_agent_transcript` (`telemetry.py:569-617`) already iterates assistant entries and reads `msg.get("usage", {})`. Accumulate two more counters from the same object and add them to the returned dict:

```
cache_creation_tokens += usage.get("cache_creation_input_tokens") or 0
cache_read_tokens     += usage.get("cache_read_input_tokens")     or 0
```

`stop.py:25-30` writes both onto the `assistant_stop` payload beside `input_tokens` / `output_tokens`.

No ingest change. `POST /api/v1/events` validates `data` as `z.record(z.string(), z.unknown())`, so new keys flow through untouched — the same property Spec B §5 relied on.

### 3.2 Storage — migration 032

```sql
alter table public.sessions
  add column if not exists cache_creation_tokens bigint,
  add column if not exists cache_read_tokens     bigint;
```

**Nullable, not defaulted to zero.** This is load-bearing: `null` means "captured by a plugin older than 1.3.3", `0` means "captured, genuinely no cache". The UI renders those differently — `--` versus `$0.00` — and a default of `0` would permanently erase the distinction for every historic row.

`events.service.ts:124-146` promotes both keys inside the existing `assistant_stop` loop, using the same `!== null` guard as `input_tokens`, so a partial payload cannot clobber a populated column.

### 3.3 Pricing authority — migration 033

The cost ladder currently inlined at `031:71-81` is extracted verbatim into one function:

```sql
create or replace function public.price_tokens(
  p_model           text,
  p_input           bigint,
  p_output          bigint,
  p_cache_creation  bigint,
  p_cache_read      bigint
) returns numeric language sql stable
```

It joins `model_pricing` on `p_model` and applies the Spec E fallback — cache-creation at `input_cost_per_1m * 1.25`, cache-read at `input_cost_per_1m * 0.10` — when synced cache rates are null.

`get_agent_tree` is dropped and recreated to call `price_tokens` instead of doing the arithmetic itself. `get_session_cost` calls the same function. **The 1.25×/0.10× multipliers then exist exactly once in the codebase**, which is the entire reason for the function; without it, choosing "SQL is the sole authority" would only have moved the duplication from TypeScript-versus-SQL to SQL-versus-SQL.

**Deliberate behavior change — unknown models return null, not zero.** `031:71` wraps every rate in `coalesce(..., 0)`, so a model absent from `model_pricing` prices at exactly $0.00 and the spawn graph renders it as free. `lib/cost.ts:11` returns `null` for the same case and the sessions list shows `--`. `price_tokens` returns **null** when no `model_pricing` row matches, and the spawn graph will show `--` for such nodes where it previously showed `$0.00`.

This is a regression in apparent completeness and an improvement in honesty. A confident `$0.00` for "we have no rate for this model" is the failure mode someone builds a budget on; Spec E §1 exists precisely because `$0.000000` was read as a rendering bug rather than a data gap.

### 3.4 Read RPCs — migration 033

**`get_session_cost(p_user_id uuid, p_session_ids text[])`**

```
returns table (
  session_id            text,
  input_tokens          bigint,
  output_tokens         bigint,
  cache_creation_tokens bigint,
  cache_read_tokens     bigint,
  cost_usd              numeric
)
```

Array-keyed so the sessions list resolves a full page in one round trip rather than N. `cost_usd` is `price_tokens(model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens)` and is null when the model is unpriced. Cache columns pass through as-is, preserving the null-versus-zero distinction from §3.2.

**`get_agent_tree` gains three columns:** `status text`, `model text`, `tool_count integer`, read straight from `agents`. All three are already written by `events.service.ts` and read by nothing. No change to the recursive CTE, the `eff` fallback ladder, or the ordering.

### 3.5 Frontend

**Cost math leaves the client.** `computeCost` and `RateMap` are deleted from `lib/cost.ts`; `formatCost` stays. The `model_pricing` selects at `sessions/page.tsx:96` and `sessions/[id]/page.tsx:107` are removed — the pages stop fetching rate tables entirely. `getSessionCosts(client, userId, sessionIds)` joins `analytics.service.ts` beside the existing `getAgentTree`, returning `ServiceResult`.

**`/sessions`** — the cost column reads from the RPC, `--` when `cost_usd` is null.

**`/sessions/[id]`** — the cost stat card reads from the RPC. A new **Cache** card sits beside it showing cache-read tokens, cache-creation tokens, and a cache-hit ratio of `cache_read / (cache_read + input)`. When the columns are null it reads "Not captured" with a one-line plugin-upgrade hint, matching the existing v1.2.0 latency banner at `agents/page.tsx:70-75`.

**The Agents card is rebuilt on `get_agent_tree`.** The page already fetches that data at `sessions/[id]/page.tsx:126` for the spawn graph. The card becomes a table over those rows — agent type, status badge, model, duration, tokens in/out, cache read/creation, cost, edge-label badge — ordered by the RPC's `depth, started_at`. The `subagent_stop` reconstruction at `:222-275` and its `computeCost` call are both deleted.

**Structure.** `sessions/[id]/page.tsx` is already long and this block is its densest section, so the card moves to `components/sessions/agents-table.tsx`. Ratio and row-mapping logic goes to `lib/analytics/session-cache.ts` as pure functions, matching `lib/analytics/agent-timeseries.ts` and `eval-comparison.ts`.

**Spawn graph** — no structural change; it already renders cost and `edge_label`. Node tooltips gain the cache breakdown, since the data arrives in the same fetch.

## 4. Data flow

```
transcript usage{}
  → parse_agent_transcript                    (plugin 1.3.3)
  → assistant_stop.data.cache_*_tokens        (stop.py)
  → POST /api/v1/events                       (unchanged, z.record)
  → sessions.cache_creation_tokens/cache_read_tokens   (events.service.ts)
  → price_tokens()                            (033, sole authority)
  → get_session_cost / get_agent_tree
  → getSessionCosts / getAgentTree            (analytics.service.ts)
  → sessions list · session detail · Cache card · Agents table · spawn graph
```

## 5. Error handling

- RPC failure returns a `ServiceResult` error; pages fall through to their existing empty states rather than throwing.
- Null `cost_usd` renders `--`, never `$0.00`. This holds in the sessions list, the session detail card, the Agents table, and the spawn graph.
- Null cache columns render "Not captured", never `0`.
- The Agents table renders whatever `get_agent_tree` returns; an agent whose `agent_result` never arrived still has a row, with null-safe cells, because `031`'s `eff` CTE already coalesces its token fallbacks.

## 6. Testing

**SQL** — `price_tokens` covers three cases: a model with synced cache rates (uses them), a model with null cache rates (falls back to 1.25×/0.10×), and a model absent from `model_pricing` (returns null, not zero). A fourth asserts `get_agent_tree` produces identical costs before and after the repoint for a priced model, so the extraction is provably behavior-preserving except for the intended null change.

**Frontend** — pure helpers in `lib/analytics/session-cache.ts` are tested in isolation: cache-hit ratio math, division-by-zero when both terms are zero, null propagation through the ratio, and agent row mapping. Consistent with how the existing `lib/analytics` helpers are tested.

**Manual** — one session captured with plugin 1.3.3 and one predating it, confirming the null-versus-zero rendering split is visible on both the Cache card and the cost columns.

## 7. Known inconsistency this ships with

`/cost` and `/agents` continue to price input and output only. Because session cost becomes cache-aware and theirs does not, a session's cost on `/sessions` will visibly exceed its contribution to the `/cost` daily total — the discrepancy moves from hidden to obvious.

Both surfaces are labelled "excl. cache" so it reads as a known limitation rather than a bug. The proper fix is repointing `get_daily_cost`, `get_cost_by_model`, `get_top_agents`, `get_agent_timeseries` and `get_eval_comparison` at `price_tokens` — five RPC rewrites, each needing its own cache-token source verified, since `get_top_agents` aggregates `subagent_stop` events rather than the `agents` table.

That is deliberately a follow-on spec rather than part of this one. Those rewrites should be validated against real cache-token traffic, and there is none until this spec ships and plugin 1.3.3 has run. Sequencing them after also keeps each spec to one reviewable unit.
