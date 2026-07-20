# Changelog

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
