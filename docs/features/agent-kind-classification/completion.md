# Agent Kind Classification — Completion

## Delivered

Every subagent spawn is now classified into one of five origins —
`plugin | builtin | project | user | ad_hoc` — resolved at hook time (authoritative) with a
SQL string-heuristic fallback for historical rows. The **Top Agents** table surfaces it as an
**Origin** badge column plus per-kind filter chips.

## Changes

**Plugin (`claude-plugin/`)**
- `lib/telemetry.py` — `classify_agent_kind(agent_type, cwd)`, `_discover_local_agents(cwd)`,
  and `BUILTIN_AGENT_TYPES`.
- `hooks/subagent_stop.py`, `hooks/subagent_start.py` — stamp `agent_kind` into the event
  payload (read `cwd` from hook input).
- `tests/test_telemetry.py` — `TestClassifyAgentKind` (10 cases; HOME isolated). 163 pass.

**Database**
- `supabase/migrations/036_agent_kind.sql` — `classify_agent_kind(text)` SQL fn +
  `get_top_agents` now returns `agent_kind`. **Not yet applied to the live project.**

**Dashboard (`apps/app/`)**
- `types/analytics.ts` — `AgentKind` union; `AgentStat.agent_kind`.
- `lib/services/analytics.service.ts` — maps `agent_kind` (defaults `ad_hoc`).
- `components/agents/top-agents-table.tsx` — new client component: Origin badge + kind filter.
- `app/(dashboard)/agents/page.tsx` — renders `TopAgentsTable`.
- `lib/__tests__/analytics.service.test.ts` — kind mapping + default coverage. 29 pass.

## Verification

- `uv run --with pytest pytest` → 163 passed.
- `bun test analytics.service.test.ts` → 29 passed.
- `tsc --noEmit` → no errors in changed files (pre-existing unrelated errors remain).
- `eslint` (local) on changed files → clean.
- Migration SQL not run live (no reachable Postgres); parens balanced, derived from the
  known-good `035` definition.

## Remaining / follow-ups

1. **Apply `036_agent_kind.sql`** to the Supabase project (needs user go-ahead — it replaces
   `get_top_agents`).
2. **Ship the plugin update** so new events carry `agent_kind`; add a plugin version note like
   the existing latency banner if desired.
3. Optional: extend `agent_kind` to the agent detail page and a "Defined vs ad-hoc" rollup.
