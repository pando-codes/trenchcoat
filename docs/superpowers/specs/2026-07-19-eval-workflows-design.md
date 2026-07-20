# Spec C — Eval Workflows

**Date:** 2026-07-19
**Status:** Draft (awaiting review)
**Slice:** C of 3 (A = observability core, shipped; B = edge semantics + latency, shipped)
**Predecessors:** `2026-07-19-agent-observability-core-design.md`, `2026-07-19-edge-semantics-latency-design.md`

## 1. Problem

Specs A and B made a single agent's cost, tokens, and latency observable, and made the system's spawn graph legible. But the AI Engineer's actual loop is *comparative*: "I changed the architecture — is v3 better than v2, and what did the improvement cost?"

Today nothing ties a set of runs together into an experiment. Sessions are individually observable but mutually anonymous, and Trenchcoat holds no notion of an outcome — it knows what a run *cost*, never whether it *worked*. So the engineer can see that v3 costs 2× v2, but cannot see that it is 20% more accurate, and has no way to put those two facts side by side.

## 2. Scope

**In scope**

*Capture:* `session_start.py` reads `TRENCHCOAT_EVAL_ID` and `TRENCHCOAT_EVAL_VARIANT` from the environment and stamps them on the `session_start` event. (Chosen mechanism: env vars, matching the existing `TRENCHCOAT_API_KEY` pattern — zero new tooling, works with any harness that can set env.)

*Storage:* `sessions` gains `eval_id` / `eval_variant`, promoted from `session_start` by the existing enrichment path in `events.service.ts`.

*Outcome scores:* a new `eval_scores` table plus an authenticated `POST /api/v1/evals/scores` endpoint so an external harness can attach a named numeric metric (accuracy, pass rate, whatever) to a session.

*Read-side:* a `get_eval_comparison(user, eval_id)` RPC returning per-variant aggregates — sessions, cost, tokens, duration, and average score per metric.

*UI:* an `/evals` list and an `/evals/[id]` variant-comparison view putting cost against outcome.

**Out of scope**
- **Versioned agent identity — deferred entirely** (explicit decision). Agent identity remains the `agent_type` string, exactly as in A and B. Trending one agent across versions becomes its own spec if wanted.
- Any change to the ingest event schema (not needed — see §5).
- Retroactive tagging of past sessions; and retroactive scoring is only possible for sessions that still exist.
- Statistical significance testing on score differences. The UI reports observed values and sample counts; it does not claim significance.

## 3. Design

### 3.1 Capture: eval tags

`session_start.py` already builds an `event_data` dict and reads a spawn context. Add, purely additively:

```python
eval_id      = os.environ.get("TRENCHCOAT_EVAL_ID")
eval_variant = os.environ.get("TRENCHCOAT_EVAL_VARIANT")
if eval_id:
    event_data["eval_id"] = eval_id
if eval_variant:
    event_data["eval_variant"] = eval_variant
```

Untagged runs are unaffected — no keys, no behavior change. Values are treated as opaque identifiers and length-capped (128 chars) to bound abuse.

### 3.2 Storage

`sessions` gains `eval_id text` and `eval_variant text`, plus an index on `(user_id, eval_id)` for the comparison query.

Promotion reuses the existing `session_start` enrichment block in `apps/app/src/lib/services/events.service.ts` (the one already writing `parent_session_id`/`spawner_id`/`spawner_type`) — extended, not duplicated.

### 3.3 Outcome scores

New table:

```
eval_scores(
  id uuid pk, user_id uuid, session_id text,
  metric text, value numeric, created_at timestamptz,
  unique (user_id, session_id, metric)
)
```

RLS mirrors `events`/`sessions`: users select only their own rows; writes go through the service-role admin client.

`POST /api/v1/evals/scores` accepts a batch:
```json
{ "scores": [ { "session_id": "...", "metric": "accuracy", "value": 0.82 } ] }
```
Built with the existing `createApiHandler` (Zod `bodySchema`, `X-API-Key` auth, rate limiting) and the **existing `write:events` scope** — deliberately reusing it so no API-key re-issuance is required. Upsert on the unique key so re-posting a corrected score replaces it rather than erroring. Batch cap 1000, mirroring the events endpoint.

