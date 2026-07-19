# Spec B — Edge Semantics + Latency Capture

**Date:** 2026-07-19
**Status:** Draft (awaiting review)
**Slice:** B of 3 (A = observability core, shipped; C = eval workflows, not started)
**Predecessor:** `docs/superpowers/specs/2026-07-19-agent-observability-core-design.md`

## 1. Problem

Spec A delivered both observability lenses but had to defer two things because the telemetry couldn't support them:

1. **Per-agent latency** — the Agents page and drill-down show cost/tokens but no latency, because `subagent_stop` carries `agent_type` with no duration, and the Agent `tool_end` carries `duration_ms` with no way to attribute it to an agent.
2. **Edge semantics** — the spawn graph shows *that* one agent spawned another, but not *why*. Every edge is an anonymous spawn; a delegation looks identical to a verification.

Both are capture-side gaps. This spec closes them.

## 2. Key finding that shapes the design

Spec A §4.3 asserted there was "no shared key to attribute how-long to which-agent." **That was slightly overstated.** Verified against the hook code and live event data:

- `agent_id` is minted in `pre_tool_use.py` for every `Agent` spawn, written to the `tool_start` event, AND stored on the pending stack.
- `subagent_stop.py` already `peek`s that pending entry and stamps the **same `agent_id`** onto the `subagent_stop` event.
- The only gap: `post_tool_use.py` pops the pending entry but copies only `correlation_id`/`started_at` — it **never copies `agent_id`** onto `tool_end`.

So the latency enabler is **not** "stamp `agent_type` onto tool_end" (as Spec A guessed). It is: **copy the already-existing `agent_id` onto `tool_end`**, then join read-side:

```
tool_result(duration_ms, agent_id)  ⋈ agent_id ⋈  subagent_stop(agent_type, agent_id)
```

This is strictly better than the Spec A plan: fewer moving parts, and — critically — **no dependence on hook firing order**. (An alternative design, having `subagent_stop` mutate the live pending entry, would depend on it firing before `tool_end`; empirically it does by ~30–40ms, but that ordering is not contractual and the installed plugin cache was observed to predate the current tree.)

**Also verified:** `subagent_type` is **NOT** available in the Agent `tool_input` at PreToolUse — across 435 observed Agent `tool_start` events, zero contained it (the payload is `{description, prompt}`). Any design reading `tool_input["subagent_type"]` would silently never fire. This spec does not read it.

## 3. Scope

**In scope**

*Capture (plugin):*
- Copy `agent_id` onto the Agent `tool_end` event (latency enabler).
- Parse an optional **edge label** from the raw Agent `tool_input["prompt"]`, emit it as `edge_label` on `tool_start`, and carry it to `tool_end` via the pending stack. Strip the marker from `input_preview`.
- Bump plugin version `1.1.0` → `1.2.0`.

*Read-side:*
- Per-agent latency (p50/p99) via the `agent_id` join; surfaced in `get_top_agents` and `get_agent_timeseries`.
- Edge label exposed per node on `get_session_tree`.

*UI:*
- Latency column on the Agents page; latency tile + trend on the drill-down (the fields Spec A deferred).
- Labeled edges in the spawn graph.
- **Version-gate hint** (chosen rollout): when Agent `tool_result` events in range lack `agent_id`, show a dismissible "update the Trenchcoat plugin to v1.2.0 to enable per-agent latency" notice on the Agents page.

*Docs:* correct the materially-wrong plugin-SDK docs and document the new fields + marker convention.

**Out of scope**
- Eval tagging, variant comparison, external scores, versioned agent identity → **Spec C**.
- Any change to the ingest API schema or DB event columns (not needed — see §5).
- Retroactive backfill: events captured by plugin < 1.2.0 have no `agent_id`/`edge_label` and will never gain latency/labels. Accepted.

## 4. Design

### 4.1 Capture: `agent_id` on `tool_end`

`push_pending` already persists `agent_id` on the entry (`telemetry.py`), and `post_tool_use.py` already pops that entry. Add the copy:

```python
if pending:
    correlation_id = pending.get("correlation_id")
    started_ns     = pending.get("started_at")
    agent_id       = pending.get("agent_id")     # new
    ...
if agent_id:
    event_data["agent_id"] = agent_id            # new
```

Purely additive; non-Agent tools have no `agent_id` on the entry and are unaffected.

### 4.2 Capture: edge labels

**Marker convention (chosen):** the spawning agent embeds a marker anywhere in the Task prompt:

