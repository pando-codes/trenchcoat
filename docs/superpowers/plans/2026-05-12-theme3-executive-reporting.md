# Theme 3 Executive Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add team analytics to `/teams/[id]` — tabbed layout with per-member breakdown, date filtering, CSV export, and snapshot-based shareable links with a public `/share/[token]` read-only view.

**Architecture:** The existing team detail page gains a `Tabs` component splitting Overview (analytics) from Members (management). A new `team_shares` table stores JSONB snapshots at share time; the public share route reads directly from that snapshot without re-querying analytics. All analytics queries use two new Supabase RPCs (`get_team_member_stats`, `get_team_trend`) alongside the existing `get_team_overview_stats`.

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres RPCs + RLS), Recharts, shadcn/ui Tabs + DropdownMenu + Table, Bun workspaces monorepo.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `supabase/migrations/014_team_analytics.sql` | `get_team_member_stats` and `get_team_trend` RPCs |
| Create | `supabase/migrations/015_team_shares.sql` | `team_shares` table + RLS policies |
| Modify | `apps/app/src/types/teams.ts` | Add `TeamMemberStat`, `TeamTrendPoint`, `TeamShareSnapshot` |
| Create | `apps/app/src/components/charts/team-trend-chart.tsx` | Area chart for team sessions over time |
| Create | `apps/app/src/components/teams/team-member-stats-table.tsx` | Sortable per-member analytics table |
| Create | `apps/app/src/components/teams/team-export-dropdown.tsx` | "Export ▾" dropdown: CSV download + share link |
| Create | `apps/app/src/components/teams/team-overview-tab.tsx` | Assembles stat cards + member table + trend chart |
| Modify | `apps/app/src/app/(dashboard)/teams/[id]/page.tsx` | Add Tabs, wire Overview tab, read date params |
| Modify | `apps/app/src/app/(dashboard)/sessions/page.tsx` | Support `?user_id=` filter for team member drill-down |
| Modify | `apps/app/src/lib/actions/teams.actions.ts` | Add `createTeamShareAction` server action |
| Create | `apps/app/src/app/share/[token]/page.tsx` | Public snapshot page (no auth) |

---

## Task 1: Migration 014 — Team Analytics RPCs

**Files:**
- Create: `supabase/migrations/014_team_analytics.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/014_team_analytics.sql

-- Per-member stats for a team over a date range.
-- Returns all team members including those with zero sessions.
create or replace function public.get_team_member_stats(
  p_team_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  user_id        uuid,
  display_name   text,
  avatar_url     text,
  sessions       bigint,
  total_cost_usd numeric,
  top_tool       text,
  last_active    date
)
language sql
stable
security definer
as $$
  with member_sessions as (
    select
      tm.user_id,
      count(s.id)                                                        as sessions,
      coalesce(sum(
        (coalesce(s.input_tokens,  0)::numeric * coalesce(mp.input_cost_per_1m,  0) +
         coalesce(s.output_tokens, 0)::numeric * coalesce(mp.output_cost_per_1m, 0))
        / 1000000
      ), 0)                                                              as total_cost_usd,
      max(s.started_at::date)                                            as last_active
    from public.team_members tm
    left join public.sessions s
      on  s.user_id     = tm.user_id
      and s.started_at::date >= p_from
      and s.started_at::date <= p_to
    left join public.model_pricing mp on mp.model_id = s.model
    where tm.team_id = p_team_id
    group by tm.user_id
  ),
  member_top_tools as (
    select
      tm.user_id,
      (e.data->>'tool_name')                                             as tool_name,
      row_number() over (
        partition by tm.user_id
        order by count(*) desc
      )                                                                  as rn
    from public.team_members tm
    join public.sessions s
      on  s.user_id     = tm.user_id
      and s.started_at::date >= p_from
      and s.started_at::date <= p_to
    join public.events e
      on  e.session_id  = s.id
      and e.type        = 'tool_use'
    where tm.team_id = p_team_id
    group by tm.user_id, e.data->>'tool_name'
  )
  select
    ms.user_id,
    up.display_name,
    up.avatar_url,
    ms.sessions,
    ms.total_cost_usd,
    mtt.tool_name  as top_tool,
    ms.last_active
  from member_sessions ms
  left join public.user_profiles up  on up.user_id  = ms.user_id
  left join member_top_tools     mtt on mtt.user_id = ms.user_id and mtt.rn = 1
  order by ms.sessions desc;
$$;

-- Daily session counts for all team members, with gap-filling.
create or replace function public.get_team_trend(
  p_team_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  date     date,
  sessions bigint
)
language sql
stable
security definer
as $$
  select
    d.day::date                                     as date,
    count(s.id)                                     as sessions
  from generate_series(p_from::timestamp, p_to::timestamp, '1 day'::interval) as d(day)
  left join public.sessions s
    on  s.started_at::date = d.day::date
    and s.user_id in (
      select user_id from public.team_members where team_id = p_team_id
    )
  group by d.day::date
  order by d.day::date;
$$;
```

