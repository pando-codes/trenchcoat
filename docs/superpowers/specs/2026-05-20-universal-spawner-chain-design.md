# Universal Spawner Chain Design

**Date:** 2026-05-20
**Status:** Approved

## Background

Phase 1 of skill logging established a one-level parent-child relationship: skills are parents of the tool calls they trigger, captured via `active_skill_id` on `tool_use` events. This is sufficient for skill-level analytics but cannot answer questions that cross agent boundaries:

- Which tools ran inside a subagent spawned by a skill?
- What did a skill ultimately cost, including work done by subagents it triggered?
- How do Sessions, Skills, Tools, and Agents relate to each other in a full invocation tree?

This spec defines a universal spawner chain that replaces the narrow `active_skill_id` concept with a generalized parent-child model covering all entity types: Sessions, Agent invocations, Skill invocations, and Tool calls.

## Core Model

Every event that has a direct parent carries two fields:

| Field | Values | Meaning |
|---|---|---|
| `spawner_id` | `activation_id` of a skill, or `agent_id` of an agent invocation | The entity that directly triggered this event |
| `spawner_type` | `"skill"` \| `"agent"` | Disambiguates the spawner entity type |

Root-level entities (nothing spawned them) carry no spawner fields.

Three entity types participate in the graph:

| Entity | ID field | spawner_type value |
|---|---|---|
| Skill invocation | `activation_id` (existing, unchanged) | `"skill"` |
| Agent invocation | `agent_id` (new) | `"agent"` |
| Session | `session_id` (existing, unchanged) | — (session is a container, not a spawner type) |

### Example tree

```
Session A (session_id: S1)
├── tool_use: Bash              ← no spawner (direct)
├── skill_use: brainstorming    ← activation_id: SKL-1, no spawner
│   ├── tool_use: Read          ← spawner_id: SKL-1, spawner_type: skill
│   ├── tool_use: Bash          ← spawner_id: SKL-1, spawner_type: skill
│   └── tool_use: Agent         ← spawner_id: SKL-1, spawner_type: skill, agent_id: AGT-1
│
Session B  (session_id: S2)
  parent_session_id: S1
  spawner_id: AGT-1, spawner_type: agent
    ├── tool_use: Read          ← no spawner (direct in child session)
    └── skill_use: writing-plans ← activation_id: SKL-2, no spawner
        └── tool_use: Edit      ← spawner_id: SKL-2, spawner_type: skill
```

Roll-up attribution for `brainstorming` (SKL-1): direct tool calls in Session A + all costs inside Session B, because AGT-1 is owned by SKL-1.

### What this replaces

`active_skill_id` is removed from all event data. Every place it appeared is replaced by `spawner_id` + `spawner_type`. There is no backward-compatibility shim — no production users exist.

---

## Plugin Changes

### `telemetry.py`

**Active context file (renamed and generalized):**

`.skill_context_{session_id}.json` → `.active_context_{session_id}.json`

New format:
```json
{
  "spawner_id": "a1b2c3d4e5f6",
  "spawner_type": "skill",
  "spawner_name": "superpowers:brainstorming",
  "activated_at": "2026-05-20T14:23:01.123Z"
}
```

Updated helpers (rename existing, update format):
- `write_active_context(session_id, spawner_id, spawner_type, spawner_name)` — replaces `write_skill_context`
- `read_active_context(session_id) -> dict | None` — replaces `read_skill_context`
- `clear_active_context(session_id)` — replaces `clear_skill_context`

**Agent spawn context file (new):**

`.agent_spawn_context.json` — NOT session-scoped. Written by the parent process when the `Agent` tool fires; read and deleted by the child process at `session_start`. Not session-scoped because the child process has a different session_id and cannot predict the parent's.

Claude Code spawns one subagent at a time — the parent process blocks until the subagent completes before the next `Agent` tool call can fire. This makes a single shared file safe. If Claude Code changes this behavior in the future, the file would need to be keyed by a handshake ID.

Format:
```json
{
  "parent_session_id": "S1",
  "agent_id": "AGT-1",
  "spawner_id": "SKL-1",
  "spawner_type": "skill"
}
```

New helpers:
- `write_agent_spawn_context(parent_session_id, agent_id, spawner_id, spawner_type)`
- `read_agent_spawn_context() -> dict | None`
- `clear_agent_spawn_context()`

**Pending stack extension:**

The pending stack entry for an `Agent` tool call carries an additional `agent_id` field so that `subagent_stop` and `post_tool_use` can retrieve it without re-generating it:

```json
{
  "tool_name": "Agent",
  "correlation_id": "x9y8z7",
  "agent_id": "AGT-1",
  "started_at": 1234567890,
  "started_ts": "2026-05-20T14:23:01.123Z"
}
```

