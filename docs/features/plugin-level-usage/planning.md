# Plugin-Level Usage Tracking — Planning

## Problem

Claude Code "plugins" are bundles that ship some combination of skills, subagents,
MCP servers, slash commands, and hooks. Today, the dashboard tracks each primitive
in isolation (`/skills`, `/agents`, `/tools`), so there is no way to ask "how much
am I using the *superpowers* plugin?" or "which plugins are pulling weight in my
sessions?"

The user expectation: plugins should appear as first-class, attributable entities
in the dashboard, with the ability to drill into the primitives they ship.

## Out of scope (v1)

- Slash command attribution. Commands are currently captured as part of the
  `prompt` event with no parsing; identifying `/plugin:command` requires a new
  parser in `user_prompt_submit.py` and event-shape changes.
- Hook attribution. Hooks have no per-event signal — they execute side effects
  but don't emit an attributable event. Would require the plugin to self-report
  on `session_start`.
- Plugin marketplace/install state. We only attribute *usage* of plugins via
  prefixes already on the wire.

## Plugin identification strategy

No schema change. Plugin names are parsed from existing event fields:

| Primitive | Source event | Field | Parse rule |
|---|---|---|---|
| Skill | `skill_use` | `data->>'skill_name'` | If contains `:`, take left side. Else bucket as `(unscoped)`. |
| Subagent | `subagent_stop` | `data->>'agent_type'` | Same rule as skills. |
| MCP tool | `tool_use` / `tool_start` | `data->>'tool_name'` | If matches `^mcp__plugin_([^_]+(?:_[^_]+)*?)__`, capture group 1 is the plugin name. MCP tools not prefixed with `plugin_` (e.g. `mcp__claude_ai_Gmail__*`) are user-configured MCPs, bucketed as `(user-mcp)`. |

The parse logic lives in one SQL helper function so it's consistent across RPCs:

```sql
create or replace function public.extract_plugin_name(
  p_kind text,        -- 'skill' | 'agent' | 'mcp_tool'
  p_value text
) returns text language sql immutable as $$
  ...
$$;
```

This becomes the join key for all rollups.

## Database work

### Migration `022_plugin_stats.sql`

1. `extract_plugin_name(kind, value)` helper (above).
2. `get_plugin_stats(p_user_id, p_from, p_to, p_limit)` — RPC that unions three
   subqueries (skills, agents, MCP tools) and groups by plugin name. Returns:
   ```
   plugin_name        text
   skill_invocations  int
   agent_invocations  int
   mcp_tool_calls     int
   total_invocations  int
   total_input_tokens bigint    -- where available (subagent_stop only initially)
   total_output_tokens bigint
   trend              numeric   -- vs previous equal-length window
   ```
3. `get_plugin_detail(p_user_id, p_plugin_name, p_from, p_to)` — RPC returning the
   per-primitive breakdown for a single plugin (rows: kind, name, count, tokens).

No new indexes anticipated — existing `(user_id, event_type, timestamp)` indexes
cover the access patterns. Confirm with `explain analyze` on real data before
merge.

### Indexes to verify

`events (user_id, event_type, timestamp)` exists from `004_events.sql`. The
plugin-name extraction is a JSONB lookup + string parse per row inside the
aggregation — fine at current scale, revisit if `events` row counts cross ~10M
per user.

## API layer

New routes under `apps/app/src/app/api/v1/analytics/`:

- `GET /api/v1/analytics/plugins` — lists plugin stats with the same date-range
  contract as `/analytics/tools`. Calls `get_plugin_stats`.
- `GET /api/v1/analytics/plugins/[name]` — single plugin breakdown via
  `get_plugin_detail`.

New service module: `apps/app/src/lib/services/plugins.service.ts`, matching the
shape of `analytics.service.ts`.

New type: `PluginStat`, `PluginDetailRow` added to `apps/app/src/types/analytics.ts`.

## UI

### New page: `/plugins`

Route: `apps/app/src/app/(dashboard)/plugins/page.tsx`. Pattern follows
`agents/page.tsx`:

