# Agent-Native Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the spawn graph show agents — build real lineage from the native identifiers D1 started capturing.

**Architecture:** Ingest accepts `subagent_start` → an `agents` table is upserted from three event types → a recursive RPC returns the agent tree → the existing (well-tested) graph transform is reused via an adapter → session detail renders it.

**Tech Stack:** Next.js 16 RSC, Supabase/Postgres plpgsql, `bun test`, Python plugin + pytest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-20-agent-native-lineage-design.md`.
- **Lineage rule:** on the Agent `tool_result` that spawned agent Y, `agent_result.agentId` (or `agent_id`) is **Y**, and `origin_agent_id` is **Y's parent**. Absent `origin_agent_id` ⇒ Y is a root (`parent_agent_id = null`). Do not invent any other parentage source.
- **Ordering matters:** the ingest Zod enum must accept `subagent_start` (Task 1) BEFORE the plugin is allowed to push it (Task 2). A plugin pushing an event the API rejects 400s whole batches.
- **Partial upsert must never null-clobber.** Each event contributes ONLY the columns it owns; build a payload of just those columns plus the conflict key. Never send a full row with nulls.
- **Upsert key is `(user_id, agent_id)`** and promotion must be order-independent — the three contributing events may arrive in any order, in any batch.
- **Cost math:** `tokens × model_pricing / 1_000_000` with **per-term coalesce** (`coalesce(a,0) * coalesce(b,0) + …`). Coalescing only the outer sum was a real bug fixed in migration 023 — do not regress it.
- **`spawn_depth` is NOT stored** — computed at read time by the recursive CTE.
- **The recursive CTE must root at true roots AND orphans** (nodes whose `parent_agent_id` is not present in the session's agent set), or orphaned nodes vanish. It must also cap depth to survive a cycle.
- **Do not modify the existing `buildSpawnGraph(SessionTreeNode[])` signature or its 6 tests** — generalize by extraction (Task 6).
- **Migrations** append-only from `028`. `get_agent_tree` returns `TABLE(...)`, so any later column change needs `drop function if exists`.
- **Tests:** app → `cd apps/app && bun test` (baseline 416); plugin → `cd claude-plugin && uv run --with pytest pytest tests/ -q` (baseline 143). No component/DB harness — UI by `bunx tsc --noEmit` (~35-error pre-existing `bun:test` baseline) + manual; RPCs by service shape tests + manual SQL smoke.
- **Commit** after each task with the shown message.

---

## File Structure

**New**
- `supabase/migrations/028_agents.sql` — `agents` table + RLS + indexes.
- `supabase/migrations/029_agent_tree.sql` — `get_agent_tree` RPC.

**Modified**
- `apps/app/src/app/api/v1/events/route.ts` — enum.
- `claude-plugin/lib/telemetry.py` — push allowlist (+ pytest).
- `apps/app/src/lib/services/events.service.ts` (+ its test) — agent promotion.
- `apps/app/src/types/analytics.ts` — `AgentTreeNode`.
- `apps/app/src/lib/services/analytics.service.ts` (+ its test) — `getAgentTree`.
- `apps/app/src/lib/graph/spawn-graph.ts` (+ its test) — extract core, add agent adapter.
- `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx` — render the agent graph.

---

## Task 1: Accept `subagent_start` at ingest

**Files:** Modify `apps/app/src/app/api/v1/events/route.ts`; Test `apps/app/src/lib/__tests__/event-schema.test.ts` (or the existing schema test file — find it and follow its style)

- [ ] **Step 1: Write the failing test**

Find the existing test that exercises the ingest `bodySchema`/`eventSchema` (grep for `bodySchema` under `apps/app/src/lib/__tests__/`). Add, in that file's style:

```ts
it("accepts subagent_start events", () => {
  const parsed = bodySchema.safeParse({
    events: [{
      ts: "2026-07-20T00:00:00.000+00:00",
      event: "subagent_start",
      session_id: "s1",
      seq: 1,
      data: { agent_id: "ag-1", agent_type: "Explore" },
    }],
  });
  expect(parsed.success).toBe(true);
});