- [ ] **Step 2: Apply to Supabase**

```bash
cd /Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app
npx supabase db push
```

Expected: migration applies with no errors. If `supabase` CLI isn't available, apply via the Supabase dashboard SQL editor.

- [ ] **Step 3: Smoke-test the RPCs in the Supabase SQL editor**

Run with a real team ID from your `team_members` table:
```sql
select * from get_team_member_stats('<your-team-id>'::uuid, current_date - 30, current_date);
select * from get_team_trend('<your-team-id>'::uuid, current_date - 30, current_date);
```

Expected: both return rows (possibly all zeros if no sessions, but no errors).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/014_team_analytics.sql
git commit -m "feat(db): add get_team_member_stats and get_team_trend RPCs"
```

---

## Task 2: Migration 015 — team_shares Table

**Files:**
- Create: `supabase/migrations/015_team_shares.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/015_team_shares.sql

create table public.team_shares (
  id          uuid        primary key default gen_random_uuid(),
  team_id     uuid        not null references public.teams(id) on delete cascade,
  token       text        unique not null default encode(gen_random_bytes(16), 'hex'),
  created_by  uuid        not null references auth.users(id),
  date_from   date        not null,
  date_to     date        not null,
  snapshot    jsonb       not null,
  created_at  timestamptz not null default now()
);

alter table public.team_shares enable row level security;

-- Anyone with a token can read the snapshot (no auth required).
create policy "Public read by token"
  on public.team_shares for select
  using (true);

-- Only authenticated team members may create shares.
create policy "Team members can create shares"
  on public.team_shares for insert
  with check (
    auth.uid() is not null
    and auth.uid() in (
      select user_id from public.team_members where team_id = team_shares.team_id
    )
  );
```

- [ ] **Step 2: Apply to Supabase**

```bash
npx supabase db push
```

Expected: `team_shares` table appears in Supabase dashboard with two RLS policies.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/015_team_shares.sql
git commit -m "feat(db): add team_shares table with public read RLS"
```

---

## Task 3: TypeScript Types

**Files:**
- Modify: `apps/app/src/types/teams.ts`

- [ ] **Step 1: Add new types to `teams.ts`**

Append to the end of the file:

```typescript
export interface TeamMemberStat {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  sessions: number;
  total_cost_usd: number;
  top_tool: string | null;
  last_active: string | null; // YYYY-MM-DD
}

export interface TeamTrendPoint {
  date: string; // YYYY-MM-DD
  sessions: number;
}

export interface TeamShareSnapshot {
  team: { name: string; slug: string };
  stats: {
    total_sessions: number;
    total_cost_usd: number;
    active_members: number;
    total_members: number;
    avg_session_duration_min: number;
  };
  members: TeamMemberStat[];
  trend: TeamTrendPoint[];
  shared_by: string;
  captured_at: string; // ISO timestamp
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors related to `types/teams.ts`.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/types/teams.ts
git commit -m "feat(types): add TeamMemberStat, TeamTrendPoint, TeamShareSnapshot"
```

---

