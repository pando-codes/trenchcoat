# Agent Observability Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the AI Engineer a per-agent unit-economics view (cost/tokens over time) and a cost-weighted spawn-graph view, built entirely on telemetry Trenchcoat already captures.

**Architecture:** Read-side only. Surface cost/token fields the `get_top_agents` RPC already returns; add one on-read time-series RPC; revive and cost-enrich the dead `get_session_tree`/`get_entity_rollup` RPCs; render the spawn tree as an interactive cost-weighted graph. All new logic lives in unit-tested `lib/` modules; pages/components stay thin.

**Tech Stack:** Next.js 16 (App Router, RSC), Supabase/Postgres RPCs (plpgsql), TypeScript, `bun test`, Recharts (charts, already present), `@xyflow/react` + `dagre` (graph, new).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-19-agent-observability-core-design.md`. This plan implements Spec A only.
- **Read-side only.** No changes to `claude-plugin/` hooks, telemetry, or event schema. (Capture changes belong to Spec B.)
- **No per-agent latency.** Deferred to Spec B — do not add latency columns/tiles/RPC fields for agents. (Graph node duration from `sessions.duration_ms` is fine.)
- **On-read, no materialization.** No new aggregate table; new RPCs compute live, mirroring `get_top_agents`.
- **Agent identity = `agent_type` string**, normalized to `'general-purpose'` when blank (matches migrations 020/021). Do not introduce a stable/versioned agent id (Spec C).
- **Cost math:** always `tokens × model_pricing / 1_000_000`, `left join public.model_pricing mp on mp.model_id = <model>`; null pricing → cost contributes 0, never crash.
- **Migrations** are append-only, numbered sequentially from `022`. Changing an RPC's return columns requires `drop function if exists` first (Postgres cannot `create or replace` with a new signature).
- **Tests:** `cd apps/app && bun test <file>`. Service tests mock Supabase via `createMockSupabase(tableMocks, rpcMocks)` from `src/lib/__tests__/helpers/supabase-mock`. There is **no** DB-level (pgTAP) or React-component test harness — RPCs are verified through service-layer shape tests plus a manual SQL smoke check; pages/components are verified by running the app.
- **Commit** after each task with the shown message.

---

## File Structure

**New files**
- `supabase/migrations/022_agent_timeseries.sql` — `get_agent_timeseries` RPC.
- `supabase/migrations/023_tree_cost.sql` — cost/duration on `get_session_tree`, cost on `get_entity_rollup`.
- `apps/app/src/lib/format/agents.ts` — pure formatters (usd/tokens/avg).
- `apps/app/src/lib/format/__tests__/agents.test.ts`
- `apps/app/src/lib/analytics/agent-timeseries.ts` — pure `summariseAgentTimeseries`.
- `apps/app/src/lib/analytics/__tests__/agent-timeseries.test.ts`
- `apps/app/src/lib/graph/spawn-graph.ts` — pure tree→graph transform.
- `apps/app/src/lib/graph/__tests__/spawn-graph.test.ts`
- `apps/app/src/app/(dashboard)/agents/[type]/page.tsx` + `loading.tsx` — drill-down.
- `apps/app/src/components/charts/agent-trend-chart.tsx` — cost/tokens small-multiples.
- `apps/app/src/components/graph/spawn-graph-view.tsx` — react-flow client component.

**Modified files**
- `apps/app/src/types/analytics.ts` — add `AgentTimeseriesPoint`; extend `SessionTreeNode`, `EntityRollup`.
- `apps/app/src/lib/services/analytics.service.ts` — add `getTopAgents`, `getAgentTimeseries`, `getSessionTree`.
- `apps/app/src/lib/__tests__/analytics.service.test.ts` — cover the three new methods.
- `apps/app/src/app/(dashboard)/agents/page.tsx` — cost/token columns + row links, via service.
- `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx` — "View spawn graph" entry point.
- `apps/app/package.json` — add `@xyflow/react`, `dagre`.

---

## Task 1: `getTopAgents` service method

Move the inline `get_top_agents` RPC call into the service layer so both the Agents page and the drill-down consume one tested function.

**Files:**
- Modify: `apps/app/src/lib/services/analytics.service.ts`
- Test: `apps/app/src/lib/__tests__/analytics.service.test.ts`

**Interfaces:**
- Consumes: `AgentStat` (already in `types/analytics.ts`), `ServiceResult` (from `./types`).
- Produces: `getTopAgents(supabase, userId, from, to, limit=50): Promise<ServiceResult<AgentStat[]>>`.

- [ ] **Step 1: Write the failing test**

Add to `apps/app/src/lib/__tests__/analytics.service.test.ts`:

```ts
import { getTopAgents } from "../services/analytics.service";

