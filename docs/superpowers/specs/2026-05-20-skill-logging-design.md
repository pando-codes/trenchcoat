# Skill Logging Design

**Date:** 2026-05-20
**Status:** Approved
**Phase:** 1 (Phase 2 proposal included at the end)

## Background

Customers want to know which skills are invoked during a session, how frequently, and what those invocations cost. Skills in Claude Code are executed via the `Skill` tool — which already flows through the plugin's `PreToolUse`/`PostToolUse` hooks. The skill name is currently buried in a truncated `input_preview` string and not queryable. This spec defines Phase 1: structured skill event capture, windowed tool attribution, and a dedicated Skills dashboard page.

## Phase 1 — Skill Context Window Tracking

### Core concept: activation window

When the `Skill` tool fires, we assign that invocation an `activation_id` (a short UUID, same format as existing `correlation_id`). All tool events fired before the next `UserPromptSubmit` are tagged with `active_skill_id`. This window captures the tools a skill triggers without requiring any cross-process coordination or LLM transcript parsing.

```
UserPromptSubmit  →  clears skill context
  Skill (activation_id: abc123)
    Tool: Read          (active_skill_id: abc123)
    Tool: Bash          (active_skill_id: abc123)
    Tool: Edit          (active_skill_id: abc123)
  Skill (activation_id: def456)   ← second skill in same turn
    Tool: WebSearch     (active_skill_id: def456)
UserPromptSubmit  →  clears skill context
```

If two skills are invoked in the same turn, the context file is overwritten by the second skill — subsequent tools are attributed to the most recently activated skill. This is the correct behavior: the most recent skill activation is the active context.

### Plugin changes

**`pre_tool_use.py`**

- Detect `tool_name == "Skill"`.
- Extract `tool_input["skill"]` and `tool_input.get("args")` from hook input.
- Generate `activation_id`.
- Write a `skill_use` event: `{ skill_name, args_preview, activation_id }`.
- Write the skill context file: `~/.claude/trenchcoat/.skill_context_{session_id}.json` containing `{ activation_id, skill_name, activated_at }`.
- For all tool calls (Skill or otherwise): read the context file if present and append `active_skill_id` to the `tool_start` event data.

**`post_tool_use.py`**

- For all tool calls: read the context file if present and append `active_skill_id` to the `tool_end` event data.
- No special handling needed for the `Skill` tool itself — duration is captured by the existing pending/pop mechanism.

**`user_prompt_submit.py`**

- Delete `~/.claude/trenchcoat/.skill_context_{session_id}.json` if it exists.
- This closes the activation window cleanly at each user turn boundary.

**`telemetry.py`**

- Add helpers: `write_skill_context(session_id, activation_id, skill_name)`, `read_skill_context(session_id) -> dict | None`, `clear_skill_context(session_id)`.
- Context file is session-scoped to avoid cross-session contamination.

**`_EVENT_TYPE_MAP`**

- Add `"skill_use": "skill_use"` mapping so the event passes through to the SaaS API as-is.

### Event shapes

**`skill_use` event:**
```json
{
  "ts": "2026-05-20T14:23:01.123Z",
  "event": "skill_use",
  "session_id": "abc-123",
  "seq": 7,
  "data": {
    "skill_name": "superpowers:brainstorming",
    "args_preview": "implement skill logging feature",
    "activation_id": "a1b2c3d4e5f6"
  }
}
```

**Enriched `tool_start` event (when a skill is active):**
```json
{
  "event": "tool_use",
  "data": {
    "tool_name": "Read",
    "correlation_id": "x9y8z7",
    "input_preview": "/src/lib/telemetry.py...",
    "active_skill_id": "a1b2c3d4e5f6"
  }
}
```

### API layer

No changes to `POST /api/v1/events`. The `skill_use` event type is ingested like any other. `events.service.ts` stores it in the `events` table as-is.

### Database

**New migration — `skill_aggregates` table:**

```sql
create table skill_aggregates (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references user_profiles(id),
  date         date not null,
  skill_name   text not null,
  invocation_count      int not null default 0,
  tool_calls_triggered  int not null default 0,
  input_tokens          bigint not null default 0,
  output_tokens         bigint not null default 0,
  estimated_cost_usd    numeric(10,6) not null default 0,
  unique (org_id, date, skill_name)
);
```

**Updated `update_daily_aggregate()` RPC:**

Extended to also compute `skill_aggregates` rows for the given org/date:
- Count `skill_use` events → `invocation_count`
- Count `tool_use` events grouped by `data->>'active_skill_id'`, joined back to `skill_use` events for the skill name → `tool_calls_triggered`
- Token/cost attribution: sum token counts from `assistant_stop` events within the session, prorated by the fraction of tool calls attributable to each skill (approximate but sufficient for Phase 1)