## Task 4: TeamTrendChart Component

**Files:**
- Create: `apps/app/src/components/charts/team-trend-chart.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/app/src/components/charts/team-trend-chart.tsx
"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { TeamTrendPoint } from "@/types/teams";

interface TeamTrendChartProps {
  data: TeamTrendPoint[];
}

export function TeamTrendChart({ data }: TeamTrendChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
        No activity data available.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorTeamSessions" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="var(--color-chart-1)" stopOpacity={0.3} />
            <stop offset="95%" stopColor="var(--color-chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
        <XAxis
          dataKey="date"
          tickFormatter={(value: string) => {
            const d = new Date(value);
            return `${d.getMonth() + 1}/${d.getDate()}`;
          }}
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <YAxis
          allowDecimals={false}
          className="text-xs"
          tick={{ fill: "var(--color-muted-foreground)" }}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            color: "var(--color-popover-foreground)",
          }}
        />
        <Area
          type="monotone"
          dataKey="sessions"
          stroke="var(--color-chart-1)"
          fillOpacity={1}
          fill="url(#colorTeamSessions)"
          name="Sessions"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/charts/team-trend-chart.tsx
git commit -m "feat(charts): add TeamTrendChart area chart component"
```

---

## Task 5: TeamMemberStatsTable Component

**Files:**
- Create: `apps/app/src/components/teams/team-member-stats-table.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/app/src/components/teams/team-member-stats-table.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatCost } from "@/lib/cost";
import type { TeamMemberStat } from "@/types/teams";

type SortKey = "sessions" | "total_cost_usd";

interface TeamMemberStatsTableProps {
  members: TeamMemberStat[];
}

export function TeamMemberStatsTable({ members }: TeamMemberStatsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("sessions");

  const sorted = [...members].sort((a, b) => b[sortKey] - a[sortKey]);

  function formatLastActive(date: string | null): string {
    if (!date) return "--";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day:   "numeric",
    });
  }

  function SortHeader({
    label,
    field,
  }: {
    label: string;
    field: SortKey;
  }) {
    return (
      <TableHead
        className="cursor-pointer select-none text-right"
        onClick={() => setSortKey(field)}
      >
        {label} {sortKey === field ? "↓" : ""}
      </TableHead>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <SortHeader label="Sessions" field="sessions" />
          <SortHeader label="Cost"     field="total_cost_usd" />
          <TableHead className="text-right">Top Tool</TableHead>
          <TableHead className="text-right">Last Active</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="text-center text-muted-foreground">
              No members found.
            </TableCell>
          </TableRow>
        ) : (
          sorted.map((m) => (
            <TableRow key={m.user_id}>
              <TableCell className="font-medium">
                <Link
                  href={`/sessions?user_id=${m.user_id}`}
                  className="hover:underline underline-offset-4"
                >
                  {m.display_name ?? "Unknown"}
                </Link>
              </TableCell>
              <TableCell className="text-right">{m.sessions}</TableCell>
              <TableCell className="text-right font-mono text-sm">
                {formatCost(m.total_cost_usd)}
              </TableCell>
              <TableCell className="text-right">
                {m.top_tool ?? "--"}
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatLastActive(m.last_active)}
              </TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/teams/team-member-stats-table.tsx
git commit -m "feat(teams): add TeamMemberStatsTable sortable component"
```

---

## Task 6: createTeamShareAction Server Action

**Files:**
- Modify: `apps/app/src/lib/actions/teams.actions.ts`

- [ ] **Step 1: Add the import and action to `teams.actions.ts`**

Add this import at the top of the file (after the existing `"use server"` and `createClient` import):

```typescript
import { getAdminClient } from "@/lib/supabase/admin";
import type { TeamShareSnapshot, TeamMemberStat, TeamTrendPoint } from "@/types/teams";
```

Then append the following function to the bottom of the file:

