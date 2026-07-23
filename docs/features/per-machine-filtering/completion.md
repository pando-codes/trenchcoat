# Per-Machine Filtering — Completion

## Delivered

End-to-end filtering of the dashboard by machine/environment, using the API key as the
machine identity. Verified: `bunx tsc` clean on all touched files; `bun test` 441/441 pass;
eslint clean.

### Code (applied)
- **Schema/RPCs:** `supabase/migrations/035_session_api_key.sql` — `sessions.api_key_id` + index;
  `p_api_key_id` added to 8 RPCs; 3 new `*_for_key` RPCs for the `daily_aggregates` bypass.
- **Write path:** `events/route.ts` passes `context.apiKey.id`; `events.service.ts` stamps it on
  session insert, back-fills NULLs on update.
- **Read services:** `analytics.service.ts` (overview, daily activity, top tools, heatmap, top
  agents, agent timeseries), `sessions.service.ts` (`listSessions`), `evals.service.ts`.
- **UI:** new `components/dashboard/machine-filter.tsx`; wired into `topbar.tsx`; machine list fed
  from `(dashboard)/layout.tsx` via `listApiKeys`. Pages threaded: overview, activity, tools,
  agents, agents/[type], cost, skills, sessions, evals.
- **API routes:** `/api/v1/sessions`, `/api/v1/analytics/overview`, `/api/v1/analytics/tools`.
- **Types:** `types/supabase.ts` — `sessions.api_key_id`, optional `p_api_key_id` on the edited
  RPCs, and the 3 new function signatures.

## SQL validation (done — 2026-07-23)

Migration `035` was applied and smoke-tested on a throwaway Supabase dev branch (created,
tested, deleted; ~$0.01). Result: **all 13 functions execute and filter correctly.** Seeded two
machines (keys) with one session + events each and confirmed every filtered RPC isolates exactly
one machine, the `null` path returns all machines, and cost/duration math is right (e.g.
`get_daily_cost` → $0.0105 for 1000 in / 500 out at test-model rates; filtered `get_overview_stats`
→ sessions 1, events 5, tool_uses 2, agent_calls 1).

**Bug found and fixed during validation:** adding `p_api_key_id` changes each function's arity, so
`create or replace` *overloaded* the old definitions instead of replacing them — leaving the
pre-035 signatures live and making old-arity calls ambiguous (`function ... is not unique`). Fixed
by adding explicit `drop function if exists` for the 8 prior signatures at the top of the
migration, before the recreates. Re-verified each name resolves to exactly one overload.

## Production apply (done — 2026-07-23)

Migration `035` applied to production (`mqdkmtkgbkbbfbiykwxx`). Verified post-apply:
`sessions.api_key_id` (uuid, nullable) + `idx_sessions_user_api_key` present; all 11 RPCs resolve
to exactly one signature carrying `p_api_key_id` (no stale overloads). Existing sessions are NULL
(unattributed) until re-touched by a keyed ingest batch — expected.

## Remaining before ship

1. **Name each API key after its machine** in the dashboard (Settings → API keys). The filter
   labels by key name; unnamed/duplicate names read poorly.
2. Regenerate `types/supabase.ts` from the live schema to replace the hand edits (optional; the
   hand edits already match the applied schema).
3. Deploy the app (the frontend/API changes) so the dashboard filter goes live.

## Known divergence

Unfiltered overview sums per-day metrics from `daily_aggregates`; the filtered recompute uses
whole-range semantics (e.g. distinct sessions across the range, not summed per-day distincts).
Single-machine totals may differ slightly from the all-machines view. Documented in `planning.md`.
</content>