describe("getTopAgents", () => {
  it("maps agent rows including cost and tokens", async () => {
    const rows = [
      { agent_type: "searcher", count: 12, avg_tool_count: 6, avg_turns: 4,
        trend: 45.0, total_input_tokens: 90000, total_output_tokens: 12000, total_cost_usd: 0.42 },
    ];
    const supabase = createMockSupabase({}, { get_top_agents: { data: rows } });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].agent_type).toBe("searcher");
      expect(result.data[0].total_cost_usd).toBe(0.42);
      expect(result.data[0].total_input_tokens).toBe(90000);
    }
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_top_agents: { data: null, error: { message: "boom" } },
    });
    const result = await getTopAgents(supabase, USER_ID, FROM, TO, 50);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts`
Expected: FAIL — `getTopAgents` is not exported.

- [ ] **Step 3: Implement the method**

Append to `apps/app/src/lib/services/analytics.service.ts` (add `AgentStat` to the type import from `@/types/analytics`):

```ts
export async function getTopAgents(
  supabase: SupabaseClient,
  userId: string,
  from: string,
  to: string,
  limit = 50
): Promise<ServiceResult<AgentStat[]>> {
  const { data, error } = await supabase.rpc("get_top_agents", {
    p_user_id: userId,
    p_from: from,
    p_to: to,
    p_limit: limit,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get top agents", details: error.message },
    };
  }

  const agents: AgentStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    agent_type: row.agent_type as string,
    count: row.count as number,
    avg_tool_count: (row.avg_tool_count as number | null) ?? null,
    avg_turns: (row.avg_turns as number | null) ?? null,
    trend: (row.trend as number | null) ?? null,
    total_input_tokens: (row.total_input_tokens as number | null) ?? null,
    total_output_tokens: (row.total_output_tokens as number | null) ?? null,
    total_cost_usd: (row.total_cost_usd as number | null) ?? null,
  }));

  return { success: true, data: agents };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/services/analytics.service.ts apps/app/src/lib/__tests__/analytics.service.test.ts
git commit -m "feat(agents): add getTopAgents service method"
```

---

## Task 2: Agent-row formatters

Pure, testable formatting helpers for the money/token cells so the page stays thin.

**Files:**
- Create: `apps/app/src/lib/format/agents.ts`
- Test: `apps/app/src/lib/format/__tests__/agents.test.ts`

**Interfaces:**
- Produces: `formatUsd(v: number | null): string`, `formatTokens(v: number | null): string`, `avgCostPerCall(total: number | null, count: number): number | null`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "bun:test";
import { formatUsd, formatTokens, avgCostPerCall } from "../agents";

describe("formatUsd", () => {
  it("uses 4 decimals under $1 and 2 at/above $1", () => {
    expect(formatUsd(0.4234)).toBe("$0.4234");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
  it("renders -- for null", () => { expect(formatUsd(null)).toBe("--"); });
});

describe("formatTokens", () => {
  it("abbreviates thousands", () => { expect(formatTokens(90000)).toBe("90.0k"); });
  it("keeps small counts", () => { expect(formatTokens(512)).toBe("512"); });
  it("renders -- for null", () => { expect(formatTokens(null)).toBe("--"); });
});

describe("avgCostPerCall", () => {
  it("divides total by count", () => { expect(avgCostPerCall(1.2, 4)).toBeCloseTo(0.3); });
  it("returns null on zero count or null total", () => {
    expect(avgCostPerCall(1.2, 0)).toBeNull();
    expect(avgCostPerCall(null, 4)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/app && bun test src/lib/format/__tests__/agents.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/app/src/lib/format/agents.ts`:

```ts
export function formatUsd(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "--";
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

export function formatTokens(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "--";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

export function avgCostPerCall(total: number | null, count: number): number | null {
  if (total === null || count <= 0) return null;
  return total / count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/app && bun test src/lib/format/__tests__/agents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/format/
git commit -m "feat(agents): add agent-row formatters"
```

---

## Task 3: Agents page — surface cost/tokens + row links

Wire the page to `getTopAgents`, render Avg Cost and Tokens columns (already returned, currently dropped), and link each row to the drill-down.

**Files:**
- Modify: `apps/app/src/app/(dashboard)/agents/page.tsx`

**Interfaces:**
- Consumes: `getTopAgents` (Task 1), `formatUsd`/`formatTokens`/`avgCostPerCall` (Task 2).

> No RSC test harness exists — verify by running the app (Step 3).

- [ ] **Step 1: Update the page**

In `apps/app/src/app/(dashboard)/agents/page.tsx`:

1. Replace the inline `supabase.rpc("get_top_agents", …)` + mapping block with the service call:

```tsx
import Link from "next/link";
import { getTopAgents } from "@/lib/services/analytics.service";
import { formatUsd, formatTokens, avgCostPerCall } from "@/lib/format/agents";

// …inside the component, replacing the Promise.all agents branch:
const [agentsResult, dailyResult] = await Promise.all([
  getTopAgents(supabase, user.id, p_from, p_to, 50),
  supabase
    .from("daily_aggregates")
    .select("date, agent_calls")
    .eq("user_id", user.id)
    .gte("date", p_from)
    .lte("date", p_to)
    .order("date", { ascending: true }),
]);
const agents = agentsResult.success ? agentsResult.data : [];
```

2. Replace the `<TableHeader>` row with (drop nothing that exists, add Avg Cost + Tokens):

```tsx
<TableRow>
  <TableHead>Agent Type</TableHead>
  <TableHead className="text-right">Calls</TableHead>
  <TableHead className="text-right">Avg Cost</TableHead>
  <TableHead className="text-right">Tokens (in/out)</TableHead>
  <TableHead className="text-right">Avg Tools/Call</TableHead>
  <TableHead className="text-right">Avg Turns</TableHead>
  <TableHead className="text-right">Trend</TableHead>
</TableRow>
```

3. Update the empty-state `colSpan={5}` → `colSpan={7}`.

4. Make the agent name a link and add the two new cells (place Avg Cost + Tokens right after Calls):

