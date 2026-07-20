# Spec D2 — Agent-Native Lineage

**Date:** 2026-07-20
**Status:** Draft (awaiting review)
**Slice:** D2 of 2 (D1 = agent-native capture, shipped at plugin 1.3.0)
**Supersedes:** the session-parentage model behind the spawn graph in `2026-07-19-agent-observability-core-design.md`, and the `session_start`-keyed edge-label join in `2026-07-19-edge-semantics-latency-design.md`

## 1. Problem

Spec A shipped a "system lens" — a cost-weighted spawn graph — and Spec B put semantic labels on its edges. **Neither has ever rendered a single agent.**

The cause, established in D1: the graph's nodes are *sessions*, joined by `parent_session_id`. But subagents are not sessions — they share the parent's `session_id` and never fire `SessionStart`. `parent_session_id` has **zero real occurrences across all 24 captured event files**. The graph is real code sitting on a lineage model that does not exist.

D1 fixed capture: every event now carries `tool_use_id`, the Agent `tool_result` carries the native `agentId` and `origin_agent_id`, `subagent_stop` reports its true `agent_id`, and a `SubagentStart` hook records spawns. **The identifiers required to build real lineage now exist.** This slice consumes them.

Two consequences of D1 that this slice must also settle:
- `subagent_start` is currently filtered out of the push queue (D1 added `_SAAS_ACCEPTED_EVENT_TYPES` so an unknown type couldn't 400 an entire batch). Ingest must accept it before the filter can be relaxed.
- Migration 025's edge-label join keys on `session_start.data->>'agent_id'`, a field D1 deleted. It is now definitively dead and must be re-pointed.

Verified as **already working** and requiring no change: migration 024's latency join (`subagent_stop.agent_id = tool_result.agent_id`) — D1 made both sides the native id, so per-agent latency functions for 1.3.0 data.

## 2. Scope

**Goal: make the spawn graph show agents.**

**In scope**
- Accept `subagent_start` at ingest (Zod enum) and relax the plugin's push-queue filter to match.
- New `agents` table: one row per subagent invocation, keyed on the native `agent_id`.
- Promotion from three event types into that table (§3.2).
- Lineage: `parent_agent_id` derived from `origin_agent_id` on the spawning Agent `tool_result` (§3.3).
- `get_agent_tree(user_id, session_id)` RPC returning agent nodes with recursive depth, cost, tokens, duration, and edge label.
- Generalize the spawn-graph transform so it renders agent lineage, and point the session-detail graph at it.
- Retire the session-tree graph path from the UI.

**Out of scope**
- Removing `get_session_tree` from the database (harmless; a later cleanup).
- Re-pointing migration 024 (already correct).
- Enriching the Agents page / drill-down with the new per-agent metrics (`totalTokens`, `toolStats`, `resolvedModel` are now captured but this slice only feeds the graph).
- The `stop.py` phantom `stop_hook_reason` key and the `sessions.stop_reason` rename it implies — that is a coordinated capture+read change deserving its own slice.
- Backfill. Agents are only recorded for sessions captured by plugin ≥ 1.3.0.

## 3. Design

### 3.1 Ingest

Add `subagent_start` to the ingest Zod enum, then add it to `_SAAS_ACCEPTED_EVENT_TYPES` in the plugin. **Order matters operationally** — a plugin that pushes an event the deployed API rejects will 400 whole batches (the failure D1 guarded against). The plan sequences the API change first.

### 3.2 Storage

```
agents(
  id uuid pk,
  user_id uuid not null,
  agent_id text not null,          -- Claude Code's native id
  session_id text not null,        -- the PARENT session (subagents share it)
  parent_agent_id text,            -- null = spawned from the main thread
  agent_type text,
  edge_label text,                 -- delegate | verify | critique
  status text,
  model text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms bigint,
  input_tokens bigint,
  output_tokens bigint,
  tool_count integer,
  unique (user_id, agent_id)
)
```

RLS mirrors `events`/`eval_scores`: users select their own; the service role writes.

Promotion runs in `events.service.ts` alongside the existing per-event-type loops, and is **upsert-by-`(user_id, agent_id)`** so the three contributing events can arrive in any order and in any batch:

| Event | Contributes |
|---|---|
| `subagent_start` | `agent_id`, `agent_type`, `session_id`, `started_at` |
| `subagent_stop` | `ended_at`, `input_tokens`, `output_tokens`, `model`, `tool_count` |
| `tool_result` (tool_name `Agent`) | `parent_agent_id`, `edge_label`, `duration_ms`, `status`, and `agent_result` metrics as a fallback token source |

Every column except the key is nullable — a crashed or in-flight agent yields a partial row rather than none. Later events must not null out fields set by earlier ones (§7).

### 3.3 Lineage — the key insight

On the Agent `tool_result` that spawned agent **Y**:
- `agent_result.agentId` (or `agent_id`) = **Y**, the spawned agent.
- `origin_agent_id` = the agent that *made the call* = **Y's parent**, or absent when the call came from the main thread.

So `parent_agent_id := origin_agent_id` on that event, and its absence means Y is a root. This is a direct, deterministic edge — no ordering assumption, no file-based state, no session involvement.

`spawn_depth` is **not stored**. It is computed at read time by the RPC's recursive CTE, which is self-healing: a parent arriving after its child still yields correct depth on the next query.

### 3.4 Read-side

`get_agent_tree(p_user_id uuid, p_session_id text) returns table(...)` — a recursive CTE over `agents` rooted at every agent in the session with `parent_agent_id is null`, returning per node:

`agent_id, parent_agent_id, agent_type, edge_label, depth, started_at, ended_at, duration_ms, input_tokens, output_tokens, estimated_cost_usd`

Cost uses the established `tokens × model_pricing / 1_000_000` join with **per-term coalesce** (the null-zeroing bug fixed in Spec A migration 023 — do not regress it).

Because it returns `TABLE(...)`, any later column addition needs `drop function if exists` first.

### 3.5 Graph

The existing `buildSpawnGraph` transform is well-tested (6 cases: node/edge construction, cost-heat normalization, critical path, truncation, edge-dropping, edge labels) but typed to `SessionTreeNode`. Rather than duplicate it, generalize its input to a minimal structural type:

```ts
interface GraphInputNode {
  id: string; parentId: string | null; label: string;
  costUsd: number; durationMs: number; edgeLabel: string | null;
}
```

with a thin adapter from `AgentTreeNode`. The existing tests continue to exercise the same core logic through an adapter, so the transform's proven behavior is preserved rather than reimplemented.

### 3.6 UI

`sessions/[id]` fetches `getAgentTree(session_id)` instead of `getSessionTree`, and renders the graph when the session spawned any agents. Node labels become `agent_type` (falling back to a short agent id) — far more legible than the session-id prefixes the dead path would have shown. Edge labels come from the `agents.edge_label` column.

The session-tree fetch is removed from the page. `get_session_tree` stays in the database, unused.

## 4. Testing

- **Ingest (bun):** `subagent_start` accepted by the schema; a batch containing one is not rejected.
- **Promotion (bun):** each of the three event types contributes its fields; upsert is order-independent (stop-before-start and start-before-stop both yield a complete row); a later event does not null out earlier fields; `parent_agent_id` is null when `origin_agent_id` is absent.
- **RPC:** service-layer shape tests; manual SQL smoke (deferred, see §6).
- **Transform (bun):** the 6 existing `buildSpawnGraph` cases must still pass through the adapter; new cases for the agent adapter (label fallback, edge label carried).
- **Plugin (pytest):** `subagent_start` now reaches the push queue.
- **UI:** no component harness — `bunx tsc --noEmit` + manual run.

## 5. Error handling & edge cases

- **Orphaned `parent_agent_id`** (parent row absent — e.g. batch split): the recursive CTE roots only at `parent_agent_id is null`, so such a node would vanish. The RPC must therefore also root at agents whose parent is not present in the session's agent set, and those render as additional roots rather than disappearing.
- **Cycles** (should be impossible, but a corrupt id could create one): the recursive CTE carries a depth cap as a safeguard. **Empirically verified against Postgres 17:** a *pure* cycle is excluded entirely rather than recursing — every member has a parent present in the scoped set, so none qualifies as a root and none enters the anchor. The cap therefore only engages for a cycle reachable from a legitimate root, or a chain deeper than 50. Cycle members vanish from the graph silently; acceptable since this requires corrupt ids.
- **Agent with no `subagent_start`** (pre-1.3.0 or a dropped event): still created by the `tool_result`/`subagent_stop` path, with a null `started_at`.
- **Sessions with no agents:** the graph card is not rendered; no empty box.
- **Null pricing:** cost contributes 0, never crashes.

## 6. Known limitations

- **No backfill.** Sessions captured before plugin 1.3.0 have no agent rows and will show no graph. This is unavoidable — the identifiers were never recorded.
- **Verification debt, now seven migrations deep.** 022–027 have never been executed against a real Postgres, and this slice adds 028. No UI from Specs A, B, or C has been verified in a browser. **Running the accumulated SQL against a real database remains the single highest-value action available**, and it gates real confidence in this graph actually rendering.

## 7. Open questions for planning

1. **Upsert null-clobbering.** A partial upsert must not overwrite a set column with null. Decide the mechanism (per-event targeted `update` of only the columns that event owns, vs. `coalesce`-on-conflict) and apply it consistently — this is the most likely source of silent data loss in this slice.
2. Confirm the recursive CTE's root condition handles both true roots and orphans without double-counting a node.
3. Confirm the graph adapter keeps all 6 existing transform tests passing unmodified; if any must change, that is a signal the generalization is wrong.

## 8. Follow-on

- Enrich the Agents page/drill-down with `agent_result` metrics (exact tokens/duration from source, replacing transcript parsing that fails ~20% of the time).
- `stop.py`'s phantom `stop_hook_reason` → `sessions.stop_reason` is 100% `"unknown"` in the dashboard.
- Remove `get_session_tree` and migration 025's dead edge-label lateral once nothing references them.
- Delete the pending mechanism if `duration_source` shows `native` universally in the field (D1 §6).
