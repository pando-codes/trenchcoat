# Spec A — Multi-Agent Observability Core

**Date:** 2026-07-19
**Status:** Draft (awaiting review)
**Author:** Alex + Claude
**Slice:** A of 3 (B = opt-in edge semantics, C = eval workflows — both out of scope here)

## 1. Problem

An AI Engineer who builds and evaluates agents needs two lenses over Trenchcoat, and today has neither in usable form:

1. **The Agent lens (unit economics)** — "how much does *this one agent* cost, how efficient is it, and is it regressing?" Answerable per agent, over time.
2. **The System lens (the graph)** — "when these agents work as a system, where do the cost and latency actually go?" A cost-weighted view of the spawn/handoff tree for a run.

The data to answer both is **already captured** by existing hooks and already sits in Postgres. The gap is almost entirely presentation and a few missing derived fields — not new telemetry.

## 2. Current state (the delta this spec closes)

Verified against the codebase (2026-07-19):

| Capability | Status today |
|---|---|
| Per-agent cost/tokens | **Computed** by `get_top_agents` RPC (`total_input_tokens`, `total_output_tokens`, `total_cost_usd`) but **dropped** by the Agents page UI |
| Per-agent drill-down | **Missing** — no `agents/[type]` route; clicking an agent does nothing |
| Per-agent time-series (cost/tokens/latency over time) | **Missing / un-served** — `daily_aggregates` has only a scalar `agent_calls` count, no per-agent dimension |
| Per-agent latency | **Missing** — only avg turns / avg tools today |
| Spawn-tree data model | **Exists** — `sessions.parent_session_id` / `spawner_id` / `spawner_type`; RPCs `get_session_tree`, `get_entity_rollup` |
| Cost on the tree | **Missing** — `get_entity_rollup` returns tokens only (its own spec promised `estimated_cost_usd`); `get_session_tree` has no cost |
| Graph/tree visualization | **Missing** — no react-flow/d3/custom viz anywhere; `get_session_tree` and `get_entity_rollup` are **dead, unused RPCs** |
| Session-detail lineage UI | Exists but flat — one-level parent link + direct-children list + `subagent_stop` cards |

**Design consequence:** Spec A is mostly *surfacing and finishing* existing substrate, plus building the one genuinely new artifact (the graph viz). We follow the codebase's established **on-read (non-materialized)** decision for cross-entity/agent rollups — no new aggregate table.

## 3. Scope

**In scope**
- Agents page: render the cost + token columns the RPC already returns; add a latency column; make rows link to a drill-down.
- New `agents/[type]` drill-down route: per-agent time-series + tool fingerprint + cost distribution.
- One new on-read RPC for per-agent time-series (`get_agent_timeseries`).
- Extend the existing tree RPC(s) with per-node cost (revive `get_session_tree` / fix `get_entity_rollup`).
- New **System graph** view: an interactive, cost-weighted node-link rendering of a run's spawn tree, reachable from session detail.