```tsx
<TableCell className="font-medium">
  <Link href={`/agents/${encodeURIComponent(stat.agent_type || "general-purpose")}`}
        className="hover:underline">
    {stat.agent_type || "general-purpose"}
  </Link>
</TableCell>
<TableCell className="text-right">{stat.count}</TableCell>
<TableCell className="text-right">
  {formatUsd(avgCostPerCall(stat.total_cost_usd, stat.count))}
</TableCell>
<TableCell className="text-right">
  {formatTokens(stat.total_input_tokens)} / {formatTokens(stat.total_output_tokens)}
</TableCell>
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/app && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify in the app**

Run the app, open `/agents`. Confirm the Avg Cost and Tokens columns render values (not `--` when data exists), and clicking an agent navigates to `/agents/<type>` (404 until Task 5 — that's expected).

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app/\(dashboard\)/agents/page.tsx
git commit -m "feat(agents): surface cost/token columns and row links"
```

---

## Task 4: `get_agent_timeseries` RPC + service method

Per-agent daily buckets of invocations, tokens, and cost (on-read).

**Files:**
- Create: `supabase/migrations/022_agent_timeseries.sql`
- Modify: `apps/app/src/types/analytics.ts`, `apps/app/src/lib/services/analytics.service.ts`
- Test: `apps/app/src/lib/__tests__/analytics.service.test.ts`

**Interfaces:**
- Produces: type `AgentTimeseriesPoint`; `getAgentTimeseries(supabase, userId, agentType, from, to): Promise<ServiceResult<AgentTimeseriesPoint[]>>`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/022_agent_timeseries.sql`:

```sql
-- 022: Per-agent daily time-series (invocations, tokens, cost). On-read.
create or replace function public.get_agent_timeseries(
  p_user_id    uuid,
  p_agent_type text,
  p_from       date,
  p_to         date
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.bucket), '[]') into result
  from (
    select
      e.timestamp::date as bucket,
      count(*) as invocations,
      sum(coalesce((e.data->>'input_tokens')::numeric, 0))::bigint  as input_tokens,
      sum(coalesce((e.data->>'output_tokens')::numeric, 0))::bigint as output_tokens,
      round(sum(
        coalesce((e.data->>'input_tokens')::numeric, 0)  * coalesce(mp.input_cost_per_1m, 0)  / 1000000.0 +
        coalesce((e.data->>'output_tokens')::numeric, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
      )::numeric, 6) as cost_usd
    from public.events e
    left join public.model_pricing mp on mp.model_id = (e.data->>'model')
    where e.user_id    = p_user_id
      and e.event_type = 'subagent_stop'
      and coalesce(e.data->>'agent_type', 'general-purpose') = p_agent_type
      and e.timestamp::date between p_from and p_to
    group by e.timestamp::date
  ) t;
  return result;
end;
$$ language plpgsql security definer;
```

- [ ] **Step 2: Add the type**

In `apps/app/src/types/analytics.ts`:

```ts
export interface AgentTimeseriesPoint {
  bucket: string;
  invocations: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}
```

- [ ] **Step 3: Write the failing service test**

Add to `apps/app/src/lib/__tests__/analytics.service.test.ts`:

```ts
import { getAgentTimeseries } from "../services/analytics.service";

describe("getAgentTimeseries", () => {
  it("maps timeseries rows on success", async () => {
    const rows = [
      { bucket: "2025-04-01", invocations: 3, input_tokens: 30000, output_tokens: 4000, cost_usd: 0.12 },
    ];
    const supabase = createMockSupabase({}, { get_agent_timeseries: { data: rows } });
    const result = await getAgentTimeseries(supabase, USER_ID, "searcher", FROM, TO);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0].cost_usd).toBe(0.12);
      expect(result.data[0].invocations).toBe(3);
    }
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_agent_timeseries: { data: null, error: { message: "boom" } },
    });
    const result = await getAgentTimeseries(supabase, USER_ID, "searcher", FROM, TO);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts`
Expected: FAIL — `getAgentTimeseries` not exported.

- [ ] **Step 5: Implement the method**

Add `AgentTimeseriesPoint` to the type import, then append to `analytics.service.ts`:

```ts
export async function getAgentTimeseries(
  supabase: SupabaseClient,
  userId: string,
  agentType: string,
  from: string,
  to: string
): Promise<ServiceResult<AgentTimeseriesPoint[]>> {
  const { data, error } = await supabase.rpc("get_agent_timeseries", {
    p_user_id: userId,
    p_agent_type: agentType,
    p_from: from,
    p_to: to,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get agent timeseries", details: error.message },
    };
  }

  const points: AgentTimeseriesPoint[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    bucket: row.bucket as string,
    invocations: row.invocations as number,
    input_tokens: (row.input_tokens as number) ?? 0,
    output_tokens: (row.output_tokens as number) ?? 0,
    cost_usd: (row.cost_usd as number) ?? 0,
  }));

  return { success: true, data: points };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts`
Expected: PASS.

- [ ] **Step 7: Manual SQL smoke (no DB test harness)**

Apply the migration locally and eyeball one call:

Run: `supabase db reset` (or apply migration to your local db), then in `psql`:
`select public.get_agent_timeseries('<your-user-uuid>', 'general-purpose', '2026-06-01', '2026-07-19');`
Expected: a JSON array (or `[]`), each element with `bucket/invocations/input_tokens/output_tokens/cost_usd`.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/022_agent_timeseries.sql apps/app/src/types/analytics.ts apps/app/src/lib/services/analytics.service.ts apps/app/src/lib/__tests__/analytics.service.test.ts
git commit -m "feat(agents): add get_agent_timeseries RPC + service method"
```

---

## Task 5: Agent drill-down route

`/agents/[type]` — header tiles + cost/token time-series charts.

**Files:**
- Create: `apps/app/src/lib/analytics/agent-timeseries.ts` (+ test), `apps/app/src/components/charts/agent-trend-chart.tsx`, `apps/app/src/app/(dashboard)/agents/[type]/page.tsx`, `apps/app/src/app/(dashboard)/agents/[type]/loading.tsx`
- Test: `apps/app/src/lib/analytics/__tests__/agent-timeseries.test.ts`

