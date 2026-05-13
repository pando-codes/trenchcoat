# Theme 3 Executive Reporting Design

**Date:** 2026-05-12
**Scope:** Theme 3 — Executive and Budget Reporting
**Approach:** Tabbed team page (Overview + Members) with per-member breakdown, CSV export, and snapshot share links

---

## Background

Themes 1 and 2 gave individual engineers full visibility into their own sessions, tool usage, and cost. Theme 3 adds the team lens. The primary user is a **tech lead who is also an IC** — someone already living in the individual dashboard who needs to see their team's patterns alongside their own. They are not a detached manager; they want depth, comparison, and the ability to share a clean summary upward.

The existing `/teams/[id]` page shows four aggregate stat cards hardcoded to the last 30 days, with no trends, no cost, no per-member breakdown, and no date filtering. Theme 3 replaces this shell with a full analytics hub.

---

## Section 1: Team Page Tab Structure

The `/teams/[id]` route gains a `Tabs` component (shadcn, already available) with two tabs:

- **Overview** — all analytics: date-filtered stats, per-member breakdown, sessions trend, export/share
- **Members** — existing member list with invite/remove actions (unchanged)

The Overview tab is the default. The Members tab is the existing `TeamMembersClient` component, lifted into the tab slot with no functional changes.

The page header (team name, member count) stays above the tabs and is always visible. The Export dropdown lives in the page header, right-aligned, always visible regardless of active tab.

---

## Section 2: Overview Tab Content

Layout order: **Stat cards → Per-member table → Sessions trend chart**

This order puts the people-level view front and center, which matches how a tech lead thinks ("who's doing what?" before "how are we trending?").

### Stat Cards

Four cards, identical structure to the existing cards but now date-range aware:

| Card | Value |
|---|---|
| Sessions | Total sessions across all members in the date range |
| Total Cost | Sum of per-session cost across all members |
| Active Members | Members with ≥1 session / total members |
| Avg Duration | Mean session duration across the team |

Date range driven by the global topbar `?from=`/`?to=` params, falling back to last 30 days. Consistent with every other analytics page.

### Per-Member Table

A `TeamMemberStatsTable` client component rendered as a sortable table:

| Column | Notes |
|---|---|
| Member | Avatar + display_name |
| Sessions | Session count in date range |
| Cost | Total cost USD, formatted as `$0.0042` / `$1.23` |
| Top Tool | Most-used tool name by call count |
| Last Active | Date of most recent session, formatted as `May 11` |

- Sortable by Sessions (default, descending) and Cost
- Member name is a link to `/sessions?user_id=<id>` — navigates to the sessions list filtered to that member
- Members with no sessions in the date range still appear (sessions = 0, cost = `$0.00`, last active = `--`)
- Null cost (no token data) renders as `--`

### Sessions Trend Chart

A line chart of daily session counts aggregated across all team members, for the selected date range. Reuses the `DailyActivityChart` pattern and Recharts. No per-member stacking — team aggregate only.

---

## Section 3: Export Dropdown

A single **Export ▾** dropdown button in the page header (right-aligned, always visible). Two actions:

**Download CSV**
- Triggers client-side CSV generation from data already loaded on the page
- Filename: `<team-slug>-<from>-to-<to>.csv`
- Contents:
  ```
  Team: Acme Engineering
  Period: 2026-04-12 to 2026-05-12

  Member,Sessions,Cost (USD),Top Tool,Last Active
  Alex N.,82,12.10,Bash,2026-05-11
  Sarah K.,61,9.40,Read,2026-05-10
  ...

  Total,284,38.42,,
  ```

**Copy share link**
- Calls a server action `createTeamShare(teamId, from, to)`
- Action captures current analytics snapshot and inserts into `team_shares`
- Returns a token-based URL: `https://app.trenchcoat.com/share/<token>`
- URL is copied to clipboard; a toast confirms "Link copied"

---

## Section 4: Snapshot Share Links

### Data Model — `team_shares` table (migration `015_team_shares.sql`)

```sql
create table public.team_shares (
  id           uuid primary key default gen_random_uuid(),
  team_id      uuid not null references public.teams(id) on delete cascade,
  token        text unique not null default encode(gen_random_bytes(16), 'hex'),
  created_by   uuid not null references auth.users(id),
  date_from    date not null,
  date_to      date not null,
  snapshot     jsonb not null,
  created_at   timestamptz not null default now()
);
```

