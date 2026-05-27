# Sessions Detail — Timeline + Outcome/Quality Improvements

## Goal
Make the session detail page (`/sessions/[id]`) significantly more insightful by:
1. Restructuring the **event timeline** so a human can quickly understand what happened in a session, turn by turn.
2. Surfacing **outcome and quality signals** (stop reason, context compaction, tool failures) that today are buried in raw events or not captured at all.

## Target file (initial)
`apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`

Most timeline UI will be extracted into client components under `apps/app/src/components/sessions/` (the current page is a server component, but interactive grouping/filtering needs client state).

## Reality check — what the data actually supports

Confirmed via reading `claude-plugin/lib/telemetry.py`, hooks, and `supabase/migrations/`:

| Idea | Data exists? | Source |
|---|---|---|
| Group timeline by user turn | ✅ | `prompt_submit` events delimit turns |
| Payload preview per event | ✅ | `data.input_preview` (≤100 chars, truncated JSON string) |
| Collapse runs of identical tools | ✅ (UI only) | `tool_name` on each event |
| Filter/search bar | ✅ | events table indexed by `event_type`, `tool_name` |
| Idle gap highlighting | ✅ | timestamps on `prompt_submit` / `assistant_stop` / `tool_use` |
| Phase detection (explore/implement/verify) | ✅ (heuristic) | `tool_name` patterns |
| Stop reason badge | ✅ | `sessions.stop_reason` already populated |
| Context compaction markers | ✅ | `pre_compact` events captured (migration 004, hook in plugin) |
| Soft tool-failure proxy | ✅ (lossy) | `tool_result.data.result_size == 0` is suspicious but ambiguous |
| **True** tool error rate | ❌ | plugin throws away `is_error` in `sanitize_tool_result` |
| Hook blocks / permission denials | ❌ | not emitted as events today |

## Phase 1 — Turn-grouped timeline + outcome signals (UI-only)

**Scope:** single PR, only touches `apps/app/`.

### 1.1 Header strip: outcome signals
Above the existing 5 KPI cards (or alongside them), add a compact signal strip:
- **Stop reason badge** — read `session.stop_reason` directly. Map values to friendly labels + colors:
  - `end_turn` / `stop_sequence` → neutral ("Completed")
  - `max_tokens` → warning ("Hit token limit")
  - `tool_use` → neutral ("Stopped mid-tool")
  - `unknown` / null → muted ("Unknown")
- **Compaction count** — count `pre_compact` events for this session; show `"Compacted N×"` only when N > 0, with tooltip explaining what compaction means.
- **Turn count** — count of `prompt_submit` events.

### 1.2 Timeline grouped by user turn
Replace the current flat vertical timeline. New structure:

```
▼ Turn 1  ·  12s  ·  7 tools  ·  4.2k tokens out
   ├─ Read    apps/app/src/parser.ts
   ├─ Grep    pattern="parseToken"
   ├─ Edit ×3 apps/app/src/parser.ts          (collapsed run)
   └─ Bash    bun test parser            1.4s
   stop: end_turn

▶ Turn 2  ·  4s  ·  1 tool  (collapsed)
```