Scores reference a `session_id` that may not exist (harness error, or session not yet ingested). Unknown session ids are **accepted and stored** — the comparison query inner-joins to sessions, so orphans are simply invisible until/unless that session arrives. This avoids ordering constraints between the harness and the plugin flush.

### 3.4 Read-side: variant comparison

`get_eval_comparison(p_user_id uuid, p_eval_id text) returns json` — one object per variant:

- `eval_variant`, `session_count`
- `total_cost_usd`, `total_input_tokens`, `total_output_tokens` (cost via the established `tokens × model_pricing / 1e6` join)
- `avg_duration_ms`
- `scores`: a JSONB map of `metric → { avg, count }`

Returns `json`, so future field additions need no `drop function`.

A companion `get_eval_list(p_user_id, p_from, p_to) returns json` powers the index page: `eval_id`, variant count, session count, last-run timestamp.

### 3.5 UI

- **`/evals`** — table of eval IDs (variants, sessions, last run), each linking to its comparison.
- **`/evals/[id]`** — variants side by side: cost, tokens, avg duration, session count, and a column per score metric. The engineer's core question is "what did the improvement cost," so the view puts **cost and outcome adjacent** and shows the delta between variants where exactly two exist.
- Sample counts are always shown next to averages; a variant with 1–2 sessions is annotated as low-sample rather than silently presented as comparable.
- No data → empty state explaining how to tag a run (the two env vars), not a blank table.

## 4. Testing

- **Plugin (pytest):** env vars present → `session_start` carries both fields; absent → neither key exists; over-length values truncated. Hook-integration test via the existing `_run_hook` harness.
- **Ingest (bun):** `events.service` promotes `eval_id`/`eval_variant` onto the session row; sessions without them are untouched.
- **API (bun):** scores endpoint validates payload, upserts on conflict, rejects unauthenticated/unscoped calls, honors the batch cap.
- **Service (bun):** `getEvalComparison`/`getEvalList` shape + `RPC_FAILED` paths via `createMockSupabase`.
- **UI:** no component harness — `bunx tsc --noEmit` plus manual run (consistent with A and B).
- **DB:** no pgTAP harness; RPCs verified by service shape tests + manual SQL smoke (deferred, see §6).

## 5. Why no ingest-schema change

Verified across A and B: the ingest Zod schema types `data` as `z.record(z.string(), z.unknown())`, and `events.service.ts` promotes only chosen keys. New `session_start` data keys flow through untouched. Only the `sessions` columns and the new `eval_scores` table require migrations.

## 6. Known limitations (stated, not hidden)

- **Parallel-spawn ambiguity (inherited from Spec B):** per-agent latency and edge labels can mis-attribute across concurrently-running agents. Eval-level aggregates (cost, tokens, duration, scores) are computed per *session* and are unaffected; only per-agent breakdowns inside a run carry that caveat.
- **No significance testing.** A variant looking better may be noise. The UI shows sample counts precisely so the engineer can judge; it never asserts a winner.
- **Verification debt carried from A and B:** migrations 022–025 have never been executed against a real Postgres, and no UI from A or B has been verified in a browser. This spec adds further migrations to that unverified stack. **Running the accumulated SQL smoke against a real database is the highest-value action before relying on any of this.**

## 7. Open questions for planning

1. Confirm `sessions` rows always exist by the time the promotion block runs (the block updates by `session_id`; a `session_start` for a not-yet-inserted session would no-op). Check how the existing `parent_session_id` promotion handles this and mirror it.
2. Decide whether `/evals/[id]` renders a delta column only for the exactly-two-variant case or generalizes to "vs. baseline variant."
3. Confirm the `write:events` scope reuse is acceptable, or whether a distinct `write:evals` scope is wanted despite the key-reissuance cost.

## 8. Follow-on (not this spec)

- Versioned agent identity (deferred from this spec).
- Per-`agent_id`-keyed pending/context redesign to remove the parallel-spawn ambiguity (from Spec B).
- Wire or remove the unconsumed `get_entity_rollup.estimated_cost_usd` (from Spec A).
- The drill-down's spec'd-but-unbuilt tool-fingerprint and recent-invocations sections (from Spec A).
- Index for the latency self-join if a large tenant regresses (from Spec B).