**Interfaces:**
- Consumes: `getAgentTimeseries` (Task 4), `getTopAgents` (Task 1), `AgentTimeseriesPoint`, `formatUsd`/`formatTokens`.
- Produces: `summariseAgentTimeseries(points): AgentTimeseriesSummary`.

- [ ] **Step 1: Write the failing summary test**

Create `apps/app/src/lib/analytics/__tests__/agent-timeseries.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { summariseAgentTimeseries } from "../agent-timeseries";

describe("summariseAgentTimeseries", () => {
  it("totals invocations, tokens, cost and derives avg cost/call", () => {
    const s = summariseAgentTimeseries([
      { bucket: "2025-04-01", invocations: 2, input_tokens: 100, output_tokens: 20, cost_usd: 0.10 },
      { bucket: "2025-04-02", invocations: 3, input_tokens: 200, output_tokens: 30, cost_usd: 0.20 },
    ]);
    expect(s.totalInvocations).toBe(5);
    expect(s.totalInputTokens).toBe(300);
    expect(s.totalOutputTokens).toBe(50);
    expect(s.totalCostUsd).toBeCloseTo(0.30);
    expect(s.avgCostPerCall).toBeCloseTo(0.06);
  });

  it("handles empty input", () => {
    const s = summariseAgentTimeseries([]);
    expect(s.totalInvocations).toBe(0);
    expect(s.avgCostPerCall).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/app && bun test src/lib/analytics/__tests__/agent-timeseries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the summary**

Create `apps/app/src/lib/analytics/agent-timeseries.ts`:

```ts
import type { AgentTimeseriesPoint } from "@/types/analytics";

export interface AgentTimeseriesSummary {
  totalInvocations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgCostPerCall: number | null;
}