**New helper:**

`peek_pending_by_tool(session_id, tool_name) -> dict | None` — reads the most recent pending entry matching `tool_name` without popping it. Used by `subagent_stop` to retrieve `agent_id` while leaving the entry for `post_tool_use` to pop normally.

---

### `pre_tool_use.py`

**All tools:**

Read active context before writing the `tool_start` event. If context exists, append `spawner_id` and `spawner_type` to event data (replaces `active_skill_id`). The Skill tool reads the context BEFORE updating it, so the Skill invocation itself is tagged with whatever spawned it (not itself).

**`Skill` tool:**

Same as today but using the new context format:
1. Generate `activation_id`.
2. Emit `skill_use` event with `activation_id` (and `spawner_id`/`spawner_type` if a parent context was active).
3. Write active context: `{spawner_id: activation_id, spawner_type: "skill", spawner_name: skill_name}`.

**`Agent` tool:**

1. Generate `agent_id`.
2. Read current active context (to capture the agent's own spawner).
3. Emit `tool_start` event for Agent tool with `spawner_id`/`spawner_type` from current context (same as any other tool), plus `agent_id` in data.
4. Push to pending stack with `agent_id` included in the entry.
5. Write agent spawn context: `{parent_session_id, agent_id, spawner_id: ctx?.spawner_id, spawner_type: ctx?.spawner_type}`.

---

### `post_tool_use.py`

**All tools:**

Read active context → append `spawner_id` + `spawner_type` to `tool_end` event data (replaces `active_skill_id`).

**`Agent` tool specifically:**

After popping the pending entry, call `clear_agent_spawn_context()`. This guards against stale spawn context in the unlikely case the child process crashed before reading it.

---

### `session_start.py`

After writing the `session_start` event:
1. Call `read_agent_spawn_context()`.
2. If present, include `parent_session_id`, `spawner_id`, `spawner_type` in the `session_start` event data.
3. Call `clear_agent_spawn_context()`.

The `session_start` event for a subagent session:
```json
{
  "event": "session_start",
  "session_id": "S2",
  "data": {
    "cwd": "/Users/...",
    "parent_session_id": "S1",
    "spawner_id": "AGT-1",
    "spawner_type": "agent"
  }
}
```

---

### `subagent_stop.py`

Call `peek_pending_by_tool(session_id, "Agent")` to retrieve the `agent_id`. Include it in the `subagent_stop` event data:

```json
{
  "event": "subagent_stop",
  "data": {
    "agent_id": "AGT-1",
    "agent_type": "subagent",
    "reason": "...",
    "tool_counts": {...},
    ...
  }
}
```

---

### `user_prompt_submit.py`

One-line change: call `clear_active_context(session_id)` instead of `clear_skill_context(session_id)`.

---

## Event Shapes

**`skill_use` event (updated — adds spawner fields when applicable):**
```json
{
  "event": "skill_use",
  "session_id": "S1",
  "data": {
    "skill_name": "superpowers:brainstorming",
    "activation_id": "SKL-1",
    "args_preview": "...",
    "spawner_id": "AGT-0",
    "spawner_type": "agent"
  }
}
```
`spawner_id`/`spawner_type` are omitted when the skill is invoked at the root level.

**`tool_use` event (updated — replaces `active_skill_id`):**
```json
{
  "event": "tool_use",
  "session_id": "S1",
  "data": {
    "tool_name": "Read",
    "correlation_id": "x9y8z7",
    "input_preview": "...",
    "spawner_id": "SKL-1",
    "spawner_type": "skill"
  }
}
```

**`tool_use` event for Agent tool (updated — adds `agent_id`):**
```json
{
  "event": "tool_use",
  "session_id": "S1",
  "data": {
    "tool_name": "Agent",
    "correlation_id": "abc123",
    "agent_id": "AGT-1",
    "spawner_id": "SKL-1",
    "spawner_type": "skill"
  }
}
```

**`subagent_stop` event (updated — adds `agent_id`):**
```json
{
  "event": "subagent_stop",
  "session_id": "S1",
  "data": {
    "agent_id": "AGT-1",
    "agent_type": "subagent",
    "reason": "...",
    "tool_counts": {},
    "tool_count_total": 0,
    "turns": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "model": null
  }
}
```

**`session_start` event for subagent sessions (updated):**
```json
{
  "event": "session_start",
  "session_id": "S2",
  "data": {
    "cwd": "/Users/...",
    "parent_session_id": "S1",
    "spawner_id": "AGT-1",
    "spawner_type": "agent"
  }
}
```

---

## Database

### Migration — `sessions` table

```sql
ALTER TABLE sessions
  ADD COLUMN parent_session_id text,
  ADD COLUMN spawner_id         text,
  ADD COLUMN spawner_type       text CHECK (spawner_type IN ('skill', 'agent'));

CREATE INDEX idx_sessions_parent_session_id
  ON sessions(parent_session_id)
  WHERE parent_session_id IS NOT NULL;
```

### `events.service.ts` update

When ingesting a `session_start` event, extract `parent_session_id`, `spawner_id`, `spawner_type` from `data` and include them in the `sessions` upsert. No other ingestion path changes.

### New RPC — `get_session_tree(p_org_id uuid, p_session_id text)`

Recursive CTE on `parent_session_id`. Returns one row per session in the subtree rooted at `p_session_id`, including aggregated stats derived from the `events` table for each session:

```sql
WITH RECURSIVE tree AS (
  SELECT session_id, parent_session_id, spawner_id, spawner_type, 0 AS depth
  FROM sessions
  WHERE session_id = p_session_id AND org_id = p_org_id

  UNION ALL

  SELECT s.session_id, s.parent_session_id, s.spawner_id, s.spawner_type, t.depth + 1
  FROM sessions s
  JOIN tree t ON s.parent_session_id = t.session_id
  WHERE s.org_id = p_org_id
)
SELECT
  t.*,
  COUNT(DISTINCT e.id) FILTER (WHERE e.event = 'tool_use')       AS tool_count,
  COUNT(DISTINCT e.id) FILTER (WHERE e.event = 'skill_use')      AS skill_count,
  COUNT(DISTINCT e.id) FILTER (WHERE e.event = 'subagent_stop')  AS subagent_count,
  COALESCE(SUM((e.data->>'input_tokens')::bigint), 0)            AS input_tokens,
  COALESCE(SUM((e.data->>'output_tokens')::bigint), 0)           AS output_tokens
FROM tree t
LEFT JOIN events e ON e.session_id = t.session_id
GROUP BY t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type, t.depth
ORDER BY t.depth, t.session_id;
```

### New RPC — `get_entity_rollup(p_org_id uuid, p_spawner_id text, p_spawner_type text, p_date_from date, p_date_to date)`

For a given spawner entity, aggregates tool calls, skill invocations, tokens, and cost across:
1. Direct events in the same session with matching `spawner_id` in `data`.
2. All events in descendant sessions whose `spawner_id` chain traces back to this entity.

Uses a recursive CTE on `sessions.spawner_id` to find all descendant sessions, then joins to `events`.

Returns: `total_tools`, `total_skills`, `total_subagents`, `input_tokens`, `output_tokens`, `estimated_cost_usd`.

### `skill_aggregates` — no schema change

`tool_calls_triggered` continues to count same-session tool calls only. Cross-session roll-up is served on demand by `get_entity_rollup`. This avoids making the nightly aggregate job recursive and keeps the aggregate table's semantics clear.

---

## Dashboard

### Sessions page (`/sessions`) — update

- Add **Type** column: subagent sessions (those with `parent_session_id`) show a "Subagent" badge with a link to the parent session.
- Add **Subagents** column: count of direct child sessions for each row.
- Both columns are empty/zero for root sessions.

### Session detail page (`/sessions/[id]`) — new route

Server component fetches `get_session_tree` and the session's own events. Passes data to a client `SessionTree` component.

**Summary cards (top row):**
- Total tools (across full tree)
- Total skills (across full tree)
- Total subagents
- Total estimated cost (rolled up)

**Entity tree:**

Collapsible nested list using shadcn `Collapsible` (no new dependencies). Node types and their children:

| Node type | Children |
|---|---|
| Session | Direct tool calls, skill invocations, subagent sessions |
| Skill invocation | Tool calls with `spawner_id = activation_id` |
| Agent invocation | The child session (linked, navigable) |
| Tool call | Leaf node |

Each node shows: type icon, name, tool count (for skills/sessions), token count, estimated cost.

Clicking a subagent session node navigates to `/sessions/[child-id]`.

### Skills page (`/skills`) — update

Add **Cross-session tools** column populated by `get_entity_rollup` for each skill. Displayed alongside the existing **Tools triggered** column (which remains same-session only). Tooltip on the column header explains the difference.

---

## Migration Notes

- `active_skill_id` is removed from all event data and plugin code. No migration needed on stored events — old events simply lack `spawner_id` and are treated as root-level. Queries that formerly filtered on `active_skill_id` are updated to `data->>'spawner_id'`.
- The `.skill_context_{session_id}.json` context files on disk become stale after deploy. They are benign (ignored by the updated code which looks for `.active_context_`) and will be cleaned up by the existing retention cleanup on their next pass.
- The `skill_aggregates` table's `tool_calls_triggered` column becomes slightly under-counted for skills that spawned subagents. This is acceptable — the Skills page cross-session column surfaces the accurate number.