**Out of scope (explicit)**
- Opt-in edge labeling / edge semantics → **Spec B**.
- Eval tagging, variant comparison, external accuracy scores, stable versioned agent identity → **Spec C**.
- Any capture-side / hook / plugin change. Spec A is read-side only.
- A materialized `agent_aggregates` table (deliberately on-read, per the spawner-chain spec's precedent).
- Multi-platform source dimension in the dashboard (deferred to its own spec already).

## 4. Design

### 4.1 Agent lens — Agents page + drill-down

**Agent identity.** For Spec A an "agent" is keyed by the `agent_type` string, scoped to the user (`(user_id, agent_type)`). This matches every existing agent query. A stable, version-aware agent identity is a Spec C concern and is explicitly *not* introduced here.

**Agents page (`apps/app/src/app/(dashboard)/agents/page.tsx`).** Extend the existing "Top Agents" table — no rewrite. Columns become: Agent Type · Invocations · **Avg Cost** · **Avg Tokens (in/out)** · Avg Tools/Call · Avg Turns · **p50 / p99 Latency** · Trend. Cost/token values already arrive from `get_top_agents`; latency is the one new field (see 4.3). Each row links to `/agents/<agent_type>`.

**Drill-down (`apps/app/src/app/(dashboard)/agents/[type]/page.tsx`, new).** Server component for one agent_type over the active date range:
- **Header stat tiles:** invocations, total + avg cost, avg tokens, p50/p99 latency, error/retry rate (if derivable; else omit — YAGNI).
- **Time-series** (the regression-spotting view): cost/day, tokens/day, and latency/day as small multiples, from `get_agent_timeseries`.
- **Tool fingerprint:** the agent's tool-call distribution (avg calls per tool), reusing the existing tool-breakdown shape.
- **Recent invocations:** list of sessions where this agent ran, each linking to session detail (and thus the graph).

Follow `dataviz` skill conventions for all charts (small multiples, sparklines, p50/p99).

### 4.2 System lens — cost-weighted spawn graph

**Data.** Revive the dead RPCs rather than invent new ones:
- Extend `get_session_tree(user_id, session_id)` to add per-node `input_tokens`/`output_tokens` (already present) **plus** `estimated_cost_usd` and `duration_ms` per node, via the same `model_pricing` left-join `get_top_agents` already uses. Each returned row = one node (session) with parent pointer, depth, agent/skill identity, cost, tokens, duration.
- Fix `get_entity_rollup` to return the `estimated_cost_usd` its original spec promised (used for the drill-down's rolled-up totals).

**View.** New client component rendering the tree as an interactive node-link graph:
- **Nodes** = sessions/agents in the spawn tree; **edges** = `parent_session_id` lineage (spawn/handoff).
- **Cost heat:** node fill/size encodes `estimated_cost_usd` (the "where the money goes" overlay). Provide a toggle to weight by latency instead.
- **Critical path:** highlight the longest-duration chain root→leaf.
- Node click → the agent's drill-down / session detail.
- **Library:** `@xyflow/react` (react-flow) with `dagre` for automatic top-down layout. This is the app's first graph viz — note the added dependency and bundle cost in the plan. Must be a client component; keep it lazy-loaded so it doesn't weigh the rest of the dashboard.

**Entry point.** A "View spawn graph" affordance on the session detail page (`sessions/[id]`), opening the graph for that run's root. Reuse the existing root-resolution logic already on that page.

### 4.3 Cross-cutting data decisions

- **Latency sourcing (needs verification in planning).** Primary: per-agent latency = the subagent's own session `duration_ms` (already on `sessions`). This requires associating `agent_type` (which lives only in `events.data` on `subagent_stop`) to a session row. **Verify** whether `subagent_stop.session_id` references the child (subagent) session or the parent; if it maps only to the parent, **fall back** to the `Task` tool_result `duration_ms` — the Pre/PostToolUse correlation already computes a `duration_ms` for the spawning Task call, which is a valid wall-clock proxy for the subagent. Pick one in planning; do not build both.
- **Cost.** Reuse the existing `computeCost` / `model_pricing` join pattern verbatim (`get_top_agents`, `apps/app/src/lib/cost.ts`). No new pricing logic.
- **No materialization.** `get_agent_timeseries` computes on-read from `events` (bucketed by day), mirroring `get_top_agents`. Confirm the existing `events` indexes (esp. `idx_events_spawner_id` and the `subagent_stop` access path) keep this acceptable for a ~90-day range; add a covering index only if planning shows a regression.

## 5. Components & interfaces

**New / changed RPCs (SQL migrations)**
- `get_agent_timeseries(p_user_id uuid, p_agent_type text, p_from date, p_to date, p_bucket text default 'day') → table(bucket date, invocations int, input_tokens int, output_tokens int, cost_usd numeric, p50_latency_ms int, p99_latency_ms int)` — **new**.
- `get_session_tree(...)` — **extend** return with `estimated_cost_usd`, `duration_ms` per node.
- `get_entity_rollup(...)` — **fix** to include `estimated_cost_usd`.

**Service layer (`apps/app/src/lib/services/analytics.service.ts`)**
- Add `getAgentTimeseries`, `getSessionTree`, and (surface) `getTopAgents` wrappers returning the existing `ServiceResult<T>` discriminated union. Move the currently-inline `get_top_agents` call into the service for consistency.

**Types (`apps/app/src/types/analytics.ts`)**
- `AgentTimeseriesPoint`, `SessionTreeNode` (extend existing), reuse `AgentStat`.

**Routes / components**
- `agents/page.tsx` — extended table (cost/tokens/latency columns + row links).
- `agents/[type]/page.tsx` + `loading.tsx` — **new** drill-down.
- `components/charts/` — per-agent small-multiples (reuse Recharts patterns).
- `components/graph/SpawnGraph.tsx` — **new** react-flow client component (lazy-loaded).

## 6. Data flow

```
existing hooks → events / sessions (already populated, no change)
        │
        ├─ Agents page ──▶ get_top_agents ──▶ table (now with cost/tokens/latency)
        │                     └─ row click ──▶ /agents/[type]
        │                                          └─▶ get_agent_timeseries ──▶ time-series charts
        │
        └─ Session detail ──▶ "View spawn graph" ──▶ get_session_tree (now cost/duration per node)
                                                        └─▶ SpawnGraph (react-flow, cost-heat + critical path)
```

## 7. Error handling & edge cases

- **Agent with no cost data** (pricing missing for a model): cost cells render "—", never `$0` or a crash — mirror the existing left-join-null behavior.
- **`agent_type = 'general-purpose' / 'unknown'`** (per migrations 020/021): shown as normal rows; do not special-case.
- **Deep or wide trees:** cap the graph at a sane node count (e.g. 300) with a "truncated — N nodes hidden" notice rather than freezing the layout. Never silently drop nodes.
- **Single-session run (no subagents):** graph renders a single node; the entry point still works.
- **Latency unavailable** for the chosen source: latency columns/tiles render "—" and the graph's latency-weight toggle is disabled, rather than showing zeros.
- **Unknown `agent_type` in the URL:** drill-down renders an empty-state, not a 500.

## 8. Testing

- **RPC unit tests** (SQL / pgTAP or the repo's existing DB test harness): `get_agent_timeseries` bucketing, cost math parity with `get_top_agents`, `get_session_tree` cost/duration fields, `get_entity_rollup` cost field. Seed a known event/session fixture and assert exact numbers.
- **Service tests:** `ServiceResult` success/failure shapes; null-pricing path.
- **Component tests:** Agents table renders new columns; `SpawnGraph` renders N nodes / correct edges from a fixture tree; critical-path highlight selects the right chain; truncation notice appears past the cap.
- **Manual E2E:** run a known multi-agent architecture through Claude Code, confirm the drill-down cost matches the Cost page's "Cost by Agent", and the graph's summed node cost matches the run's session cost.

## 9. Open questions to resolve in planning

1. **Latency source** — child-session `duration_ms` vs. Task tool_result `duration_ms` (see 4.3). One decision, verified against real data, before building.
2. **Graph library** — confirm `@xyflow/react` + `dagre` clears the app's CSP/bundle budget; fallback is a lightweight custom SVG dagre layout if react-flow is too heavy.
3. **On-read performance** — validate `get_agent_timeseries` over 90 days on a realistically large `events` table; decide whether a covering index is warranted.

## 10. Follow-on (not this spec)

- **Spec B — Edge semantics:** opt-in edge labeling (agents declare `delegate` / `verify` / `critique` on a spawn), parsed capture-side, enriching graph edges. Endorsed; sequenced after this core.
- **Spec C — Eval workflows:** run tagging (eval id + variant), variant comparison views, external accuracy-score ingest API, and a stable versioned agent identity to trend an agent across versions.