export function summariseAgentTimeseries(points: AgentTimeseriesPoint[]): AgentTimeseriesSummary {
  const totals = points.reduce(
    (acc, p) => ({
      inv: acc.inv + p.invocations,
      inTok: acc.inTok + p.input_tokens,
      outTok: acc.outTok + p.output_tokens,
      cost: acc.cost + p.cost_usd,
    }),
    { inv: 0, inTok: 0, outTok: 0, cost: 0 }
  );
  return {
    totalInvocations: totals.inv,
    totalInputTokens: totals.inTok,
    totalOutputTokens: totals.outTok,
    totalCostUsd: totals.cost,
    avgCostPerCall: totals.inv > 0 ? totals.cost / totals.inv : null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/app && bun test src/lib/analytics/__tests__/agent-timeseries.test.ts`
Expected: PASS.

- [ ] **Step 5: Build the trend chart component**

Create `apps/app/src/components/charts/agent-trend-chart.tsx` (client component; mirror the existing Recharts usage in `components/charts/agent-calls-chart.tsx`):

```tsx
"use client";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { AgentTimeseriesPoint } from "@/types/analytics";

export function AgentTrendChart({
  data, dataKey, label,
}: { data: AgentTimeseriesPoint[]; dataKey: "cost_usd" | "invocations"; label: string }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data}>
        <XAxis dataKey="bucket" fontSize={11} tickMargin={6} />
        <YAxis fontSize={11} width={48} />
        <Tooltip formatter={(v: number) => [v, label]} />
        <Line type="monotone" dataKey={dataKey} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 6: Build the drill-down page**

Create `apps/app/src/app/(dashboard)/agents/[type]/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAgentTimeseries } from "@/lib/services/analytics.service";
import { summariseAgentTimeseries } from "@/lib/analytics/agent-timeseries";
import { formatUsd, formatTokens } from "@/lib/format/agents";
import { AgentTrendChart } from "@/components/charts/agent-trend-chart";

export default async function AgentDetailPage({
  params, searchParams,
}: {
  params: Promise<{ type: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { type } = await params;
  const agentType = decodeURIComponent(type);
  const { from, to } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);

  const tsResult = await getAgentTimeseries(supabase, user.id, agentType, p_from, p_to);
  const points = tsResult.success ? tsResult.data : [];
  const summary = summariseAgentTimeseries(points);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <Link href="/agents" className="text-sm text-muted-foreground hover:underline">← Agents</Link>
        <h1 className="text-2xl font-semibold tracking-tight">{agentType}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Invocations" value={String(summary.totalInvocations)} />
        <Stat label="Total Cost" value={formatUsd(summary.totalCostUsd)} />
        <Stat label="Avg Cost/Call" value={formatUsd(summary.avgCostPerCall)} />
        <Stat label="Tokens (in/out)"
              value={`${formatTokens(summary.totalInputTokens)} / ${formatTokens(summary.totalOutputTokens)}`} />
      </div>

      {points.length === 0 ? (
        <Card><CardContent className="p-6 text-center text-muted-foreground">
          No data for this agent in the selected range.
        </CardContent></Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>Cost per day</CardTitle></CardHeader>
            <CardContent><AgentTrendChart data={points} dataKey="cost_usd" label="USD" /></CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Invocations per day</CardTitle></CardHeader>
            <CardContent><AgentTrendChart data={points} dataKey="invocations" label="calls" /></CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}
```

Create `apps/app/src/app/(dashboard)/agents/[type]/loading.tsx` mirroring the existing `agents/loading.tsx` skeleton.

- [ ] **Step 7: Typecheck + verify in app**

Run: `cd apps/app && bunx tsc --noEmit` → no errors.
Run the app, click an agent on `/agents` → drill-down loads with tiles + two charts (or the empty-state).

- [ ] **Step 8: Commit**

```bash
git add apps/app/src/lib/analytics/ apps/app/src/components/charts/agent-trend-chart.tsx apps/app/src/app/\(dashboard\)/agents/\[type\]/
git commit -m "feat(agents): add per-agent drill-down route with cost/invocation trends"
```

---

## Task 6: Cost + duration on the spawn-tree RPCs

Revive the dead `get_session_tree`/`get_entity_rollup` by adding per-node `duration_ms` + `estimated_cost_usd` (and cost on the rollup its own spec promised).

**Files:**
- Create: `supabase/migrations/023_tree_cost.sql`
- Modify: `apps/app/src/types/analytics.ts` (extend `SessionTreeNode`, `EntityRollup`), `apps/app/src/lib/services/analytics.service.ts`
- Test: `apps/app/src/lib/__tests__/analytics.service.test.ts`

**Interfaces:**
- Produces: extended `SessionTreeNode` (adds `duration_ms`, `estimated_cost_usd`), extended `EntityRollup` (adds `estimated_cost_usd`); `getSessionTree(supabase, userId, sessionId): Promise<ServiceResult<SessionTreeNode[]>>`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/023_tree_cost.sql`. Return-type changes require dropping first:

```sql
-- 023: add duration + cost to spawn-tree RPCs.

drop function if exists public.get_session_tree(uuid, text);
create or replace function public.get_session_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  session_id         text,
  parent_session_id  text,
  spawner_id         text,
  spawner_type       text,
  depth              int,
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_ms        bigint,
  tool_count         bigint,
  skill_count        bigint,
  subagent_count     bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  estimated_cost_usd numeric
) language sql stable as $$
  with recursive tree as (
    select s.session_id, s.parent_session_id, s.spawner_id, s.spawner_type,
           0 as depth, s.started_at, s.ended_at
    from public.sessions s
    where s.session_id = p_session_id and s.user_id = p_user_id
    union all
    select s.session_id, s.parent_session_id, s.spawner_id, s.spawner_type,
           t.depth + 1, s.started_at, s.ended_at
    from public.sessions s
    join tree t on s.parent_session_id = t.session_id
    where s.user_id = p_user_id
  )
  select
    t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type, t.depth,
    t.started_at, t.ended_at,
    coalesce(max(s2.duration_ms), 0)::bigint                   as duration_ms,
    count(e.id) filter (where e.event_type = 'tool_use')       as tool_count,
    count(e.id) filter (where e.event_type = 'skill_use')      as skill_count,
    count(e.id) filter (where e.event_type = 'subagent_stop')  as subagent_count,
    coalesce(max(s2.input_tokens),  0)::bigint                 as input_tokens,
    coalesce(max(s2.output_tokens), 0)::bigint                 as output_tokens,
    round(coalesce(
      max(s2.input_tokens)  * max(mp.input_cost_per_1m)  / 1000000.0 +
      max(s2.output_tokens) * max(mp.output_cost_per_1m) / 1000000.0, 0)::numeric, 6) as estimated_cost_usd
  from tree t
  left join public.events e   on e.session_id  = t.session_id and e.user_id = p_user_id
  left join public.sessions s2 on s2.session_id = t.session_id and s2.user_id = p_user_id
  left join public.model_pricing mp on mp.model_id = s2.model
  group by t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type,
           t.depth, t.started_at, t.ended_at
  order by t.depth, t.started_at;
$$;

drop function if exists public.get_entity_rollup(uuid, text, text, date, date);
create or replace function public.get_entity_rollup(
  p_user_id      uuid,
  p_spawner_id   text,
  p_spawner_type text,
  p_date_from    date,
  p_date_to      date
) returns table (
  total_tools        bigint,
  total_skills       bigint,
  total_subagents    bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  estimated_cost_usd numeric
) language sql stable as $$
  with recursive descendant_sessions as (
    select session_id, input_tokens, output_tokens, model
    from public.sessions
    where spawner_id = p_spawner_id and spawner_type = p_spawner_type
      and user_id = p_user_id
      and started_at::date between p_date_from and p_date_to
    union all
    select s.session_id, s.input_tokens, s.output_tokens, s.model
    from public.sessions s
    join descendant_sessions ds on s.parent_session_id = ds.session_id
    where s.user_id = p_user_id
  )
  select
    coalesce((select count(*) from public.events
      where user_id = p_user_id and event_type = 'tool_use'
        and data->>'spawner_id' = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to), 0)
    + coalesce((select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'tool_use'), 0) as total_tools,

    coalesce((select count(*) from public.events
      where user_id = p_user_id and event_type = 'skill_use'
        and data->>'spawner_id' = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to), 0)
    + coalesce((select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'skill_use'), 0) as total_skills,

    coalesce((select count(*) from public.events
      where user_id = p_user_id and event_type = 'subagent_stop'
        and data->>'spawner_id' = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to), 0)
    + coalesce((select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'subagent_stop'), 0) as total_subagents,

    coalesce((select sum(input_tokens)  from descendant_sessions), 0)::bigint as input_tokens,
    coalesce((select sum(output_tokens) from descendant_sessions), 0)::bigint as output_tokens,
    coalesce((
      select round(sum(
        coalesce(ds.input_tokens, 0)  * coalesce(mp.input_cost_per_1m, 0)  / 1000000.0 +
        coalesce(ds.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
      )::numeric, 6)
      from descendant_sessions ds
      left join public.model_pricing mp on mp.model_id = ds.model
    ), 0) as estimated_cost_usd;
$$;
```

- [ ] **Step 2: Extend the types**

In `apps/app/src/types/analytics.ts`, extend the existing interfaces:

```ts
// SessionTreeNode: add these two fields
  duration_ms: number;
  estimated_cost_usd: number;

// EntityRollup: add this field
  estimated_cost_usd: number;
```

- [ ] **Step 3: Write the failing service test**

Add to `apps/app/src/lib/__tests__/analytics.service.test.ts`:

```ts
import { getSessionTree } from "../services/analytics.service";

describe("getSessionTree", () => {
  it("maps tree nodes including duration and cost", async () => {
    const rows = [
      { session_id: "root", parent_session_id: null, spawner_id: null, spawner_type: null,
        depth: 0, started_at: "2025-04-01T00:00:00Z", ended_at: "2025-04-01T00:01:00Z",
        duration_ms: 60000, tool_count: 4, skill_count: 0, subagent_count: 2,
        input_tokens: 1000, output_tokens: 200, estimated_cost_usd: 0.05 },
    ];
    const supabase = createMockSupabase({}, { get_session_tree: { data: rows } });
    const result = await getSessionTree(supabase, USER_ID, "root");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].duration_ms).toBe(60000);
      expect(result.data[0].estimated_cost_usd).toBe(0.05);
    }
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_session_tree: { data: null, error: { message: "boom" } },
    });
    const result = await getSessionTree(supabase, USER_ID, "root");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts`
Expected: FAIL — `getSessionTree` not exported.

- [ ] **Step 5: Implement the method**

Add `SessionTreeNode` to the type import, then append to `analytics.service.ts`:

```ts
export async function getSessionTree(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<ServiceResult<SessionTreeNode[]>> {
  const { data, error } = await supabase.rpc("get_session_tree", {
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get session tree", details: error.message },
    };
  }

  return { success: true, data: (data as SessionTreeNode[]) ?? [] };
}
```

- [ ] **Step 6: Run test + manual SQL smoke**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts` → PASS.
Apply migration locally; in `psql`: `select * from public.get_session_tree('<user-uuid>', '<a-root-session-id>');`
Expected: rows including non-null `duration_ms` and `estimated_cost_usd`.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/023_tree_cost.sql apps/app/src/types/analytics.ts apps/app/src/lib/services/analytics.service.ts apps/app/src/lib/__tests__/analytics.service.test.ts
git commit -m "feat(graph): add duration + cost to session-tree RPCs"
```

---

## Task 7: Pure spawn-graph transform

Convert tree rows into graph nodes/edges with cost-heat normalization and a critical path — the whole graph brain, fully unit-tested, so the React component stays dumb.

**Files:**
- Create: `apps/app/src/lib/graph/spawn-graph.ts`
- Test: `apps/app/src/lib/graph/__tests__/spawn-graph.test.ts`

**Interfaces:**
- Consumes: `SessionTreeNode` (extended in Task 6).
- Produces: `buildSpawnGraph(tree, opts?): SpawnGraph` with `SpawnGraphNode`, `SpawnGraphEdge`, `SpawnGraph` types.

- [ ] **Step 1: Write the failing test**

Create `apps/app/src/lib/graph/__tests__/spawn-graph.test.ts`:

```ts
import { describe, it, expect } from "bun:test";
import { buildSpawnGraph } from "../spawn-graph";
import type { SessionTreeNode } from "@/types/analytics";

function node(p: Partial<SessionTreeNode> & { session_id: string }): SessionTreeNode {
  return {
    session_id: p.session_id,
    parent_session_id: p.parent_session_id ?? null,
    spawner_id: p.spawner_id ?? null,
    spawner_type: p.spawner_type ?? null,
    depth: p.depth ?? 0,
    started_at: p.started_at ?? "2025-04-01T00:00:00Z",
    ended_at: p.ended_at ?? null,
    duration_ms: p.duration_ms ?? 0,
    tool_count: p.tool_count ?? 0,
    skill_count: p.skill_count ?? 0,
    subagent_count: p.subagent_count ?? 0,
    input_tokens: p.input_tokens ?? 0,
    output_tokens: p.output_tokens ?? 0,
    estimated_cost_usd: p.estimated_cost_usd ?? 0,
  };
}

describe("buildSpawnGraph", () => {
  const tree: SessionTreeNode[] = [
    node({ session_id: "root", depth: 0, duration_ms: 100, estimated_cost_usd: 0.10 }),
    node({ session_id: "a", parent_session_id: "root", depth: 1, duration_ms: 90, estimated_cost_usd: 0.40 }),
    node({ session_id: "b", parent_session_id: "root", depth: 1, duration_ms: 10, estimated_cost_usd: 0.05 }),
  ];

  it("creates a node per row and an edge per parent link", () => {
    const g = buildSpawnGraph(tree);
    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
    expect(g.edges.map((e) => `${e.source}->${e.target}`).sort()).toEqual(["root->a", "root->b"]);
  });

  it("normalizes cost heat against the max cost (default weight=cost)", () => {
    const g = buildSpawnGraph(tree);
    const a = g.nodes.find((n) => n.id === "a")!;
    const b = g.nodes.find((n) => n.id === "b")!;
    expect(a.costHeat).toBeCloseTo(1); // a has the max cost
    expect(b.costHeat).toBeLessThan(a.costHeat);
  });

  it("marks the longest-duration root→leaf chain as the critical path", () => {
    const g = buildSpawnGraph(tree); // root(100)->a(90) = 190 beats root->b = 110
    const onPath = g.nodes.filter((n) => n.onCriticalPath).map((n) => n.id).sort();
    expect(onPath).toEqual(["a", "root"]);
  });

  it("truncates beyond the cap and reports how many were hidden", () => {
    const big: SessionTreeNode[] = [node({ session_id: "root", depth: 0 })];
    for (let i = 0; i < 10; i++) big.push(node({ session_id: `n${i}`, parent_session_id: "root", depth: 1 }));
    const g = buildSpawnGraph(big, { cap: 5 });
    expect(g.nodes).toHaveLength(5);
    expect(g.truncated).toBe(true);
    expect(g.hiddenCount).toBe(6);
  });

  it("drops edges whose parent was truncated away", () => {
    const big: SessionTreeNode[] = [node({ session_id: "root", depth: 0 })];
    for (let i = 0; i < 10; i++) big.push(node({ session_id: `n${i}`, parent_session_id: "root", depth: 1 }));
    const g = buildSpawnGraph(big, { cap: 3 });
    for (const e of g.edges) {
      expect(g.nodes.some((n) => n.id === e.source)).toBe(true);
      expect(g.nodes.some((n) => n.id === e.target)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/app && bun test src/lib/graph/__tests__/spawn-graph.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the transform**

Create `apps/app/src/lib/graph/spawn-graph.ts`:

```ts
import type { SessionTreeNode } from "@/types/analytics";

export interface SpawnGraphNode {
  id: string;
  parentId: string | null;
  label: string;
  depth: number;
  costUsd: number;
  durationMs: number;
  costHeat: number; // 0..1 normalized against max weight
  onCriticalPath: boolean;
}
export interface SpawnGraphEdge { id: string; source: string; target: string; }
export interface SpawnGraph {
  nodes: SpawnGraphNode[];
  edges: SpawnGraphEdge[];
  truncated: boolean;
  hiddenCount: number;
}

export interface BuildOpts { cap?: number; weight?: "cost" | "latency"; }

const DEFAULT_CAP = 300;

function labelFor(n: SessionTreeNode): string {
  if (n.spawner_type && n.spawner_id) return `${n.spawner_type}:${n.spawner_id}`;
  return n.session_id.slice(0, 8);
}

export function buildSpawnGraph(tree: SessionTreeNode[], opts: BuildOpts = {}): SpawnGraph {
  const cap = opts.cap ?? DEFAULT_CAP;
  const weight = opts.weight ?? "cost";

  // Deterministic order: by depth then start time (matches RPC ordering).
  const ordered = [...tree].sort(
    (a, b) => a.depth - b.depth || a.started_at.localeCompare(b.started_at)
  );
  const kept = ordered.slice(0, cap);
  const hiddenCount = ordered.length - kept.length;
  const keptIds = new Set(kept.map((n) => n.session_id));

  const weightOf = (n: SessionTreeNode) => (weight === "cost" ? n.estimated_cost_usd : n.duration_ms);
  const maxWeight = kept.reduce((m, n) => Math.max(m, weightOf(n)), 0);

  // Critical path: longest cumulative duration from a root to a leaf.
  const byId = new Map(kept.map((n) => [n.session_id, n]));
  const cum = new Map<string, number>(); // node -> best root→node cumulative duration
  for (const n of kept) {
    const parentCum = n.parent_session_id ? cum.get(n.parent_session_id) ?? 0 : 0;
    cum.set(n.session_id, parentCum + n.duration_ms);
  }
  let leafId: string | null = null;
  let best = -1;
  for (const [id, c] of cum) if (c > best) { best = c; leafId = id; }
  const criticalIds = new Set<string>();
  let cursor = leafId;
  while (cursor) {
    criticalIds.add(cursor);
    cursor = byId.get(cursor)?.parent_session_id ?? null;
    if (cursor && !keptIds.has(cursor)) break;
  }

  const nodes: SpawnGraphNode[] = kept.map((n) => ({
    id: n.session_id,
    parentId: n.parent_session_id,
    label: labelFor(n),
    depth: n.depth,
    costUsd: n.estimated_cost_usd,
    durationMs: n.duration_ms,
    costHeat: maxWeight > 0 ? weightOf(n) / maxWeight : 0,
    onCriticalPath: criticalIds.has(n.session_id),
  }));

  const edges: SpawnGraphEdge[] = kept
    .filter((n) => n.parent_session_id && keptIds.has(n.parent_session_id))
    .map((n) => ({
      id: `${n.parent_session_id}->${n.session_id}`,
      source: n.parent_session_id as string,
      target: n.session_id,
    }));

  return { nodes, edges, truncated: hiddenCount > 0, hiddenCount };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/app && bun test src/lib/graph/__tests__/spawn-graph.test.ts`
Expected: PASS (all 5 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/graph/
git commit -m "feat(graph): add pure spawn-graph transform with cost heat + critical path"
```

---

## Task 8: SpawnGraph view + session-detail entry point

Render the transform with react-flow, wired from the session detail page.

**Files:**
- Modify: `apps/app/package.json` (add deps)
- Create: `apps/app/src/components/graph/spawn-graph-view.tsx`
- Modify: `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`

**Interfaces:**
- Consumes: `buildSpawnGraph` (Task 7), `getSessionTree` (Task 6), `formatUsd` (Task 2).

> No component test harness — verify by running the app (Step 4). All graph logic is already tested in Task 7.

- [ ] **Step 1: Add dependencies**

Run: `cd apps/app && bun add @xyflow/react dagre && bun add -d @types/dagre`
Confirm `@xyflow/react` and `dagre` appear in `apps/app/package.json`.

- [ ] **Step 2: Build the client component**

Create `apps/app/src/components/graph/spawn-graph-view.tsx`:

```tsx
"use client";
import { useMemo, useState } from "react";
import dagre from "dagre";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { buildSpawnGraph, type BuildOpts } from "@/lib/graph/spawn-graph";
import type { SessionTreeNode } from "@/types/analytics";
import { formatUsd } from "@/lib/format/agents";

const W = 180, H = 52;

function layout(nodes: Node[], edges: Edge[]): Node[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "TB", nodesep: 30, ranksep: 60 });
  g.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((n) => g.setNode(n.id, { width: W, height: H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return nodes.map((n) => {
    const p = g.node(n.id);
    return { ...n, position: { x: p.x - W / 2, y: p.y - H / 2 } };
  });
}

// Red-orange heat: interpolate lightness by heat (0 = pale, 1 = hot).
function heatColor(heat: number): string {
  const l = 92 - Math.round(heat * 42); // 92%→50%
  return `hsl(18 90% ${l}%)`;
}

export function SpawnGraphView({ tree }: { tree: SessionTreeNode[] }) {
  const [weight, setWeight] = useState<BuildOpts["weight"]>("cost");
  const graph = useMemo(() => buildSpawnGraph(tree, { weight }), [tree, weight]);

  const { nodes, edges } = useMemo(() => {
    const rawNodes: Node[] = graph.nodes.map((n) => ({
      id: n.id,
      data: { label: `${n.label}\n${formatUsd(n.costUsd)}` },
      position: { x: 0, y: 0 },
      style: {
        width: W, height: H, whiteSpace: "pre", fontSize: 11, borderRadius: 8,
        background: heatColor(n.costHeat),
        border: n.onCriticalPath ? "2px solid #dc2626" : "1px solid #e5e7eb",
      },
    }));
    const rawEdges: Edge[] = graph.edges.map((e) => ({
      id: e.id, source: e.source, target: e.target, animated: false,
    }));
    return { nodes: layout(rawNodes, rawEdges), edges: rawEdges };
  }, [graph]);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">Weight:</span>
        <button onClick={() => setWeight("cost")}
          className={weight === "cost" ? "font-semibold underline" : "text-muted-foreground"}>Cost</button>
        <button onClick={() => setWeight("latency")}
          className={weight === "latency" ? "font-semibold underline" : "text-muted-foreground"}>Latency</button>
        {graph.truncated && (
          <span className="ml-auto text-amber-600">Truncated — {graph.hiddenCount} nodes hidden</span>
        )}
      </div>
      <div style={{ height: 480 }} className="rounded-lg border">
        <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the entry point on session detail**

In `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`:

1. Import and fetch the tree (the page already resolves the root session id for its parent/child UI — reuse that id; if it only has the current `sessionId`, use that):

```tsx
import { getSessionTree } from "@/lib/services/analytics.service";
import { SpawnGraphView } from "@/components/graph/spawn-graph-view";
// …after the existing session load, using the resolved root/session id:
const treeResult = await getSessionTree(supabase, user.id, rootSessionId);
const tree = treeResult.success ? treeResult.data : [];
```

2. Render the graph in a card below the existing "Subagent Sessions" card, only when the tree has more than one node:

```tsx
{tree.length > 1 && (
  <Card>
    <CardHeader><CardTitle>Spawn graph</CardTitle></CardHeader>
    <CardContent><SpawnGraphView tree={tree} /></CardContent>
  </Card>
)}
```

- [ ] **Step 4: Typecheck + verify in app**

Run: `cd apps/app && bunx tsc --noEmit` → no errors.
Run the app, open a session that spawned subagents. Confirm: the graph renders nodes/edges, cost heat shades nodes, the critical path is red-outlined, the Cost/Latency toggle re-weights, and node cost labels match. Open a single-session run → no graph card (expected).

- [ ] **Step 5: Commit**

```bash
git add apps/app/package.json apps/app/bun.lock apps/app/src/components/graph/ apps/app/src/app/\(dashboard\)/sessions/\[id\]/page.tsx
git commit -m "feat(graph): render cost-weighted spawn graph on session detail"
```

---

## Self-Review

**Spec coverage:**
- §4.1 Agents page cost/token columns + row links → Task 3 ✓
- §4.1 drill-down (tiles + cost/invocation time-series) → Tasks 4, 5 ✓
- §4.2 cost-weighted graph + critical path + latency toggle + truncation → Tasks 6, 7, 8 ✓
- §4.2 revive dead tree RPCs with cost → Task 6 ✓
- §4.3 no per-agent latency → honored (no latency fields anywhere) ✓
- §5 `get_agent_timeseries`, extended `get_session_tree`/`get_entity_rollup`, service wrappers, types → Tasks 4, 6 ✓
- §7 error/edge cases: null pricing → `--`/0 (Task 2 formatters, RPC coalesce); truncation cap (Task 7); single-session run hides graph (Task 8); unknown agent_type empty-state (Task 5) ✓
- §9.2 graph library confirmed via Task 8 (react-flow + dagre; fallback documented in spec) ✓

**Placeholder scan:** none — every code step contains full code; RPC/UI verification steps use real commands.

**Type consistency:** `AgentStat` (Task 1) matches `types/analytics.ts`; `AgentTimeseriesPoint` defined Task 4, consumed Tasks 4/5; `SessionTreeNode` extended Task 6, consumed Tasks 6/7/8; `buildSpawnGraph` signature stable across Tasks 7/8; service method names (`getTopAgents`, `getAgentTimeseries`, `getSessionTree`) consistent between definition and consumption.

**Deferred to Spec B (documented, not gaps):** per-agent latency + the `agent_type`-on-tool_end capture change.
