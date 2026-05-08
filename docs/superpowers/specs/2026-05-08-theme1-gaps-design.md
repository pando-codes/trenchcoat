# Theme 1 Gap Coverage Design

**Date:** 2026-05-08  
**Scope:** Theme 1 — Agent Value Clarity (current strategic focus)  
**Approach:** Foundation-first (date filtering + trend fix → session filtering → Agents page)

---

## Background

The core dashboard is built: event ingestion, sessions, daily aggregates, Overview/Sessions/Tools/Activity pages, teams, API key management, and a plugin with all hooks. The following Theme 1 gaps remain before engineers can reliably answer "which agents and tools are working":

1. Date filtering exists as a component but isn't wired to any page
2. Tool trend is always 0 (RPC returns no comparison data)
3. Session list has no search or filtering
4. Agents have no dedicated page — only a count on the overview

---

## Section 1: Date Filtering Infrastructure

### Mechanism

Date state lives in the URL as `?from=YYYY-MM-DD&to=YYYY-MM-DD`. This makes filtered views bookmarkable and shareable, and avoids client state on RSC pages.

### Layout change

`(dashboard)/layout.tsx` currently renders `<Sidebar> + {children}` with no Topbar. The `Topbar` component is already built and already holds the `DateRangePicker`, but is not included in the layout. Add the `Topbar` to the layout, wired to the user's name/avatar (fetched server-side, same as Sidebar).

### DateRangePicker change

Replace the current `onRangeChange` callback prop approach with a URL-driven implementation: the picker reads the current range from `useSearchParams` and calls `router.replace` with updated `from`/`to` params when the user selects a range. Falls back to last 30 days when params are absent.

The `Topbar` component's `dateRange` and `onDateRangeChange` props are removed — the `DateRangePicker` inside it becomes self-contained and URL-driven, needing no external state.

### Page changes

Overview, Tools, and Activity pages add a `searchParams: Promise<{ from?: string; to?: string }>` prop and read `from`/`to` from it, falling back to last 30 days. Sessions page does the same (shares the date range with the branch filter in Section 3).

---

## Section 2: Tool Trend Fix

### Problem

`get_top_tools` queries a single time window. The `trend` column is absent from results; the frontend defaults it to `0`.

### Fix

Replace the RPC body with a CTE structure:
- **Current period:** `p_from` → `p_to`
- **Previous period:** same duration, immediately preceding `p_from`

Join current and previous counts per `tool_name`, compute:

```
trend = (current_count - previous_count) / nullif(previous_count, 0) * 100
```

Returns `null` when there is no previous-period data (new tool). Frontend renders `null` as `--` rather than `0`.

### Delivery

New migration `010_tool_trend.sql` replacing the existing `get_top_tools` function. No schema changes.

---

## Section 3: Session Filtering

### Filters

| Filter | URL param | UI |
|---|---|---|
| Date range | `?from=` / `?to=` | Shared with topbar picker — no duplicate UI |
| Git branch | `?branch=` | Select dropdown populated from distinct branch values in `sessions` table |

### Component

A `SessionFilters` client component renders above the sessions table. It contains only the branch select (the date range is already handled by the topbar). When the branch changes, it calls `router.replace` updating `?branch=` and resetting `?page=1`.

### Pagination

Pagination links carry forward active filter params so filters persist across pages.

---

## Section 4: Agents Page

### Route

`/agents` — added to the sidebar nav between Tools and Activity.

### Data source

All data comes from existing `subagent_stop` events in the `events` table. The `data` jsonb field already contains:
- `agent_type` — type of agent (e.g. `"subagent"`)
- `tool_counts` — `{ tool_name: count }` dict parsed from agent transcript
- `tool_count_total` — total tools called
- `turns` — conversation turns

No new plugin instrumentation required.

### Database

New migration `011_agent_functions.sql` adding a `get_top_agents` RPC:

```sql
get_top_agents(p_user_id, p_from, p_to, p_limit)
```

Returns per `agent_type`: call count, avg tool count per call, avg turns, trend vs. previous period (same window-length logic as `get_top_tools` fix).

### Page layout

**Top half — aggregate view:**
- Bar chart: agent calls over time (reuses `DailyActivityChart` pattern, driven by `daily_aggregates.agent_calls`)
- Ranked table: agent type | call count | avg tools/call | avg turns | trend

**Bottom half (on session detail, not the agents page):**
The existing `sessions/[id]` page gets an **Agents** section appended below the event timeline. It queries all `subagent_stop` events for that session and renders each as a row/card showing: agent type, tool count total, turns, and a mini breakdown of `tool_counts` (top 3 tools used by the agent).

### Date filtering

The `/agents` page respects the global `?from=` / `?to=` params, consistent with all other analytics pages.

---

## What This Does Not Include

- Token attribution or cost data (Theme 2 — not in scope here)
- Skills, commands, or hooks as distinct tracked component types (requires plugin instrumentation changes — deferred)
- CSV export or shareable views (Theme 3)
- Team-level analytics improvements (Theme 3)