```
[tc:delegate]   [tc:verify]   [tc:critique]
```

Exactly these three values are recognized (lowercase, case-insensitive match). Anything else — including a malformed or unknown marker — is **ignored** and `edge_label` is omitted, never guessed.

`pre_tool_use.py`, for `tool_name == "Agent"` only:
1. Read raw `tool_input.get("prompt")` **before** sanitization (the raw dict is already in hand; only `input_preview` is sanitized).
2. Match the first `[tc:<word>]` occurrence; if `<word>` is one of the three, set `tool_data["edge_label"]`.
3. Strip the matched marker from the prompt text used to build `input_preview`, so the marker doesn't consume the 100-char privacy preview or leak into it.
4. Pass `edge_label` into `push_pending` so `tool_end` carries it too (same mechanism as `agent_id`).

**Why the prompt and not `subagent_type`:** `subagent_type` is provably absent at PreToolUse (§2). The prompt is the only per-call channel actually available, and it labels the *call*, not the agent — which is the point (the same agent can be a delegate in one call and a critique in another).

**Privacy:** `edge_label` is a bounded enum, never free text — no prompt content is captured by this feature.

### 4.3 Read-side: per-agent latency

Latency per agent = the wall-clock `duration_ms` of the Agent tool call that spawned it, attributed via `agent_id`.

Source: `events` where `event_type = 'tool_result'` and `tool_name = 'Agent'` (note: `tool_name` and `duration_ms` are **promoted top-level columns**, so no JSONB extraction for those), joined to `events` where `event_type = 'subagent_stop'` on `data->>'agent_id'`, grouped by the subagent_stop's `agent_type` (normalized with the established `coalesce(nullif(trim(...)), '')` idiom).

Percentiles via `percentile_cont(0.5|0.99) within group (order by duration_ms)`.

