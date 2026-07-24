# Changelog

## [2026-07-23] — Agent Kind Classification

### Added
- Every subagent spawn is classified into one of five origins — `plugin`, `builtin`,
  `project`, `user`, `ad_hoc` — resolved at hook time by `classify_agent_kind()` in the plugin
  and stored on the event (`data.agent_kind`).
- **Origin** badge column and per-kind filter chips on the **Top Agents** table
  (`TopAgentsTable`), letting defined plugin/project/user agents be evaluated apart from
  built-ins and ad-hoc labels (workflow step labels, named background agents).
- `classify_agent_kind(text)` SQL fallback (migration `036_agent_kind.sql`) for historical
  events with no stored kind (string heuristic: `plugin`/`builtin`/`ad_hoc` only).

### Changed
- `get_top_agents` now returns `agent_kind = coalesce(<stored>, classify_agent_kind(type))` —
  the hook-resolved kind is authoritative; the heuristic only fills gaps.
- `subagent_start.py` / `subagent_stop.py` read `cwd` from hook input and stamp `agent_kind`.

### Technical Details
- Only the hook can tell `project`/`user`-defined agents apart from `ad_hoc` labels — it reads
  `<cwd>/.claude/agents/**/*.md` and `~/.claude/agents/**/*.md` at spawn time. The dashboard
  string heuristic cannot, so historical rows never resolve to `project`/`user`.
- `agent_kind` flows through ingest unchanged (`events.data` is stored wholesale).
- Files: `claude-plugin/lib/telemetry.py`, `claude-plugin/hooks/subagent_{start,stop}.py`,
  `supabase/migrations/036_agent_kind.sql`, `apps/app/src/types/analytics.ts`,
  `apps/app/src/lib/services/analytics.service.ts`,
  `apps/app/src/components/agents/top-agents-table.tsx`,
  `apps/app/src/app/(dashboard)/agents/page.tsx`.
- Migration `036` is **not yet applied** to the live project.

## [2026-07-23] — Per-Machine (Per-API-Key) Filtering

### Added
- `sessions.api_key_id` column (migration `035_session_api_key.sql`) attributing every
  session to the API key that ingested it. One key = one machine/environment.
- Global **Machine** filter in the dashboard topbar (`MachineFilter`), sourced from the
  user's API keys, applied via an `api_key_id` URL param on every page. Hidden until the
  user has ≥2 keys.
- New RPCs for filtered analytics where the pre-aggregated `daily_aggregates` table has no
  key dimension: `get_daily_activity_for_key`, `get_hourly_heatmap_for_key`,
  `get_stop_reasons_for_key`.

### Changed
- Analytics RPCs gained an optional `p_api_key_id` (null = all machines, output unchanged):
  `get_overview_stats`, `get_top_tools`, `get_top_agents`, `get_agent_timeseries`,
  `get_skill_stats`, `get_daily_cost`, `get_cost_by_model`, `get_eval_list`.
- Ingestion (`events.service.ts`) stamps `api_key_id` on session insert and back-fills NULLs
  on update (never overwrites).
- Sessions list + overview / activity / tools / agents / cost / skills / evals pages and the
  `/api/v1/sessions`, `/api/v1/analytics/overview`, `/api/v1/analytics/tools` routes thread
  the machine filter through.

### Technical Details
- Attribution grain is `sessions` only; `events`/`agents` inherit it via a session join, so
  drilling into any session shows one machine's events/agents/skills/tools inherently.
- `daily_aggregates` reads use **bypass-when-filtered**: unfiltered keeps the fast
  pre-aggregated path byte-for-byte; a machine filter recomputes from raw events/sessions.
- Historical sessions have `api_key_id = NULL` until a keyed batch re-touches them. UI filters
  by immutable `api_key_id` but labels by the key's current `name`, so key rotation with a
  reused name keeps a machine coherent.
- **Applied to production** (`mqdkmtkgbkbbfbiykwxx`, 2026-07-23) after validating on a throwaway
  dev branch: all 13 functions smoke-tested against a two-machine seed, filtering confirmed
  correct. Fixed one bug found in validation — adding `p_api_key_id` overloaded rather than
  replaced the old signatures, so the migration `drop function`s the 8 prior signatures first.
  Post-apply verification: column + index present, each RPC resolves to a single signature.
- **Still to do:** deploy the app so the dashboard machine filter goes live.
- Plan and design rationale in `docs/features/per-machine-filtering/`.

## [2026-07-20] — Cache-Aware Session Cost

### Changed
- Session cost is now cache-aware end to end: the plugin (1.3.3) captures cache
  tokens from the transcript, `sessions` stores them, and all session-surface
  pricing runs through the single `price_tokens` SQL function. Session detail
  gains a Cache card and an Agents table sourced from the `agents` table
  (status, model, tool count, cache tokens). Unpriced models now render `--`
  rather than `$0.00`. The Cost and Agents pages remain cache-blind and are
  labelled as such.

## [2026-05-21] — Sessions Timeline + Outcome Signals

### Added
- Session detail page (`/sessions/[id]`) now groups the event timeline by user turn (delimited by `prompt_submit` events). Each turn is collapsible and shows tool count, duration, tokens, and stop reason.
- Tool rows display a parsed payload preview (file path for Read/Edit/Write/MultiEdit, command for Bash, pattern for Grep/Glob).
- Consecutive identical tool calls (3+) collapse into a single "Tool ×N" row.
- `pre_compact` events render inline as "Context compacted" dividers (not as raw rows).
- Outcome signal strip above the KPI cards: stop reason badge, compaction count, turn count, and tool-error count.
- Interactive timeline filters: search by tool name or input preview, toggle event-type chips, multi-select tool names, "Errors only" toggle.
- Per-turn phase bar (Explore / Implement / Verify / Other) with a duration legend.
- Idle-gap dividers between turns (>30s) and assistant first-token latency hint (>1s) inside expanded turns.
- Tool errors surfaced on `tool_result` events that carry `data.is_error`. Errored rows show a destructive badge; tooltips reveal the truncated error preview when available.

### Changed
- Sessions detail event timeline replaced — old flat vertical list is gone.

### Fixed
- **Plugin (latent bug):** `claude-plugin/hooks/post_tool_use.py` was reading `hook_input["tool_result"]` but Claude Code's PostToolUse hook actually sends `tool_response`. Every tool_result event was recording `result_size: 0` because of this. Now reads the correct key. Future tool results carry real sizes plus the new `is_error` and `error_preview` fields.

### Technical Details
- New pure-function libraries (with bun unit tests):
  - `apps/app/src/lib/events/grouping.ts` — turn grouping, row building, tool-pairing by correlation_id with tool_name fallback, error stats.
  - `apps/app/src/lib/events/preview.ts` — tolerant parser for truncated `data.input_preview` strings.
  - `apps/app/src/lib/events/phase-detection.ts` — tool-category classifier with Bash command sniffing.
- New components: `apps/app/src/components/sessions/outcome-signals.tsx`, `timeline.tsx`, `timeline-filters.tsx`.
- Plugin: `claude-plugin/lib/telemetry.py` `sanitize_tool_result` now returns `{size, is_error, error_preview}`. `is_error` is `None` (unknown) for old/string responses — UI treats absence as unknown and hides the pill.
- No DB migrations. `events.data` is `jsonb`; new fields flow through without schema changes.
- Feature plan and completion summary in `docs/features/sessions-timeline-outcomes/`.