it("rejects an unknown event type", () => {
  const parsed = bodySchema.safeParse({
    events: [{ ts: "2026-07-20T00:00:00.000+00:00", event: "not_a_real_event",
               session_id: "s1", seq: 1, data: {} }],
  });
  expect(parsed.success).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/event-schema.test.ts`
Expected: FAIL — `subagent_start` not in the enum.

- [ ] **Step 3: Implement**

In `apps/app/src/app/api/v1/events/route.ts`, add `"subagent_start",` to the `z.enum([...])` list (place it immediately before `"subagent_stop"` for readability).

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/api/v1/events/route.ts apps/app/src/lib/__tests__/
git commit -m "feat(evals): accept subagent_start events at ingest"
```

---

## Task 2: Allow the plugin to push `subagent_start`

Sequenced deliberately after Task 1 — the API must accept it first.

**Files:** Modify `claude-plugin/lib/telemetry.py`; Test `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing test**

The existing test `test_subagent_start_recorded_locally_but_not_queued` (added in D1) now encodes an outdated contract. **Replace** it with:

```python
    def test_subagent_start_reaches_push_queue(self, tmp_path):
        """Ingest now accepts subagent_start, so it must no longer be filtered."""
        self._run_hook(tmp_path, "subagent_start.py", {
            "session_id": "q-s", "agent_id": "ag-q", "agent_type": "Explore",
        }, extra_env={"TRENCHCOAT_API_KEY": "ct_live_test"})
        queue = tmp_path / ".claude" / "trenchcoat" / ".push_queue.jsonl"
        assert queue.exists(), "push queue should exist"
        types = [json.loads(l)["event"] for l in queue.read_text().splitlines() if l.strip()]
        assert "subagent_start" in types
```

(Match how other push-queue tests in this file set `TRENCHCOAT_API_KEY` — grep for `push_queue` and follow the established pattern rather than assuming.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -k subagent_start -q`
Expected: FAIL — filtered out.

- [ ] **Step 3: Implement**

In `claude-plugin/lib/telemetry.py`, add `"subagent_start",` to `_SAAS_ACCEPTED_EVENT_TYPES`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): push subagent_start now that ingest accepts it"
```

---

## Task 3: The `agents` table

**Files:** Create `supabase/migrations/028_agents.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 028: Agent-native lineage. One row per subagent invocation, keyed on
-- Claude Code's native agent_id. Subagents are not sessions; session_id
-- here is the PARENT session they ran inside.

create table if not exists public.agents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  agent_id         text not null,
  session_id       text not null,
  parent_agent_id  text,
  agent_type       text,
  edge_label       text,
  status           text,
  model            text,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_ms      bigint,
  input_tokens     bigint,
  output_tokens    bigint,
  tool_count       integer,
  created_at       timestamptz not null default now(),
  unique (user_id, agent_id)
);

create index if not exists idx_agents_user_session
  on public.agents(user_id, session_id);

create index if not exists idx_agents_parent
  on public.agents(user_id, parent_agent_id)
  where parent_agent_id is not null;

alter table public.agents enable row level security;

create policy "Users can view own agents"
  on public.agents for select
  using (auth.uid() = user_id);

create policy "Service role can insert agents"
  on public.agents for insert
  with check (auth.role() = 'service_role');

create policy "Service role can read all agents"
  on public.agents for select
  using (auth.role() = 'service_role');

create policy "Service role can update agents"
  on public.agents for update
  using (auth.role() = 'service_role');
```

- [ ] **Step 2: Verify by reading**

No local Postgres — do NOT run `psql`/`supabase db reset`. Verify by comparing the RLS policy set and style against `supabase/migrations/026_eval_tagging.sql` (the `eval_scores` table, which has the same insert+update service-role needs for an upsert path). Confirm all four policies are present and the unique constraint matches the upsert key the next task uses.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/028_agents.sql
git commit -m "feat(agents): add agents table for native agent lineage"
```

