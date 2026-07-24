# Agent Kind Classification — Planning

## Problem

The **Top Agents** table groups on the raw `agent_type` string Claude Code emits at
spawn time and does no classification. That single column mixes three structurally
different things:

- **Plugin agents** — registered, namespaced `plugin:name` (`engineering:software-engineer`).
- **Built-in agents** — Claude Code's own types (`general-purpose`, `Explore`, `Plan`, `fork`).
- **Ad-hoc / labeled agents** — arbitrary `name`/`label` strings attached to what is really a
  general-purpose or forked agent (workflow step labels like `impl-task13`, named background
  agents like `gfx-identity`).

Users cannot tell a durable, defined capability apart from a one-off orchestration label, so
they cannot evaluate them differently.

## Why classify at ingest (the robust path)

A pure dashboard-side string heuristic can recover `plugin` (namespaced) and `builtin` (known
set), but a **bare** name is ambiguous: a user/project-defined agent in `.claude/agents/*.md`
looks identical to an ad-hoc workflow label. The only place with the context to resolve that
is the **hook**, at spawn time, where the session's agent registry is on disk.

## Design

Five kinds: `plugin | builtin | project | user | ad_hoc`.

1. **Hook (`claude-plugin`)** — `classify_agent_kind(agent_type, cwd)` in `telemetry.py`:
   - `:` in name → `plugin` (pure string; only plugins are namespaced).
   - name in built-in set → `builtin` (also the empty/None fallback).
   - name is the stem of a `<cwd>/.claude/agents/**/*.md` file → `project`.
   - name is the stem of a `~/.claude/agents/**/*.md` file → `user`.
   - else → `ad_hoc`.
   Best-effort, never raises. `subagent_stop.py` (read by the RPC) and `subagent_start.py`
   both stamp `agent_kind` into the event payload.

2. **Ingest** — no change: `events.service.ts` stores `data` jsonb wholesale, so `agent_kind`
   flows straight through to `events.data->>'agent_kind'`.

3. **Migration `036_agent_kind.sql`**:
   - `classify_agent_kind(text)` SQL fn — string-heuristic fallback for historical / pre-plugin
     events (yields only `plugin`/`builtin`/`ad_hoc`; cannot infer `project`/`user`).
   - `get_top_agents` returns `agent_kind = coalesce(<stored mode()>, classify_agent_kind(type))`.
     Stored (hook-resolved) kind is authoritative; the heuristic only fills gaps.

4. **Dashboard** — `AgentKind` type; `AgentStat.agent_kind`; `TopAgentsTable` client component
   with an **Origin** badge column and per-kind filter chips (adaptive, count-labeled).

## Honest limitations

- Historical events carry no stored kind, so they can only ever resolve to
  `plugin`/`builtin`/`ad_hoc` — never `project`/`user`. Precision starts from the plugin
  upgrade forward.
- `project`/`user` resolution depends on the agent's markdown file still existing in the
  registry at spawn time; a renamed/removed definition falls to `ad_hoc`.