Grouping algorithm (client-side after loading all events):
1. Sort by `seq`.
2. Walk events. Each `prompt_submit` starts a new turn group. Events before the first `prompt_submit` (e.g., `session_start`) go into a "Session start" group.
3. Each turn group accumulates: tool count, duration (last event ts − prompt ts), tokens (from the closing `assistant_stop`'s data), and stop reason.
4. Within a group, render events in order. **Collapse consecutive identical tool calls** into "Tool ×N" rows (display the first input_preview + count of repeats).

State: `expandedTurns: Set<number>` (default: expand the last turn; collapse older ones). Click chevron to expand/collapse.

### 1.3 Payload previews
For each tool event row, render a `<code>` snippet from `data.input_preview`. Smart-parse where useful:
- Read/Edit/Write/MultiEdit → extract `file_path` from the JSON preview, show as breadcrumb path.
- Bash → extract `command`, show truncated to fit.
- Grep → show `pattern` + `path`.
- Default → first 60 chars of the raw preview, monospace.

Helper lives in `apps/app/src/lib/events/preview.ts`.

### 1.4 Inline compaction markers
Where a `pre_compact` event falls in the timeline, render a horizontal divider with a "Context compacted" label instead of a normal event row.

### Files added/changed (Phase 1)
- `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx` — wire new components, no logic shift.
- `apps/app/src/components/sessions/timeline.tsx` *(new, client component)* — turn-grouped timeline.
- `apps/app/src/components/sessions/outcome-signals.tsx` *(new)* — stop reason badge, compaction count, turn count.
- `apps/app/src/lib/events/grouping.ts` *(new)* — pure functions: `groupEventsByTurn`, `collapseConsecutiveTools`.
- `apps/app/src/lib/events/preview.ts` *(new)* — pure: `parseInputPreview(toolName, raw)`.
- Unit tests for `grouping.ts` and `preview.ts` (integration tests not required — pure functions).

### Acceptance for Phase 1
- A session with N user turns shows N collapsible turn groups (plus a "Session start" group if applicable).
- Consecutive identical tool calls collapse into one row with ×N badge.
- Each tool row shows a payload preview (file path, command, or pattern as appropriate).
- Stop reason is visible at top of page.
- `pre_compact` events render as dividers, not rows.
- Existing parent/child subagent linking + agents block + KPI cards continue to work unchanged.

---

## Phase 2 — Interactive polish (UI-only)

**Scope:** second PR. All client-side, builds on Phase 1 components.

### 2.1 Filter + search bar
Above the timeline:
- **Search input** — substring match against `tool_name` and `data.input_preview`.
- **Event type chips** — toggles for `tool_use`, `skill_use`, `subagent_stop`, `pre_compact`, `prompt_submit`. All on by default.
- **Tool name multi-select** — populated from this session's unique tool names.

Filtering happens entirely in the client (events are already fully loaded). When a filter is active, the turn-group counts dim out and show "X of Y events" in the header.

### 2.2 Phase detection within a turn
For each turn group, classify events into phases by tool category:
- **Explore:** Read, Grep, Glob, LS, WebSearch, WebFetch
- **Implement:** Edit, Write, MultiEdit, NotebookEdit
- **Verify:** Bash (heuristic — when command matches `/test|lint|build|tsc|typecheck/i`), test-related skills

Render a small colored progress bar at the top of each expanded turn showing the proportion of time spent in each phase. Useful as an at-a-glance pattern.

Optional refinement (defer if time-pressed): label individual rows with a phase color dot.

### 2.3 Idle gap highlighting
Between `assistant_stop` (end of turn) and the next `prompt_submit` (start of next turn), if the gap > 30s, show a muted divider: `↕ User idle 4m 12s`. Helps distinguish "long session" from "long session with lots of human thinking time".

Within a turn, between `prompt_submit` and the first `tool_use`, show "Assistant first-token: 1.4s" if > 1s. (Latency signal.)

### Files added/changed (Phase 2)
- `apps/app/src/components/sessions/timeline-filters.tsx` *(new)*
- `apps/app/src/components/sessions/timeline.tsx` — add filter prop, phase bar, idle gap rendering
- `apps/app/src/lib/events/phase-detection.ts` *(new)* — pure: `classifyEventPhase(event)`

### Acceptance for Phase 2
- Typing in search instantly filters visible events.
- Toggling an event-type chip hides/shows matching rows.
- Each expanded turn shows a phase mini-bar.
- Gaps > 30s between turns render as labeled dividers.

---

## Phase 3 — True tool failures (plugin + UI)

**Scope:** plugin PR + app PR. Coordinated release.

### 3.1 Plugin change
In `claude-plugin/lib/telemetry.py`, update `sanitize_tool_result(tool_result)` to also extract:
- `is_error: bool` — read from `tool_result.is_error` (Claude Code passes this) OR detect from the structure (some hooks pass `{error: ...}`).

Update `claude-plugin/hooks/post_tool_use.py` to include `is_error` and (truncated) `error_preview` in the `tool_end` event data.

Bump plugin minor version. Add migration note that older plugin clients won't emit `is_error` (consumers must treat absence as "unknown").

### 3.2 API + service
No schema migration needed — `events.data` is `jsonb`. The new field flows in automatically.

Add a Supabase RPC `get_session_tool_failures(p_session_id text, p_user_id uuid)` returning per-session aggregates: total tool calls, error count, error rate, errored tool breakdown. This is faster than client-side aggregation when sessions have thousands of events.

Migration file: `supabase/migrations/022_session_tool_failures.sql`.

### 3.3 UI
- Add a **"Tool errors: N (X%)"** card to the outcome signals strip from Phase 1.
- In the timeline, mark errored tool rows with a destructive badge.
- In the filter bar (Phase 2), add a "Errors only" toggle.

### Files added/changed (Phase 3)
- `claude-plugin/lib/telemetry.py`
- `claude-plugin/hooks/post_tool_use.py`
- `claude-plugin/tests/test_telemetry.py` — add tests for `is_error` extraction
- `supabase/migrations/022_session_tool_failures.sql`
- `apps/app/src/components/sessions/outcome-signals.tsx` — add error count
- `apps/app/src/components/sessions/timeline.tsx` — mark errored rows
- `apps/app/src/lib/services/sessions.service.ts` — wrapper for the RPC

### Acceptance for Phase 3
- Plugin captures `is_error` for new sessions.
- Sessions with errored tool calls show "Tool errors: N" in the outcome strip.
- Errored tool rows have a red badge in the timeline.
- Older sessions (before plugin update) gracefully show no error data, not a broken UI.

---

## Sequencing recommendation

1. **Phase 1** — biggest UX win; fully UI-only; can ship behind no flag.
2. **Phase 2** — depends on Phase 1 components but is pure addition.
3. **Phase 3** — plugin release needed first, then app. Plan a deliberate release window.

Each phase is its own PR. After each phase ships, update `docs/features/sessions-timeline-outcomes/progress.md` and `docs/changelog.md` per the project's docs rule.

## Open questions
- Do we want to persist `expandedTurns` state across navigation (URL hash like `#turn=2`) so the user can deep-link / refresh without losing position? Default plan: no, keep it simple.
- Should idle gaps include time before the very first `prompt_submit` (i.e., session_start to first prompt)? Default plan: yes, label as "Session idle before first prompt".
- The "phase" classification for Bash is heuristic — if it proves noisy, fall back to "Run" as a neutral fourth category.

## Out of scope (captured elsewhere)
- First-prompt-as-session-title → `docs/backlog/enhancement-session-prompt-as-title.md`
- All Phase 5/6 items from the original brainstorm (component breakdowns, comparative context, actionable insights, etc.) — not addressed here.