---

## Task 4: Promote agent rows from events

**Files:** Modify `apps/app/src/lib/services/events.service.ts`; Test `apps/app/src/lib/__tests__/events.service.test.ts`

**Interfaces:** Produces agent rows upserted on `(user_id, agent_id)`.

- [ ] **Step 1: Write the failing tests**

`events.service.test.ts` uses `createSpySupabase` (not `createMockSupabase`) to capture call arguments — **read the file first and follow that pattern exactly**. Add tests proving:

```ts
// 1. subagent_start creates a row with its owned fields
//    -> upsert payload contains agent_id, agent_type, session_id, started_at
//       and does NOT contain ended_at/input_tokens (it doesn't own them)
// 2. subagent_stop contributes ended_at/tokens/model/tool_count only
// 3. an Agent tool_result contributes parent_agent_id from origin_agent_id,
//    plus edge_label and duration_ms
// 4. parent_agent_id is null/absent when origin_agent_id is absent (root agent)
// 5. order-independence: feeding stop-then-start yields the same set of
//    upserts as start-then-stop (each event's payload is independent)
```

Write these as concrete tests in the file's existing style — assert on the captured upsert payloads' keys and values.

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/__tests__/events.service.test.ts` → FAIL (no agent promotion).

- [ ] **Step 3: Implement**

In `apps/app/src/lib/services/events.service.ts`, add a new promotion loop alongside the existing ones (after the `session_start` linkage loop, before the daily-aggregates section). Each branch builds a payload of ONLY the columns that event owns:

```ts
  // -----------------------------------------------------------------------
  // Promote agent lineage rows. Each event contributes only the columns it
  // owns, so the three can arrive in any order without clobbering each other.
  // -----------------------------------------------------------------------
  for (const e of events) {
    let agentId: string | null = null;
    const row: Record<string, unknown> = {};

    if (e.event === "subagent_start") {
      agentId = (e.data?.agent_id as string) ?? null;
      if (agentId) {
        row.session_id = e.session_id;
        row.started_at = e.ts;
        const agentType = e.data?.agent_type as string | undefined;
        if (agentType) row.agent_type = agentType;
      }
    } else if (e.event === "subagent_stop") {
      agentId = (e.data?.agent_id as string) ?? null;
      if (agentId) {
        row.session_id = e.session_id;
        row.ended_at = e.ts;
        const agentType = e.data?.agent_type as string | undefined;
        if (agentType) row.agent_type = agentType;
        if (e.data?.input_tokens != null) row.input_tokens = e.data.input_tokens;
        if (e.data?.output_tokens != null) row.output_tokens = e.data.output_tokens;
        if (e.data?.model != null) row.model = e.data.model;
        if (e.data?.tool_count_total != null) row.tool_count = e.data.tool_count_total;
      }
    } else if (e.event === "tool_result" && e.data?.tool_name === "Agent") {
      const result = (e.data?.agent_result ?? {}) as Record<string, unknown>;
      agentId = ((result.agentId as string) ?? (e.data?.agent_id as string)) ?? null;
      if (agentId) {
        row.session_id = e.session_id;
        // origin_agent_id is the agent that MADE this spawn call = the parent.
        // Its absence means the call came from the main thread, i.e. a root.
        const originAgentId = e.data?.origin_agent_id as string | undefined;
        if (originAgentId) row.parent_agent_id = originAgentId;
        if (e.data?.edge_label != null) row.edge_label = e.data.edge_label;
        if (e.data?.duration_ms != null) row.duration_ms = Math.round(e.data.duration_ms as number);
        if (result.status != null) row.status = result.status;
        if (result.resolvedModel != null) row.model = result.resolvedModel;
        if (result.totalTokens != null && e.data?.input_tokens == null) {
          row.output_tokens = result.totalTokens;
        }
      }
    }

    if (agentId && Object.keys(row).length > 0) {
      await adminClient
        .from("agents")
        .upsert({ user_id: userId, agent_id: agentId, ...row },
                { onConflict: "user_id,agent_id" });
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test` → all pass (baseline 416 + your new tests).

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/services/events.service.ts apps/app/src/lib/__tests__/events.service.test.ts
git commit -m "feat(agents): promote agent lineage rows from telemetry events"
```

---

## Task 5: `get_agent_tree` RPC + service

**Files:** Create `supabase/migrations/029_agent_tree.sql`; Modify `apps/app/src/types/analytics.ts`, `apps/app/src/lib/services/analytics.service.ts`; Test `apps/app/src/lib/__tests__/analytics.service.test.ts`

**Interfaces:** Produces `AgentTreeNode`; `getAgentTree(supabase, userId, sessionId): Promise<ServiceResult<AgentTreeNode[]>>`.

- [ ] **Step 1: Write the migration**

```sql
-- 029: Recursive agent tree for a session. Roots at true roots AND orphans
-- (parent not present in this session's agent set) so no node disappears.
-- Depth is computed here, never stored. Depth is capped to survive a cycle.

create or replace function public.get_agent_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  agent_id           text,
  parent_agent_id    text,
  agent_type         text,
  edge_label         text,
  depth              int,
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_ms        bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  estimated_cost_usd numeric
) language sql stable as $$
  with recursive scoped as (
    select a.agent_id, a.parent_agent_id, a.agent_type, a.edge_label,
           a.started_at, a.ended_at, a.duration_ms,
           a.input_tokens, a.output_tokens, a.model
    from public.agents a
    where a.user_id = p_user_id
      and a.session_id = p_session_id
  ),
  tree as (
    select s.agent_id, s.parent_agent_id, s.agent_type, s.edge_label,
           s.started_at, s.ended_at, s.duration_ms,
           s.input_tokens, s.output_tokens, s.model,
           0 as depth
    from scoped s
    where s.parent_agent_id is null
       or not exists (
            select 1 from scoped p where p.agent_id = s.parent_agent_id
          )

    union all

    select c.agent_id, c.parent_agent_id, c.agent_type, c.edge_label,
           c.started_at, c.ended_at, c.duration_ms,
           c.input_tokens, c.output_tokens, c.model,
           t.depth + 1
    from scoped c
    join tree t on c.parent_agent_id = t.agent_id
    where t.depth < 50
  )
  select
    t.agent_id,
    t.parent_agent_id,
    t.agent_type,
    t.edge_label,
    t.depth,
    t.started_at,
    t.ended_at,
    coalesce(t.duration_ms, 0)::bigint   as duration_ms,
    coalesce(t.input_tokens, 0)::bigint  as input_tokens,
    coalesce(t.output_tokens, 0)::bigint as output_tokens,
    round((
      coalesce(t.input_tokens,  0) * coalesce(mp.input_cost_per_1m,  0) / 1000000.0 +
      coalesce(t.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
    )::numeric, 6) as estimated_cost_usd
  from tree t
  left join public.model_pricing mp on mp.model_id = t.model
  order by t.depth, t.started_at nulls last;
$$;
```

- [ ] **Step 2: Add the type**

In `apps/app/src/types/analytics.ts`:

```ts
export interface AgentTreeNode {
  agent_id: string;
  parent_agent_id: string | null;
  agent_type: string | null;
  edge_label: string | null;
  depth: number;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number;
  input_tokens: number;
  output_tokens: number;
  estimated_cost_usd: number;
}
```

- [ ] **Step 3: Write the failing service test**

Add to `apps/app/src/lib/__tests__/analytics.service.test.ts` (uses `createMockSupabase`):

```ts
import { getAgentTree } from "../services/analytics.service";

describe("getAgentTree", () => {
  it("maps agent tree rows", async () => {
    const rows = [{
      agent_id: "ag-root", parent_agent_id: null, agent_type: "general-purpose",
      edge_label: null, depth: 0, started_at: "2026-07-20T00:00:00Z", ended_at: null,
      duration_ms: 1000, input_tokens: 10, output_tokens: 2, estimated_cost_usd: 0.01,
    }];
    const supabase = createMockSupabase({}, { get_agent_tree: { data: rows } });
    const result = await getAgentTree(supabase, USER_ID, "sess-1");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0].agent_id).toBe("ag-root");
      expect(result.data[0].parent_agent_id).toBeNull();
    }
  });

  it("returns RPC_FAILED on error", async () => {
    const supabase = createMockSupabase({}, {
      get_agent_tree: { data: null, error: { message: "boom" } },
    });
    const result = await getAgentTree(supabase, USER_ID, "sess-1");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe("RPC_FAILED");
  });
});
```

- [ ] **Step 4: Run to verify it fails, then implement**

Run: `cd apps/app && bun test src/lib/__tests__/analytics.service.test.ts` → FAIL.

Append to `apps/app/src/lib/services/analytics.service.ts` (add `AgentTreeNode` to the type import):

```ts
export async function getAgentTree(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<ServiceResult<AgentTreeNode[]>> {
  const { data, error } = await supabase.rpc("get_agent_tree", {
    p_user_id: userId,
    p_session_id: sessionId,
  });

  if (error) {
    return {
      success: false,
      error: { code: "RPC_FAILED", message: "Failed to get agent tree", details: error.message },
    };
  }

  return { success: true, data: (data as AgentTreeNode[]) ?? [] };
}
```

- [ ] **Step 5: Run tests + manual SQL smoke**

Run: `cd apps/app && bun test` → all pass.
Manual (pending if no DB): `select * from public.get_agent_tree('<user-uuid>', '<session-id>');`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/029_agent_tree.sql apps/app/src/types/analytics.ts apps/app/src/lib/services/analytics.service.ts apps/app/src/lib/__tests__/analytics.service.test.ts
git commit -m "feat(agents): add get_agent_tree recursive lineage RPC"
```

---

## Task 6: Generalize the graph transform (no existing test may change)

**Files:** Modify `apps/app/src/lib/graph/spawn-graph.ts`; Test `apps/app/src/lib/graph/__tests__/spawn-graph.test.ts`

**Interfaces:** Produces `GraphInputNode`, `buildGraphFromNodes(nodes, opts)`, `buildAgentGraph(tree, opts)`. `buildSpawnGraph(SessionTreeNode[], opts)` keeps its exact signature and behavior.

> **Hard requirement:** the 6 existing `buildSpawnGraph` tests must pass **unmodified**. If you find yourself editing them, the generalization is wrong — stop and report.

- [ ] **Step 1: Write the failing tests**

Add to `apps/app/src/lib/graph/__tests__/spawn-graph.test.ts` (do NOT touch the existing cases):

```ts
import { buildAgentGraph } from "../spawn-graph";
import type { AgentTreeNode } from "@/types/analytics";

function agent(p: Partial<AgentTreeNode> & { agent_id: string }): AgentTreeNode {
  return {
    agent_id: p.agent_id,
    parent_agent_id: p.parent_agent_id ?? null,
    agent_type: p.agent_type ?? null,
    edge_label: p.edge_label ?? null,
    depth: p.depth ?? 0,
    started_at: p.started_at ?? "2026-07-20T00:00:00Z",
    ended_at: p.ended_at ?? null,
    duration_ms: p.duration_ms ?? 0,
    input_tokens: p.input_tokens ?? 0,
    output_tokens: p.output_tokens ?? 0,
    estimated_cost_usd: p.estimated_cost_usd ?? 0,
  };
}

describe("buildAgentGraph", () => {
  it("builds nodes and edges from agent lineage", () => {
    const g = buildAgentGraph([
      agent({ agent_id: "root", depth: 0, estimated_cost_usd: 0.1, duration_ms: 100 }),
      agent({ agent_id: "child", parent_agent_id: "root", depth: 1,
              estimated_cost_usd: 0.4, duration_ms: 90, edge_label: "verify" }),
    ]);
    expect(g.nodes.map((n) => n.id).sort()).toEqual(["child", "root"]);
    expect(g.edges).toHaveLength(1);
    expect(g.edges[0].source).toBe("root");
    expect(g.edges[0].target).toBe("child");
    expect(g.edges[0].label).toBe("verify");
  });

  it("labels nodes by agent_type, falling back to a short agent id", () => {
    const g = buildAgentGraph([
      agent({ agent_id: "abcdef123456", agent_type: "Explore" }),
      agent({ agent_id: "zyxwvu987654", agent_type: null }),
    ]);
    const labels = g.nodes.map((n) => n.label);
    expect(labels).toContain("Explore");
    expect(labels.some((l) => l.startsWith("zyxwvu"))).toBe(true);
  });

  it("normalizes cost heat and marks the critical path", () => {
    const g = buildAgentGraph([
      agent({ agent_id: "root", depth: 0, duration_ms: 100, estimated_cost_usd: 0.1 }),
      agent({ agent_id: "a", parent_agent_id: "root", depth: 1, duration_ms: 90,
              estimated_cost_usd: 0.4 }),
      agent({ agent_id: "b", parent_agent_id: "root", depth: 1, duration_ms: 10,
              estimated_cost_usd: 0.05 }),
    ]);
    expect(g.nodes.find((n) => n.id === "a")!.costHeat).toBeCloseTo(1);
    expect(g.nodes.filter((n) => n.onCriticalPath).map((n) => n.id).sort())
      .toEqual(["a", "root"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/app && bun test src/lib/graph/__tests__/spawn-graph.test.ts` → FAIL (no `buildAgentGraph`).

- [ ] **Step 3: Implement by extraction**

In `apps/app/src/lib/graph/spawn-graph.ts`:

1. Add the structural input type and refactor the existing body into a core that consumes it:

```ts
export interface GraphInputNode {
  id: string;
  parentId: string | null;
  label: string;
  depth: number;
  costUsd: number;
  durationMs: number;
  edgeLabel: string | null;
  sortKey: string;
}

export function buildGraphFromNodes(
  input: GraphInputNode[],
  opts: BuildOpts = {}
): SpawnGraph {
  // Move the ENTIRE existing buildSpawnGraph body here, replacing:
  //   n.session_id            -> n.id
  //   n.parent_session_id     -> n.parentId
  //   n.estimated_cost_usd    -> n.costUsd
  //   n.duration_ms           -> n.durationMs
  //   n.edge_label            -> n.edgeLabel
  //   labelFor(n)             -> n.label
  //   a.started_at.localeCompare(b.started_at) -> a.sortKey.localeCompare(b.sortKey)
  // The algorithm itself (ordering, cap, heat, critical path, edge filter)
  // must be unchanged.
}
```

2. Keep `buildSpawnGraph` as a thin adapter so its callers and its 6 tests are untouched:

```ts
export function buildSpawnGraph(tree: SessionTreeNode[], opts: BuildOpts = {}): SpawnGraph {
  return buildGraphFromNodes(
    tree.map((n) => ({
      id: n.session_id,
      parentId: n.parent_session_id,
      label: labelFor(n),
      depth: n.depth,
      costUsd: n.estimated_cost_usd,
      durationMs: n.duration_ms,
      edgeLabel: n.edge_label ?? null,
      sortKey: n.started_at,
    })),
    opts
  );
}
```

3. Add the agent adapter:

```ts
export function buildAgentGraph(tree: AgentTreeNode[], opts: BuildOpts = {}): SpawnGraph {
  return buildGraphFromNodes(
    tree.map((n) => ({
      id: n.agent_id,
      parentId: n.parent_agent_id,
      label: n.agent_type || n.agent_id.slice(0, 8),
      depth: n.depth,
      costUsd: n.estimated_cost_usd,
      durationMs: n.duration_ms,
      edgeLabel: n.edge_label,
      sortKey: n.started_at ?? "",
    })),
    opts
  );
}
```

Import `AgentTreeNode` from `@/types/analytics`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/app && bun test src/lib/graph/__tests__/spawn-graph.test.ts`
Expected: ALL pass — the 6 original cases **unmodified** plus your 3 new ones.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/lib/graph/
git commit -m "feat(graph): generalize spawn-graph transform and add agent adapter"
```

---

## Task 7: Render the agent graph on session detail

**Files:** Modify `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`, `apps/app/src/components/graph/spawn-graph-view.tsx`

- [ ] **Step 1: Point the view at agent data**

`SpawnGraphView` currently takes `tree: SessionTreeNode[]` and calls `buildSpawnGraph`. Change it to take `tree: AgentTreeNode[]` and call `buildAgentGraph`. Everything downstream (dagre layout, cost heat, critical-path outline, weight toggle, truncation notice, edge labels) consumes `SpawnGraph` and needs no change — verify that's true before editing.

- [ ] **Step 2: Fetch the agent tree on the page**

In `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`:
- Replace the `getSessionTree` import and call with `getAgentTree(supabase, user.id, typedSession.session_id)`.
- Replace the `tree.length > 1` gate with `agents.length > 0` — a single subagent is still a meaningful graph (one root node), unlike the session case where a lone node was just the session itself.
- Keep the card placement and title ("Spawn graph"). Remove the now-unused `getSessionTree` import.

Read the page first; the `<Timeline />` component and everything else must be left intact.

- [ ] **Step 3: Typecheck**

Run: `cd apps/app && bunx tsc --noEmit` — no NEW errors above the pre-existing `bun:test` baseline; confirm none reference the touched files. Then `bun test` → all pass.

- [ ] **Step 4: Verify (manual, pending)**

Note in the report that visual verification requires running the app against a database containing plugin ≥1.3.0 data, and is pending-manual.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(dashboard\)/sessions/\[id\]/page.tsx apps/app/src/components/graph/spawn-graph-view.tsx
git commit -m "feat(graph): render agent lineage graph on session detail"
```

---

## Self-Review

**Spec coverage:**
- §3.1 ingest accepts `subagent_start`; plugin filter relaxed, correctly sequenced → Tasks 1, 2 ✓
- §3.2 `agents` table + partial-upsert promotion from three event types → Tasks 3, 4 ✓
- §3.3 lineage from `origin_agent_id`; depth not stored → Tasks 4, 5 ✓
- §3.4 recursive RPC with orphan roots, depth cap, per-term-coalesced cost → Task 5 ✓
- §3.5 transform generalized by extraction, existing tests untouched → Task 6 ✓
- §3.6 session detail renders agents; session-tree fetch removed → Task 7 ✓
- §5 edge cases: orphan roots (Task 5 CTE), cycles (depth cap), agent without start (nullable columns), no agents (Task 7 gate), null pricing (coalesce) ✓
- §7 Q1 answered: each event contributes only its owned columns, so a partial upsert cannot null-clobber ✓

**Placeholder scan:** Task 4 Step 1 and Task 6 Step 3 describe tests/refactor by precise reference to existing file patterns rather than restating them — deliberate, because both must match code the implementer has to read anyway. Every other step carries literal code.

**Type consistency:** `AgentTreeNode` defined Task 5, consumed Tasks 6 and 7; `GraphInputNode`/`buildGraphFromNodes`/`buildAgentGraph` defined Task 6, consumed Task 7; `getAgentTree` defined Task 5, consumed Task 7; the upsert key `(user_id, agent_id)` matches the unique constraint from Task 3.

**Known consequences:** no backfill — pre-1.3.0 sessions show no graph; `get_session_tree` and migration 025's edge-label lateral become unused but are left in place; migrations 022–029 remain unverified against a real Postgres.
