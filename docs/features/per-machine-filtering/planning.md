# Per-Machine (Per-API-Key) Filtering — Planning

## Problem

A single user works across several machines/environments (laptop, workstation, CI…),
each configured with a **different Trenchcoat API key** in its own
`~/.claude/settings.json`. The user wants to observe everything in the dashboard
(sessions, events, agents, skills, tools, cost) **filtered by machine**.

## Core insight

The API key already uniquely identifies the machine, and the SaaS already knows
which key sent every batch: `validateApiKey` returns the full `api_keys` row and
the middleware puts it on `context.apiKey` (`api-middleware.ts:129`). Today this
attribution is **discarded** — neither `events` nor `sessions` records which key
produced it.

Using the API key as the machine dimension is preferred over a plugin-supplied
hostname because:
1. It is unspoofable (the key *is* the auth boundary).
2. It requires **zero plugin changes** — machines already use distinct keys.
3. `api_keys.name` is already a human label — name each key after its machine and
   it becomes the filter label for free.

## Grain decision

`sessions` is the attribution grain: one Claude Code session runs entirely on one
machine, so one key per session. Everything else inherits:
- `events` carry `session_id` → join to `sessions.api_key_id`.
- `agents` carry `session_id` (parent session) → same join.
- `skill_use` / `tool_use` are events → same join.

So we store `api_key_id` on `sessions` **only**, and filter every other surface by
joining through the session. No `api_key_id` column on the high-volume partitioned
`events` table.

## The `daily_aggregates` gotcha

`daily_aggregates` is grained `(user_id, date)` with **no key dimension**, and its
rollup RPC (`update_daily_aggregate`) sums all of a user's events regardless of key.
Four read paths are bound to it: `get_overview_stats`, `getDailyActivity`,
`getHourlyHeatmap`, and the direct `.from("daily_aggregates")` reads on the
overview/activity/agents pages.

**Decision: bypass-when-filtered (Option B).**
- No machine filter active → unchanged; read the fast pre-aggregated table.
- Machine filter active → compute the same metrics on the fly from raw
  `events`/`sessions` joined by `api_key_id`.

Rejected Option A (re-grain `daily_aggregates` to `(user_id, api_key_id, date)`):
it forces every *unfiltered* read to sum across keys, touching the main dashboard's
fast path + requiring a backfill — more surface, more regression risk, for a filtered
view that is by definition smaller data.

## Rotation & historical data

- Store the immutable `api_key_id` (FK) but **label/group by the key's current
  `name`** in the UI, so rotating a machine's key (reusing the name) keeps the
  machine coherent.
- Sessions created before this ships have `api_key_id = NULL` → surface as an
  "Unattributed" bucket, never hidden. A one-time backfill can attribute historical
  sessions where a later keyed batch re-touches them (update-if-null on ingest).

## URL / filter contract

- Global control in the topbar next to the date picker (applies on every page),
  mirroring `DateRangePicker`'s relative `router.replace(\`?${params}\`)`.
- URL param: `api_key_id=<uuid>` (value is the key id; label is the key name).
  Absent = all machines.
- Machine list sourced from the user's `api_keys` (`listApiKeys`), passed from the
  dashboard layout (server) into the topbar.

## File-change map

**Migration** (`035_session_api_key.sql`)
- `sessions.api_key_id uuid references api_keys(id) on delete set null` + index.
- Add optional `p_api_key_id uuid default null` to raw-table RPCs and filter via a
  `sessions` join: `get_top_tools`, `get_top_agents`, `get_agent_timeseries`,
  `get_skill_stats`, `get_daily_cost`, `get_cost_by_model`, `get_eval_list`.
- New filtered variants for the aggregate-bound reads:
  `get_overview_stats` (add `p_api_key_id`, branch to raw when set),
  `get_daily_activity_for_key`, `get_hourly_heatmap_for_key`.

**Write path**
- `events/route.ts` → pass `context.apiKey?.id`.
- `events.service.ts` → stamp `api_key_id` on session insert; `existing ?? new` on
  update (back-fills NULLs, never overwrites).

**Service layer** (`analytics.service.ts`, `sessions.service.ts`) — thread optional
`apiKeyId` through every time-aggregating reader + `listSessions`.

**API routes** — `analytics/overview`, `analytics/tools`, `sessions` read `api_key_id`.

**Dashboard**
- New `MachineFilter` client component (mirrors `session-filters.tsx`).
- Render globally in `topbar.tsx`; feed `machines` from `(dashboard)/layout.tsx`.
- Thread `api_key_id` searchParam through overview / activity / tools / agents /
  agent-detail / cost / skills / sessions pages.

## Out of scope (this pass)

- Team-grained aggregates (`get_team_overview_stats`, `get_team_member_stats`,
  `get_team_trend`) — team analytics span multiple users/machines by design.
</content>
</invoke>