Both `get_top_agents` and `get_agent_timeseries` **return `json`**, so adding fields to the emitted objects requires **no `drop function`** (unlike `get_session_tree`'s `TABLE(...)`). They gain `p50_latency_ms`, `p99_latency_ms`, and `latency_sample_count` (the count is what drives the version-gate hint and guards against reporting a percentile from 1–2 samples).

Agents with zero matched samples return nulls → UI renders `--`, never 0.

### 4.4 Read-side: edge labels on the graph

**Corrected during implementation.** The original design here assumed a child session records `spawner_id = <agent_id>` with `spawner_type = 'agent'`. Verification disproved both halves: `session_start.py` forwards only `parent_session_id` and the *parent's skill* `spawner_id`, and nothing in the plugin ever writes `spawner_type = 'agent'` (the DB CHECK and TS union permit the value; no writer produces it). A join keyed on `sessions.spawner_id` would therefore never match — the feature would have shipped inert.

The shipped mechanism instead threads the real key: `session_start.py` now records the spawn context's **`agent_id`** onto the `session_start` event, and `get_session_tree` resolves a node's inbound label by finding that node's own `session_start` event, reading its `agent_id`, and joining to the `edge_label` on the Agent tool event carrying the same `agent_id`.

`get_session_tree` gains an `edge_label text` column. Because it returns `TABLE(...)`, this **requires `drop function if exists` first** (precedent: migration 023).

### 4.5 UI

- **Agents page:** new Latency (p50 / p99) column, rendering `--` when `latency_sample_count` is 0.
- **Drill-down:** latency tile + a latency-over-time chart alongside the existing cost/invocation charts.
- **Spawn graph:** render `edge_label` on the edge (a small label on the connector); unlabeled edges stay visually plain. Labels use distinguishable, theme-aware styling.
- **Version-gate notice:** if the range contains Agent `tool_result` rows where `agent_id` is null, render a dismissible hint on the Agents page pointing at the plugin upgrade. Shown once per user (persisted client-side); never blocks content.

### 4.6 Docs (correcting existing errors)

The plugin-SDK docs are already materially wrong and must be corrected as part of this change, not just appended to:
- `apps/docs/content/docs/plugin-sdk/event-schema.mdx` — `tool_use` claims `tool_input_preview` "trimmed to 500 characters" (real: `input_preview`, default **100**); `tool_result` omits `correlation_id`/`result_size`; `subagent_stop` claims `{subagent_id, model, tokens_used}` (real: `agent_type`, `reason`, `tool_counts`, `tool_count_total`, `turns`, `input_tokens`, `output_tokens`, `model`, optional `agent_id`).
- `apps/docs/content/docs/plugin-sdk/hook-reference.mdx` — lists a **nonexistent `Notification` hook**, folds subagent into `stop.py` (there is a dedicated `subagent_stop.py`), repeats the 500-char error, and claims hook input arrives "as environment variables" (it is **stdin JSON**).
- `apps/docs/content/docs/api-reference/events.mdx` — uses `tool_input_preview`.

Then document the new `agent_id`/`edge_label` fields and the `[tc:*]` marker convention.

## 5. Why no ingest/DB migration for capture

Verified: the ingest Zod schema types `data` as `z.record(z.string(), z.unknown())`, and `events.service.ts` promotes only `tool_name` and `duration_ms` to columns — everything else is stored as-is in the `data` jsonb. New keys inside `data` therefore flow end-to-end with **zero** ingest or table changes. The docs' own "Schema stability" section already grants this forward-compatibility. Migrations in this spec are read-side (RPC) only.

## 6. Testing

The plugin has a real pytest suite (`claude-plugin/tests/test_telemetry.py`, run via `uv run --with pytest pytest tests/` from `claude-plugin/`) with two ready seams:
- **Unit:** `TestPendingStack` / `TestPeekPendingByTool` — the pattern for new pending-entry fields (`agent_id` optionality is already tested there).
- **Integration:** `TestHookIntegration._run_hook` executes each hook as a real subprocess against a temp `HOME` and asserts on the written JSONL — the template for an end-to-end Agent-spawn test.

Required coverage:
- `agent_id` lands on `tool_end` for Agent; absent for non-Agent tools.
- Each of the three markers parsed; unknown/malformed marker → no `edge_label`; marker stripped from `input_preview`; prompt with no marker unchanged.
- End-to-end: `pre_tool_use` → `subagent_stop` → `post_tool_use` produces a `tool_end` whose `agent_id` matches the `subagent_stop`'s.
- Read-side: service-layer shape tests for the new latency/label fields (existing `bun test` + `createMockSupabase` pattern); manual SQL smoke for the new RPCs.

## 7. Error handling & edge cases

- **Old plugin (no `agent_id`):** latency fields null, UI shows `--` plus the upgrade hint. Never an error.
- **Orphaned `tool_result`** (agent_id with no matching `subagent_stop`, e.g. crashed subagent): excluded from latency aggregation rather than attributed to `unknown`.
- **Duplicate `agent_id`** (theoretically possible across sessions): the join is scoped by `user_id` and `session_id` to prevent cross-session bleed.
- **Marker in a prompt that is not an Agent spawn:** ignored — parsing runs only for `tool_name == "Agent"`.
- **Percentiles from tiny samples:** `latency_sample_count` is returned so the UI can suppress or annotate percentiles below a small threshold.
- **Parallel Agent spawns in one session:** `pop_pending`/`peek_pending_by_tool` in `claude-plugin/lib/telemetry.py` match pending entries on `tool_name` only (LIFO, no `agent_id` disambiguation), and `write_agent_spawn_context` writes a single global file per parent session rather than one per spawned agent. With N parallel spawns, `agent_id` correlation is ambiguous: per-agent latency may be mis-attributed between concurrently-running agents, and an edge label may attach to the wrong sibling edge. Serial spawns (one subagent at a time) are unaffected.

## 8. Open questions for planning

1. Confirm the `[tc:*]` marker regex handles markers mid-prompt and multiple occurrences (first match wins) without catastrophic backtracking.
2. Decide whether the drill-down latency chart reuses `AgentTrendChart` (add a `dataKey`) or needs a variant — and fix that component's missing dark-mode theming (a Spec A carry-forward Minor) while touching it.
3. Confirm `percentile_cont` performance on `events` for a 90-day range; add a covering index only if planning shows a regression.

## 9. Follow-on

- **Spec C — Eval workflows:** run tagging (eval id + variant), variant comparison, external accuracy-score ingest, stable versioned agent identity.
- Carry-forward from Spec A, still open: wire or remove the unconsumed `get_entity_rollup.estimated_cost_usd`; the drill-down's spec'd-but-unbuilt tool-fingerprint and recent-invocations sections.
- **Per-`agent_id`-keyed pending/spawn-context redesign:** replace the `tool_name`-only LIFO pending stack and the single global agent-spawn-context file with structures keyed by `agent_id`, so parallel (concurrent) Agent spawns within one session get correct latency attribution and edge labels instead of only serial spawns being safe. Own slice — touches `pop_pending`, `peek_pending_by_tool`, and `write_agent_spawn_context` in `claude-plugin/lib/telemetry.py`.
