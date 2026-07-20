# get_session_tree.edge_label is permanently NULL

## Idea
Migration 025 added an `edge_label` column to `get_session_tree`, resolved by a lateral join keyed on `session_start.data->>'agent_id'`.

Spec D1 deleted that field. `session_start.py` no longer writes `agent_id` — commit `634c9ef` added it for exactly this lateral, and D1's `0b98c78` removed it. The join therefore matches nothing, and `edge_label` is unconditionally NULL for any data from plugin ≥ 1.3.0.

Confirmed empirically during Spec F's Task 0 migration validation: NULL against current-shape data, populates only in a control where `agent_id` is re-added. Full detail in `docs/superpowers/plans/2026-07-20-migration-validation-notes.md`.

## Why nothing is visibly broken
`get_session_tree` has **no callers**. `getSessionTree` exists in `apps/app/src/lib/services/analytics.service.ts` with zero call sites, and `buildSpawnGraph` in `apps/app/src/lib/graph/spawn-graph.ts` is likewise dead — only `buildAgentGraph` is used. The session detail spawn graph is built from `get_agent_tree`, whose `edge_label` comes from the `agents` table and works correctly.

So this is dead data behind a dead RPC behind dead client code. It costs nothing today and will mislead whoever wires up the first consumer.

## Options
1. **Delete the dead path** — drop `get_session_tree` and `get_entity_rollup` (also uncalled), remove `getSessionTree`, `buildSpawnGraph`, `labelFor` and the `SessionTreeNode` / `EntityRollup` types. Largest diff, smallest remaining surface.
2. **Fix the lateral** to resolve `edge_label` from the `agents` table the way `get_agent_tree` does, leaving the RPC usable.
3. **Leave it, document it** — a comment in migration 025's successor noting the column is dead.

Option 1 is probably right: the spawner-chain UI these RPCs were built for (migrations 019/023/025) never shipped, and `get_agent_tree` has since superseded it for the one graph that exists. Worth confirming nobody intends to build the session-level spawn tree before deleting it.

## Related
`get_top_agents`' latency join (migration 024) was checked at the same time and is **fine** — `tool_result` still carries `data.agent_id`, and p50/p99 populate correctly. Noted here so the next person doesn't re-investigate it.

## When to revisit
Before anyone builds UI on `get_session_tree` or `get_entity_rollup`, or during a general dead-code sweep. Not urgent — nothing reads it.