**RLS policies:**
- `SELECT`: public (no auth required) — anyone with a token can read the row
- `INSERT`: authenticated users who are members of `team_id`
- No `UPDATE` or `DELETE` exposed (shares are immutable once created)

**Snapshot JSONB shape:**
```json
{
  "team": { "name": "Acme Engineering", "slug": "acme-eng" },
  "stats": { "total_sessions": 284, "total_cost_usd": 38.42, "active_members": 5, "total_members": 6, "avg_duration_min": 24 },
  "members": [
    { "display_name": "Alex N.", "sessions": 82, "cost_usd": 12.10, "top_tool": "Bash", "last_active": "2026-05-11" }
  ],
  "trend": [
    { "date": "2026-04-12", "sessions": 8 }
  ],
  "shared_by": "Alex Noboa",
  "captured_at": "2026-05-12T14:30:00Z"
}
```

### Server Action — `createTeamShare`

Located in `apps/app/src/lib/actions/teams.actions.ts`:

1. Verify the requesting user is a member of `teamId`
2. Call `get_team_overview_stats`, `get_team_member_stats`, `get_team_trend` with the given date range
3. Bundle into snapshot JSONB
4. Insert into `team_shares`
5. Return `{ token }`

### Public Route — `/share/[token]`

A new public page at `apps/app/src/app/share/[token]/page.tsx`:

- No auth check — accessible to anyone with the link
- Reads `team_shares` using the admin Supabase client (bypasses RLS for the read; the RLS public SELECT policy handles authorization conceptually, but server-side we use admin to avoid cookie dependency)
- Renders from snapshot JSONB — no live DB queries for analytics data
- Layout:
  - Minimal Trenchcoat wordmark (no sidebar, no topbar)
  - Team name + date range + "Shared by [name]" subheader
  - Stat cards (read from snapshot)
  - Per-member table (read-only, no member name links)
  - Sessions trend chart (rendered from snapshot trend array)
  - Footer: "Snapshot captured [date]" + "Get Trenchcoat →" CTA

---

## Section 5: Database Changes

### Migration `014_team_analytics.sql`

**`get_team_member_stats(p_team_id uuid, p_from date, p_to date)`**

Returns one row per team member:
```
{ user_id, display_name, avatar_url, sessions, total_cost_usd, top_tool, last_active }
```

- Joins `team_members` → `user_profiles` for names
- Joins `sessions` (filtered by `user_id` in team and `started_at` in date range) for session count and tokens
- Joins `model_pricing` for cost computation
- Top tool: subquery on `events` of type `tool_use` grouped by `tool_name`, limit 1
- All members returned even if sessions = 0 (LEFT JOIN)

**`get_team_trend(p_team_id uuid, p_from date, p_to date)`**

Returns one row per day:
```
{ date, sessions }
```

- Aggregates session counts across all team members per calendar day
- Uses `generate_series` to fill gaps with 0

**Update team detail page** to pass `?from=`/`?to=` search params to `get_team_overview_stats` instead of the hardcoded 30-day window.

### Migration `015_team_shares.sql`

Creates `team_shares` table and RLS policies as described in Section 4.

---

## Section 6: New Components and Files

| File | Purpose |
|---|---|
| `apps/app/src/app/(dashboard)/teams/[id]/page.tsx` | Add Tabs, wire Overview tab, pass date params |
| `apps/app/src/components/teams/team-overview-tab.tsx` | Overview tab layout (stat cards + member table + trend) |
| `apps/app/src/components/teams/team-member-stats-table.tsx` | Sortable per-member table |
| `apps/app/src/components/charts/team-trend-chart.tsx` | Team sessions trend line chart |
| `apps/app/src/app/share/[token]/page.tsx` | Public snapshot page |
| `apps/app/src/lib/actions/teams.actions.ts` | Add `createTeamShare` server action |
| `supabase/migrations/014_team_analytics.sql` | New team analytics RPCs |
| `supabase/migrations/015_team_shares.sql` | team_shares table + RLS |

---

## What This Does Not Include

- Budget alerts or spending limits
- Share link expiry or revocation UI
- Per-member tool drill-down beyond the single top tool
- Team-level Agents or Tools pages (would mirror individual pages scoped to a team — deferred)
- Multi-team aggregate view (deferred)
- PDF export