```typescript
export async function createTeamShareAction(
  teamId:   string,
  dateFrom: string,
  dateTo:   string,
): Promise<ActionResult<{ token: string; url: string }>> {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "Not authenticated" };

  // Verify caller is a team member.
  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", user.id)
    .single();
  if (!membership) return { success: false, error: "Not a team member" };

  const { data: team } = await supabase
    .from("teams")
    .select("name, slug")
    .eq("id", teamId)
    .single();
  if (!team) return { success: false, error: "Team not found" };

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("display_name")
    .eq("user_id", user.id)
    .single();

  const admin = getAdminClient();

  const [overviewRes, membersRes, trendRes] = await Promise.all([
    admin.rpc("get_team_overview_stats", {
      p_team_id: teamId,
      p_from:    dateFrom,
      p_to:      dateTo,
    }),
    admin.rpc("get_team_member_stats", {
      p_team_id: teamId,
      p_from:    dateFrom,
      p_to:      dateTo,
    }),
    admin.rpc("get_team_trend", {
      p_team_id: teamId,
      p_from:    dateFrom,
      p_to:      dateTo,
    }),
  ]);

  const rawStats = overviewRes.data as Record<string, number> | null;
  const totalCost = ((membersRes.data as TeamMemberStat[]) ?? []).reduce(
    (sum, m) => sum + (m.total_cost_usd ?? 0), 0
  );

  const snapshot: TeamShareSnapshot = {
    team:  { name: team.name, slug: team.slug },
    stats: {
      total_sessions:        rawStats?.total_sessions        ?? 0,
      total_cost_usd:        totalCost,
      active_members:        rawStats?.active_members        ?? 0,
      total_members:         rawStats?.total_members         ?? 0,
      avg_session_duration_min: rawStats?.avg_session_duration_min ?? 0,
    },
    members:     (membersRes.data as TeamMemberStat[]) ?? [],
    trend:       (trendRes.data  as TeamTrendPoint[])  ?? [],
    shared_by:   profile?.display_name ?? user.email ?? "Unknown",
    captured_at: new Date().toISOString(),
  };

  const { data: share, error: insertError } = await admin
    .from("team_shares")
    .insert({ team_id: teamId, created_by: user.id, date_from: dateFrom, date_to: dateTo, snapshot })
    .select("token")
    .single();

  if (insertError || !share) {
    return { success: false, error: "Failed to create share link" };
  }

  const url = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.trenchcoat.com"}/share/${share.token}`;
  return { success: true, data: { token: share.token, url } };
}
```

- [ ] **Step 2: Add `NEXT_PUBLIC_APP_URL` to `.env.local.example`**

Open `apps/app/.env.local.example` and add:
```
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Also add it to your local `apps/app/.env.local`:
```
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

- [ ] **Step 3: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/lib/actions/teams.actions.ts apps/app/.env.local.example
git commit -m "feat(actions): add createTeamShareAction for snapshot share links"
```

---

## Task 7: TeamExportDropdown Component