**New RPC `get_skill_stats(p_org_id, p_date_from, p_date_to)`:**

Returns rows of `(skill_name, invocation_count, tool_calls_triggered, avg_tools_per_invocation, estimated_cost_usd)` aggregated across the date range, ordered by `invocation_count` desc.

### Dashboard page

**Route:** `apps/app/src/app/(dashboard)/skills/page.tsx`

Follows the same server component pattern as the existing tools page: fetch via Supabase server client, pass data to client chart/table components.

**Summary cards (top row):**
- Total skill invocations
- Unique skills used
- Avg tools triggered per invocation
- Total estimated cost attributed to skills

**Skills breakdown table:**

| Skill | Invocations | Tools triggered | Avg tools/invocation | Est. cost |
|-------|-------------|-----------------|----------------------|-----------|
| `superpowers:brainstorming` | 142 | 380 | 2.7 | $0.84 |

Sortable by any column. Date range controlled by the existing dashboard date picker.

**Sidebar navigation:** Add "Skills" entry in `apps/app/src/components/dashboard/sidebar.tsx` between "Tools" and "Activity".

---

## Phase 2 Proposal — Full Dependency Graph

*This is a forward-looking design proposal, not an implementation spec. It describes the intended capabilities, design, and new infrastructure that would be needed for full recursive skill attribution.*

### What it enables

Phase 1 can answer: "Skill X was invoked 42 times and triggered 110 tool calls."

Phase 2 answers:
- "Skill X triggered Skill Y in 30% of its invocations."
- "This skill chain (brainstorming → writing-plans → executing-plans) costs an average of $0.40 per activation."
- "Subagent spawned during Skill X invoked Skill Z — here's the full tree."
- "Skill X is looping — it's triggering itself recursively."
- Total cost of a skill including all recursive activity across subagent boundaries.

### Design

Each event carries an `activation_id` pointing to its nearest parent skill activation. When a skill triggers a subagent, and that subagent invokes another skill, the child skill's activation is linked to the parent via a `parent_activation_id` field. This forms an adjacency list that can be walked to reconstruct the full invocation tree.

**Event shape additions:**

```json
{
  "event": "skill_use",
  "data": {
    "skill_name": "superpowers:writing-plans",
    "activation_id": "def456",
    "parent_activation_id": "abc123",   // ← new in Phase 2
    "depth": 1                           // ← nesting depth for loop detection
  }
}
```

### New infrastructure

**Cross-process context propagation:**

Subagents run in child processes. Claude Code passes context via environment variables (e.g., `CLAUDE_SUBAGENT_ID`). Phase 2 would need the parent `activation_id` to be written to a shared location the child process can read — either a file keyed by subagent session ID, or an environment variable injected at subagent spawn time.

The `subagent_stop.py` hook already has `session_id` — Phase 2 would add a lookup: "which skill activation spawned this subagent?" This requires the parent session to write a `subagent_activation_map` file before spawning.

**`activation_graph` table:**

```sql
create table activation_graph (
  activation_id        text not null,
  parent_activation_id text,            -- null for root activations
  session_id           text not null,
  skill_name           text not null,
  depth                int not null default 0,
  org_id               uuid not null,
  created_at           timestamptz not null,
  primary key (activation_id)
);
```

This is an adjacency list. Tree queries use recursive CTEs (`WITH RECURSIVE`).

**Loop detection:**

Any `activation_id` that appears as its own ancestor in the graph (via recursive CTE with cycle detection) is flagged. Surfaced as a warning on the dashboard.

**New RPC `get_skill_tree(p_activation_id)`:**

Returns the full subtree for a given activation as a nested JSON structure. Used by the dashboard drill-down view.

### New dashboard capabilities

- **Skill dependency graph visualization** — a force-directed or tree layout showing which skills trigger which, with edge weights proportional to frequency.
- **Drill-down view** — click a skill invocation to see its full activation tree.
- **Chain cost analysis** — surface the most expensive skill chains across the date range.
- **Loop alerts** — highlight sessions where a skill chain created a recursive loop.

### Complexity and prerequisites

- Cross-process activation ID propagation requires changes to how Claude Code passes context to subagents. This may depend on Claude Code exposing a mechanism for plugins to inject environment into subagent spawns.
- Recursive CTE queries on `activation_graph` at scale will need appropriate indexes (`parent_activation_id`, `org_id`, `created_at`).
- The dependency graph visualization is a new frontend component class (likely D3 or a graph library) not currently used in the dashboard.
- Phase 1 must be shipped and validated first — the `activation_id` field Phase 1 introduces is the foundation Phase 2 builds on.