- Header + intro copy
- Stat cards: Active Plugins, Total Plugin Invocations, Top Plugin
- "Plugin Activity Over Time" stacked chart (one stack per plugin, top 5 +
  "other")
- "Plugins" table — name, skill invocations, agent invocations, MCP tool calls,
  total, trend. Each row links to `/plugins/[name]`.

Add sidebar entry between Agents and Cost:
```ts
{ href: "/plugins", label: "Plugins", icon: Package }
```
(`apps/app/src/components/dashboard/sidebar.tsx:28`)

### New page: `/plugins/[name]`

Route: `apps/app/src/app/(dashboard)/plugins/[name]/page.tsx`. Shows:

- Plugin name + description (from a new `lib/plugin-descriptions.ts`, mirroring
  `lib/skill-descriptions.ts`)
- Stat cards: skill count, agent count, mcp tool count, total invocations
- Three tables (skills / agents / mcp tools) listing the specific primitives the
  plugin contributed and their per-primitive counts. Each row deep-links back to
  its source page filtered to that primitive.

### Grouping toggles on existing pages

A new shared component `components/analytics/group-by-plugin-toggle.tsx`:
shadcn `ToggleGroup` with two states (`flat`, `by-plugin`). State held in URL
search params (`?group=plugin`) so links/refresh are stable.

When `group=plugin`:
- `/skills`, `/agents`, `/tools` switch their main table to a two-level
  collapsible: parent row is the plugin (with aggregate counts), expanding shows
  the individual primitives. Use shadcn `Collapsible` inside each `TableRow`.
- Rows with no plugin namespace are grouped under `(unscoped)` / `(built-in)` /
  `(user-mcp)` as appropriate.

This requires the three RPCs (`get_skill_stats`, `get_top_agents`, `get_tool_stats`)
to optionally accept a `p_group_by_plugin boolean` flag and return rows with a
`plugin_name` column — or we can post-process client-side from the existing
flat results since payload sizes are small. **Recommendation: post-process
client-side** to keep the migration scope minimal.

## Plugin description metadata

`apps/app/src/lib/plugin-descriptions.ts` — hand-maintained map of plugin name →
{ description, homepage }. Seeded from observed plugin names in the user's data.
Same pattern as `skill-descriptions.ts`. Future work: discover plugin metadata
from a marketplace API.

## Telemetry-side considerations

No plugin changes required for v1 — all signals already on the wire. Future:
have `session_start.py` include the installed-plugin manifest so we can show
"installed but unused" plugins.

## Phasing

1. **DB + API** (1 PR)
   - `022_plugin_stats.sql` (helper fn + 2 RPCs)
   - `plugins.service.ts`
   - `/api/v1/analytics/plugins` + `/api/v1/analytics/plugins/[name]`
   - Type additions
2. **Plugins page + drill-down** (1 PR)
   - `/plugins` page + chart
   - `/plugins/[name]` page
   - Sidebar entry
   - Plugin-descriptions seed file
3. **Grouping toggles** (1 PR)
   - Shared toggle component
   - Wire into `/skills`, `/agents`, `/tools`
   - Client-side regrouping

## Open questions

- Token attribution for skills/MCP tools: subagent_stop carries `input_tokens` /
  `output_tokens`, but `skill_use` and `tool_use` don't. Plugin-level token
  totals will therefore *under-count* skill/MCP usage in v1. Acceptable for
  rollout; flagged for follow-up once skill-token attribution lands.
- "Built-in" bucket naming. Proposed: `(built-in)` for unprefixed skills/agents,
  `(user-mcp)` for non-plugin MCPs. Open to alternatives.
- Sidebar order — Plugins between Agents and Cost feels right ("primitives"
  block stays grouped), but could go elsewhere.

## Success criteria

- A plugin like `superpowers` shows up on `/plugins` with a numeric breakdown of
  all skills, subagents, and MCP tools it contributed during the date range.
- Drilling into `/plugins/superpowers` lists each primitive the plugin shipped
  that was actually used, with counts.
- Toggling "Group by plugin" on `/skills` reorganizes the existing skill list
  into plugin-rolled-up rows without refetching.
- Existing pages and RPCs remain unchanged in their default (flat) behavior.
