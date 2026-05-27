# Sessions Timeline + Outcomes — Completion Summary

All three phases shipped. See `planning.md` for the original plan.

## Phase 1 — Turn-grouped timeline + outcome signals (UI-only)
- `apps/app/src/lib/events/grouping.ts` — `groupEventsByTurn`, `buildTimelineRows`, `countCompactions`, `countUserTurns`
- `apps/app/src/lib/events/preview.ts` — `parseInputPreview` with tolerant truncated-JSON parsing
- `apps/app/src/components/sessions/outcome-signals.tsx` — stop reason badge, compaction count, turn count
- `apps/app/src/components/sessions/timeline.tsx` — collapsible turn-grouped timeline with payload previews, run collapsing (3+), inline compaction dividers
- Page wired in `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`; old flat event timeline removed

## Phase 2 — Interactive polish (UI-only)
- `apps/app/src/lib/events/phase-detection.ts` — `classifyEventPhase`, `computeTurnPhaseProportions` (tolerant Bash command sniff for `test|lint|build|tsc|typecheck`)
- `apps/app/src/components/sessions/timeline-filters.tsx` — search input, event-type chips, tool multi-select popover, "Showing X of Y" + Clear
- `timeline.tsx` extended with: filter state, per-turn phase mini-bar (blue/emerald/amber), legend strip, idle-gap dividers between turns (>30s), first-token latency hint (>1s)

## Phase 3 — True tool failures (plugin + UI)
**Plugin:**
- Fixed a latent bug: `claude-plugin/hooks/post_tool_use.py` was reading `hook_input["tool_result"]` but Claude Code sends `tool_response`. Every tool_result event in production recorded `result_size: 0` because of this. Now reads the correct key.
- `claude-plugin/lib/telemetry.py`: `sanitize_tool_result` extended to extract `is_error` and a 200-char `error_preview` (preference: `content` → `error` → `message`). Returns `{size, is_error, error_preview}`; `is_error` is `None` when unknown (e.g., plain-string responses).
- `claude-plugin/hooks/post_tool_use.py`: emits `is_error` and `error_preview` in the `tool_end` event data.

**App:**
- `grouping.ts`: `TimelineRow.tool` now has `isError: boolean | null`; `TimelineRow.tool_run` has `errorCount` + `resultEvents[]`. Added `countToolErrors()` and `getResultErrorPreview()`.
- `outcome-signals.tsx`: error pill with three states — hidden (no error data), muted "No tool errors" + check icon, or destructive "N tool errors (X%)".
- `timeline.tsx`: errored tool rows show destructive badge + optional error-preview tooltip; `errorsOnly` filter wired.
- `timeline-filters.tsx`: "Errors only" toggle.

## Decisions made during implementation

- **Skipped the RPC** originally planned in Phase 3.2 (`get_session_tool_failures`). Events are already loaded on the page; counting errors client-side is trivial and avoids a roundtrip. The RPC can be added later if sessions get large enough to require server-side aggregation.
- **No `sessions.service.ts` wrapper** — would only be needed for the dropped RPC.
- **Error preview is always emitted** when an error is detected (no new privacy config flag). Reasoning: error messages are short and high-signal, and users have opted into telemetry by enabling the plugin.
- **Absence of `is_error` field = unknown, not zero.** OutcomeSignals hides the error pill entirely for older sessions rather than showing a misleading "0 errors".
- **The Phase 2 `try/catch` around `computeTurnPhaseProportions`** in `timeline.tsx` was a safety net during parallel agent work and is now dead code. Worth removing in a small follow-up — left in place for now since it's harmless.

## Verification (all green)

- App lint (`bun run --filter @trenchcoat/app lint`): clean
- App tests (`bun test` from `apps/app`): 372 pass / 0 fail / 1457 assertions across 21 files
- App build (`bun run --filter @trenchcoat/app build`): clean
- Plugin tests (`uv run --with pytest pytest tests/` from `claude-plugin/`): 95 pass / 0 fail

## Not verified visually

None of the three phases were exercised in a running browser against real session data. Recommended manual verification:
1. `bun run dev:app`, log in, open a recent session
2. Confirm: outcome strip renders, turn-grouped timeline expands/collapses, payload previews look right
3. Apply a filter, confirm row count updates and groups auto-expand
4. Run a Claude Code session with the updated plugin installed, then look at the resulting session — confirm `result_size > 0` and (if any tool errored) the destructive badges appear

## Backlog items spawned

- `docs/backlog/enhancement-session-prompt-as-title.md` — show first user prompt as session title (deferred per user)
- Future: add `get_session_tool_failures` RPC if/when client-side aggregation becomes a perf problem
- Future: remove the `try/catch` around `computeTurnPhaseProportions` in timeline.tsx