**Files:**
- Create: `apps/app/src/components/teams/team-export-dropdown.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/app/src/components/teams/team-export-dropdown.tsx
"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createTeamShareAction } from "@/lib/actions/teams.actions";
import { formatCost } from "@/lib/cost";
import type { TeamMemberStat } from "@/types/teams";

interface TeamExportDropdownProps {
  teamId:   string;
  teamName: string;
  teamSlug: string;
  dateFrom: string;
  dateTo:   string;
  members:  TeamMemberStat[];
  totalSessions: number;
}

export function TeamExportDropdown({
  teamId, teamName, teamSlug, dateFrom, dateTo, members, totalSessions,
}: TeamExportDropdownProps) {
  const [sharing, setSharing] = useState(false);

  function downloadCsv() {
    const totalCost = members.reduce((sum, m) => sum + (m.total_cost_usd ?? 0), 0);

    const rows: string[][] = [
      [`Team: ${teamName}`],
      [`Period: ${dateFrom} to ${dateTo}`],
      [],
      ["Member", "Sessions", "Cost (USD)", "Top Tool", "Last Active"],
      ...members.map((m) => [
        m.display_name ?? "Unknown",
        String(m.sessions),
        m.total_cost_usd != null ? m.total_cost_usd.toFixed(4) : "0.0000",
        m.top_tool ?? "--",
        m.last_active ?? "--",
      ]),
      [],
      ["Total", String(totalSessions), totalCost.toFixed(4), "", ""],
    ];

    const csv = rows
      .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = `${teamSlug}-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyShareLink() {
    setSharing(true);
    try {
      const result = await createTeamShareAction(teamId, dateFrom, dateTo);
      if (result.success) {
        await navigator.clipboard.writeText(result.data.url);
        // Brief visual feedback via window title (avoids alert dialogs).
        const prev = document.title;
        document.title = "✓ Link copied!";
        setTimeout(() => { document.title = prev; }, 2000);
      }
    } finally {
      setSharing(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          Export <ChevronDown className="ml-1 h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={downloadCsv}>
          Download CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={copyShareLink} disabled={sharing}>
          {sharing ? "Creating link…" : "Copy share link"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/teams/team-export-dropdown.tsx
git commit -m "feat(teams): add TeamExportDropdown with CSV download and share link"
```

---

## Task 8: TeamOverviewTab Component

**Files:**
- Create: `apps/app/src/components/teams/team-overview-tab.tsx`

- [ ] **Step 1: Create the component**

```tsx
// apps/app/src/components/teams/team-overview-tab.tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TeamMemberStatsTable } from "@/components/teams/team-member-stats-table";
import { TeamTrendChart } from "@/components/charts/team-trend-chart";
import { formatCost } from "@/lib/cost";
import type { TeamMemberStat, TeamTrendPoint } from "@/types/teams";

interface TeamOverviewTabProps {
  stats: {
    total_sessions:           number;
    active_members:           number;
    total_members:            number;
    avg_session_duration_min: number;
  };
  members: TeamMemberStat[];
  trend:   TeamTrendPoint[];
}

export function TeamOverviewTab({ stats, members, trend }: TeamOverviewTabProps) {
  const totalCostUsd = members.reduce((sum, m) => sum + (m.total_cost_usd ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total_sessions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCost(totalCostUsd)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {stats.active_members}/{stats.total_members}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.avg_session_duration_min}m</div>
          </CardContent>
        </Card>
      </div>

      {/* Per-member table */}
      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamMemberStatsTable members={members} />
        </CardContent>
      </Card>

      {/* Sessions trend */}
      <Card>
        <CardHeader>
          <CardTitle>Sessions over time</CardTitle>
        </CardHeader>
        <CardContent>
          <TeamTrendChart data={trend} />
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/teams/team-overview-tab.tsx
git commit -m "feat(teams): add TeamOverviewTab layout component"
```

---

## Task 9: Update Team Detail Page

**Files:**
- Modify: `apps/app/src/app/(dashboard)/teams/[id]/page.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
// apps/app/src/app/(dashboard)/teams/[id]/page.tsx
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { parseDateRange } from "@/lib/date-range";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamOverviewTab } from "@/components/teams/team-overview-tab";
import { TeamMembersClient } from "@/components/teams/team-members-client";
import { TeamExportDropdown } from "@/components/teams/team-export-dropdown";
import type { TeamMemberStat, TeamTrendPoint } from "@/types/teams";

export default async function TeamDetailPage({
  params,
  searchParams,
}: {
  params:       Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { id }      = await params;
  const { from, to } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", id)
    .eq("user_id", user.id)
    .single();
  if (!membership) notFound();

  const { data: team } = await supabase
    .from("teams")
    .select("*")
    .eq("id", id)
    .single();
  if (!team) notFound();

  const { data: members } = await supabase
    .from("team_members")
    .select("id, user_id, role, joined_at, user_profiles(display_name, email, avatar_url)")
    .eq("team_id", id)
    .order("joined_at", { ascending: true });

  const admin = getAdminClient();

  const [overviewRes, memberStatsRes, trendRes] = await Promise.all([
    admin.rpc("get_team_overview_stats", {
      p_team_id: id,
      p_from:    p_from,
      p_to:      p_to,
    }),
    admin.rpc("get_team_member_stats", {
      p_team_id: id,
      p_from:    p_from,
      p_to:      p_to,
    }),
    admin.rpc("get_team_trend", {
      p_team_id: id,
      p_from:    p_from,
      p_to:      p_to,
    }),
  ]);

  const overviewStats = overviewRes.data as {
    total_sessions: number;
    total_events: number;
    total_tool_uses: number;
    active_members: number;
    total_members: number;
    avg_session_duration_min: number;
  } | null ?? {
    total_sessions: 0, total_events: 0, total_tool_uses: 0,
    active_members: 0, total_members: members?.length ?? 0,
    avg_session_duration_min: 0,
  };

  const memberStats: TeamMemberStat[] = (memberStatsRes.data as TeamMemberStat[]) ?? [];
  const trend:       TeamTrendPoint[] = (trendRes.data  as TeamTrendPoint[]) ?? [];

  const formattedMembers = (members ?? []).map((m) => ({
    id:           m.id,
    user_id:      m.user_id,
    role:         m.role as string,
    joined_at:    m.joined_at as string,
    display_name: (m.user_profiles as unknown as Record<string, unknown>)?.display_name as string ?? "Unknown",
    email:        (m.user_profiles as unknown as Record<string, unknown>)?.email        as string ?? "",
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
          <p className="text-muted-foreground">{formattedMembers.length} members</p>
        </div>
        <TeamExportDropdown
          teamId={id}
          teamName={team.name}
          teamSlug={team.slug}
          dateFrom={p_from}
          dateTo={p_to}
          members={memberStats}
          totalSessions={overviewStats.total_sessions}
        />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6">
          <TeamOverviewTab
            stats={overviewStats}
            members={memberStats}
            trend={trend}
          />
        </TabsContent>

        <TabsContent value="members" className="mt-6">
          <TeamMembersClient
            teamId={id}
            members={formattedMembers}
            currentUserRole={membership.role as string}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Start dev server and verify**

```bash
cd /Users/noboa/Business/Pando/trenchcoat/Engineering/trenchcoat-app
bun run dev:app
```

Open http://localhost:3000, navigate to Teams → a team. Verify:
- Overview tab shows 4 stat cards, per-member table, trend chart
- Members tab shows existing member list with invite/remove
- Export button is present in the header
- Changing date range via topbar updates all Overview stats

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app/(dashboard)/teams/[id]/page.tsx
git commit -m "feat(teams): add tabbed overview with analytics, export, and date filtering"
```

---

## Task 10: Sessions Page user_id Filter

**Files:**
- Create: `supabase/migrations/016_check_shared_team.sql`
- Modify: `apps/app/src/app/(dashboard)/sessions/page.tsx`

- [ ] **Step 1: Write migration 016**

```sql
-- supabase/migrations/016_check_shared_team.sql
-- Returns true if user_a and user_b share at least one team.
create or replace function public.check_shared_team(
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.team_members a
    join public.team_members b on b.team_id = a.team_id
    where a.user_id = p_user_a
      and b.user_id = p_user_b
  );
$$;
```

Apply:
```bash
npx supabase db push
```

Expected: migration applies with no errors.

- [ ] **Step 2: Update `sessions/page.tsx`**

Replace the file in full:

```tsx
// apps/app/src/app/(dashboard)/sessions/page.tsx
import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { computeCost, formatCost, type RateMap } from "@/lib/cost";
import { SessionFilters } from "@/components/dashboard/session-filters";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import type { SessionSummary } from "@/types/analytics";

interface SessionsPageProps {
  searchParams: Promise<{
    page?:    string;
    branch?:  string;
    from?:    string;
    to?:      string;
    user_id?: string;
  }>;
}

const PAGE_SIZE = 20;

function formatDuration(ms: number | null): string {
  if (ms === null) return "--";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month:  "short",
    day:    "numeric",
    hour:   "2-digit",
    minute: "2-digit",
  });
}

export default async function SessionsPage({ searchParams }: SessionsPageProps) {
  const params   = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const page   = Math.max(1, parseInt(params.page ?? "1", 10));
  const branch = params.branch   ?? undefined;
  const from   = params.from     ?? undefined;
  const to     = params.to       ?? undefined;
  const offset = (page - 1) * PAGE_SIZE;

  const { p_from, p_to } = parseDateRange(from, to);

  // If user_id param is present and refers to a different user, verify they
  // share a team before allowing the cross-user session view.
  const targetUserId = params.user_id;
  let viewUserId = user.id;
  if (targetUserId && targetUserId !== user.id) {
    const { data: shared } = await supabase.rpc("check_shared_team", {
      p_user_a: user.id,
      p_user_b: targetUserId,
    });
    if (shared) viewUserId = targetUserId;
  }

  const [branchesResult, sessionsResult, pricingResult] = await Promise.all([
    supabase
      .from("sessions")
      .select("git_branch")
      .eq("user_id", viewUserId)
      .not("git_branch", "is", null)
      .order("git_branch", { ascending: true }),
    (() => {
      let query = supabase
        .from("sessions")
        .select("*", { count: "exact" })
        .eq("user_id", viewUserId)
        .gte("started_at", p_from)
        .lte("started_at", p_to + "T23:59:59.999Z")
        .order("started_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);
      if (branch) query = query.eq("git_branch", branch);
      return query;
    })(),
    supabase.from("model_pricing").select("model_id, input_cost_per_1m, output_cost_per_1m"),
  ]);

  const branches: string[] = [
    ...new Set(
      (branchesResult.data ?? []).map((r) => r.git_branch as string)
    ),
  ].sort();

  const sessions:    SessionSummary[] = sessionsResult.data ?? [];
  const totalPages = Math.ceil((sessionsResult.count ?? 0) / PAGE_SIZE);

  const rates: RateMap = Object.fromEntries(
    ((pricingResult.data ?? []) as {
      model_id: string;
      input_cost_per_1m: number;
      output_cost_per_1m: number;
    }[]).map((r) => [
      r.model_id,
      { input_cost_per_1m: r.input_cost_per_1m, output_cost_per_1m: r.output_cost_per_1m },
    ])
  );

  function buildPageUrl(p: number): string {
    const ps = new URLSearchParams();
    if (from)         ps.set("from",    from);
    if (to)           ps.set("to",      to);
    if (branch)       ps.set("branch",  branch);
    if (targetUserId) ps.set("user_id", targetUserId);
    ps.set("page", String(p));
    return `/sessions?${ps.toString()}`;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="text-sm text-muted-foreground">
          {viewUserId !== user.id
            ? "Viewing a team member's sessions."
            : "Browse your Claude Code sessions."}
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>All Sessions</CardTitle>
          <Suspense fallback={null}>
            <SessionFilters branches={branches} currentBranch={branch ?? null} />
          </Suspense>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead className="text-right">Events</TableHead>
                <TableHead className="text-right">Tools</TableHead>
                <TableHead>Branch</TableHead>
                <TableHead className="text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No sessions found.
                  </TableCell>
                </TableRow>
              ) : (
                sessions.map((session) => (
                  <TableRow key={session.id}>
                    <TableCell>
                      <Link
                        href={`/sessions/${session.id}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {formatDate(session.started_at)}
                      </Link>
                    </TableCell>
                    <TableCell>{formatDuration(session.duration_ms)}</TableCell>
                    <TableCell className="text-right">{session.event_count}</TableCell>
                    <TableCell className="text-right">{session.tool_count}</TableCell>
                    <TableCell>
                      {session.git_branch ? (
                        <Badge variant="secondary">{session.git_branch}</Badge>
                      ) : (
                        <span className="text-muted-foreground">--</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCost(computeCost(
                        session.input_tokens  ?? null,
                        session.output_tokens ?? null,
                        session.model         ?? null,
                        rates,
                      ))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              {page > 1 && (
                <Link href={buildPageUrl(page - 1)} className="text-sm text-primary underline-offset-4 hover:underline">
                  Previous
                </Link>
              )}
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              {page < totalPages && (
                <Link href={buildPageUrl(page + 1)} className="text-sm text-primary underline-offset-4 hover:underline">
                  Next
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Verify drill-down**

Start the dev server (`bun run dev:app`), navigate to a team page, click a member name in the per-member table. Verify the sessions page opens showing that member's sessions (subtitle reads "Viewing a team member's sessions.").

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/016_check_shared_team.sql apps/app/src/app/(dashboard)/sessions/page.tsx
git commit -m "feat(sessions): add user_id filter for team member drill-down"
```

---

## Task 11: Public Share Page

**Files:**
- Create: `apps/app/src/app/share/[token]/page.tsx`

- [ ] **Step 1: Create the directory and page**

```tsx
// apps/app/src/app/share/[token]/page.tsx
import { notFound } from "next/navigation";
import { getAdminClient } from "@/lib/supabase/admin";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { TeamTrendChart } from "@/components/charts/team-trend-chart";
import { formatCost } from "@/lib/cost";
import type { TeamShareSnapshot, TeamMemberStat } from "@/types/teams";

export default async function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const admin = getAdminClient();
  const { data: share } = await admin
    .from("team_shares")
    .select("*")
    .eq("token", token)
    .single();

  if (!share) notFound();

  const snap = share.snapshot as TeamShareSnapshot;

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric", month: "long", day: "numeric",
    });
  }

  function formatLastActive(date: string | null): string {
    if (!date) return "--";
    return new Date(date).toLocaleDateString("en-US", {
      month: "short", day: "numeric",
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-8">

        {/* Header */}
        <div>
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase mb-2">
            Trenchcoat
          </p>
          <h1 className="text-2xl font-bold">{snap.team.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {share.date_from} – {share.date_to} · Shared by {snap.shared_by}
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Sessions</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{snap.stats.total_sessions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCost(snap.stats.total_cost_usd)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Active Members</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {snap.stats.active_members}/{snap.stats.total_members}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{snap.stats.avg_session_duration_min}m</div>
            </CardContent>
          </Card>
        </div>

        {/* Per-member table (read-only, no links) */}
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="text-right">Sessions</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Top Tool</TableHead>
                  <TableHead className="text-right">Last Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snap.members.map((m: TeamMemberStat) => (
                  <TableRow key={m.user_id}>
                    <TableCell className="font-medium">
                      {m.display_name ?? "Unknown"}
                    </TableCell>
                    <TableCell className="text-right">{m.sessions}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatCost(m.total_cost_usd)}
                    </TableCell>
                    <TableCell className="text-right">{m.top_tool ?? "--"}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {formatLastActive(m.last_active)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Sessions trend */}
        <Card>
          <CardHeader>
            <CardTitle>Sessions over time</CardTitle>
          </CardHeader>
          <CardContent>
            <TeamTrendChart data={snap.trend} />
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="flex items-center justify-between border-t pt-6 text-sm text-muted-foreground">
          <span>Snapshot captured {formatDate(snap.captured_at)}</span>
          <a
            href="https://trenchcoat.com"
            className="font-medium text-foreground hover:underline"
          >
            Get Trenchcoat →
          </a>
        </div>

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd apps/app && bunx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Verify end-to-end**

1. Start the dev server: `bun run dev:app`
2. Navigate to a team, click **Export → Copy share link**
3. Open the share URL in a private/incognito browser window (no login)
4. Verify: team name, date range, stat cards, member table, and trend chart all render correctly
5. Verify: no login prompt, no sidebar

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app/share/
git commit -m "feat(share): add public snapshot share page at /share/[token]"
```

---

## Final Check

- [ ] Run a full lint pass: `bun run --filter @trenchcoat/app lint`
- [ ] Run TypeScript check: `cd apps/app && bunx tsc --noEmit`
- [ ] Verify the team page Overview tab renders with real data
- [ ] Verify CSV download produces a correctly formatted file
- [ ] Verify share link opens in incognito without auth
- [ ] Verify member name drill-down navigates to the correct session list
