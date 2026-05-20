# Skill Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log skill invocations as first-class telemetry events, tag downstream tool calls with the active skill's ID, and surface skill usage on a dedicated Skills dashboard page.

**Architecture:** The plugin detects `Skill` tool calls in `pre_tool_use.py`, emits a `skill_use` event with an `activation_id`, writes that ID to a session-scoped context file, and tags all subsequent `tool_start`/`tool_end` events with `active_skill_id` until `user_prompt_submit.py` clears the context. A new Postgres RPC `get_skill_stats` queries these events and the dashboard page renders the results.

**Tech Stack:** Python 3 (plugin hooks), pytest (plugin tests), SQL/Postgres (migration + RPC), TypeScript/Next.js 16 App Router, shadcn/ui, Supabase JS client.

---

## File Map

**Create:**
- `supabase/migrations/017_skill_stats.sql` — `get_skill_stats` RPC
- `apps/app/src/app/(dashboard)/skills/page.tsx` — skills dashboard server component
- `apps/app/src/app/(dashboard)/skills/loading.tsx` — loading skeleton

**Modify:**
- `claude-plugin/lib/telemetry.py` — skill context helpers + `skill_use` event type mapping
- `claude-plugin/hooks/pre_tool_use.py` — emit `skill_use` event, write context, tag tool events
- `claude-plugin/hooks/post_tool_use.py` — tag `tool_end` events with `active_skill_id`
- `claude-plugin/hooks/user_prompt_submit.py` — clear skill context on new prompt
- `claude-plugin/tests/test_telemetry.py` — tests for new helpers and hook behaviors
- `apps/app/src/types/analytics.ts` — add `SkillStat` type
- `apps/app/src/components/dashboard/sidebar.tsx` — add Skills nav entry

---

## Task 1: Add skill context helpers to telemetry.py

**Files:**
- Modify: `claude-plugin/lib/telemetry.py`
- Modify: `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing tests**

Add a new class at the bottom of `claude-plugin/tests/test_telemetry.py`:

```python
# ---------------------------------------------------------------------------
# Skill context helpers
# ---------------------------------------------------------------------------

class TestSkillContext:
    def test_write_then_read_roundtrip(self, isolated_telemetry):
        telemetry.write_skill_context("s1", "act-abc", "superpowers:brainstorming")
        ctx = telemetry.read_skill_context("s1")
        assert ctx is not None
        assert ctx["activation_id"] == "act-abc"
        assert ctx["skill_name"] == "superpowers:brainstorming"

    def test_read_returns_none_when_no_context(self, isolated_telemetry):
        assert telemetry.read_skill_context("s1") is None

    def test_clear_removes_context(self, isolated_telemetry):
        telemetry.write_skill_context("s1", "act-abc", "superpowers:brainstorming")
        telemetry.clear_skill_context("s1")
        assert telemetry.read_skill_context("s1") is None

    def test_clear_is_safe_when_no_context(self, isolated_telemetry):
        telemetry.clear_skill_context("no-such-session")  # must not raise

    def test_contexts_are_session_scoped(self, isolated_telemetry):
        telemetry.write_skill_context("s1", "act-1", "skill-a")
        telemetry.write_skill_context("s2", "act-2", "skill-b")
        assert telemetry.read_skill_context("s1")["activation_id"] == "act-1"
        assert telemetry.read_skill_context("s2")["activation_id"] == "act-2"

    def test_write_overwrites_previous(self, isolated_telemetry):
        telemetry.write_skill_context("s1", "act-1", "skill-a")
        telemetry.write_skill_context("s1", "act-2", "skill-b")
        ctx = telemetry.read_skill_context("s1")
        assert ctx["activation_id"] == "act-2"
        assert ctx["skill_name"] == "skill-b"

    def test_skill_use_passthrough_in_event_type_map(self, isolated_telemetry, with_api_key):
        telemetry.write_event("skill_use", "s1", {"skill_name": "test:skill"})
        queue = isolated_telemetry / ".push_queue.jsonl"
        queued = [json.loads(l) for l in queue.read_text().splitlines() if l.strip()]
        assert queued[0]["event"] == "skill_use"  # must not be remapped
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestSkillContext -v
```

Expected: `AttributeError: module 'telemetry' has no attribute 'write_skill_context'`

- [ ] **Step 3: Implement the helpers in telemetry.py**

After the `_EVENT_TYPE_MAP` block (around line 58), add `"skill_use": "skill_use"` to the map:

```python
_EVENT_TYPE_MAP = {
    "tool_start": "tool_use",
    "tool_end": "tool_result",
    "prompt": "prompt_submit",
    "stop": "assistant_stop",
    "skill_use": "skill_use",
}
```

After the `generate_correlation_id` function (around line 353), add:

```python
# --- Skill activation context ---

def write_skill_context(session_id: str, activation_id: str, skill_name: str) -> None:
    """Write the current skill activation context for a session."""
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)
    ctx_file = TRENCHCOAT_DIR / f".skill_context_{session_id}.json"
    ctx_file.write_text(json.dumps({
        "activation_id": activation_id,
        "skill_name": skill_name,
        "activated_at": _now_iso(),
    }))


def read_skill_context(session_id: str) -> dict | None:
    """Return the active skill context for a session, or None if not set."""
    ctx_file = TRENCHCOAT_DIR / f".skill_context_{session_id}.json"
    if not ctx_file.exists():
        return None
    try:
        return json.loads(ctx_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def clear_skill_context(session_id: str) -> None:
    """Remove the skill activation context for a session."""
    ctx_file = TRENCHCOAT_DIR / f".skill_context_{session_id}.json"
    try:
        ctx_file.unlink(missing_ok=True)
    except OSError:
        pass
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestSkillContext -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Run full test suite to check for regressions**

```bash
cd claude-plugin && python -m pytest tests/ -v
```

Expected: all existing tests still PASS

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): add skill context helpers and skill_use event type mapping"
```

---

## Task 2: Update pre_tool_use.py to emit skill_use events and tag tool calls

**Files:**
- Modify: `claude-plugin/hooks/pre_tool_use.py`
- Modify: `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing integration tests**

Add this class to `claude-plugin/tests/test_telemetry.py` inside `TestHookIntegration`:

```python
    def test_pre_tool_use_skill_tool_emits_skill_use_event(self, tmp_path):
        """Skill tool call → skill_use event written to JSONL."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": "help me plan"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        jsonl_files = list(tc_dir.glob("events-*.jsonl"))
        assert len(jsonl_files) == 1
        events = [json.loads(l) for l in jsonl_files[0].read_text().splitlines() if l.strip()]
        skill_events = [e for e in events if e["event"] == "skill_use"]
        assert len(skill_events) == 1
        assert skill_events[0]["data"]["skill_name"] == "superpowers:brainstorming"
        assert "activation_id" in skill_events[0]["data"]

    def test_pre_tool_use_skill_tool_writes_context_file(self, tmp_path):
        """Skill tool call → context file written at ~/.claude/trenchcoat/.skill_context_{session_id}.json."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": ""},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        ctx_file = tmp_path / ".claude" / "trenchcoat" / ".skill_context_test-s.json"
        assert ctx_file.exists(), "skill context file must be written"
        ctx = json.loads(ctx_file.read_text())
        assert ctx["skill_name"] == "superpowers:brainstorming"
        assert "activation_id" in ctx

    def test_pre_tool_use_non_skill_tool_with_active_context_tagged(self, tmp_path):
        """Non-Skill tool call when context is active → active_skill_id in event data."""
        # First, invoke Skill to write context
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": ""},
        })
        # Then invoke a regular tool
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Read",
            "tool_input": {"file_path": "/tmp/foo.py"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        jsonl_files = list(tc_dir.glob("events-*.jsonl"))
        events = [json.loads(l) for l in jsonl_files[0].read_text().splitlines() if l.strip()]
        tool_start_events = [e for e in events if e["event"] == "tool_start" and e["data"].get("tool_name") == "Read"]
        assert len(tool_start_events) == 1
        assert "active_skill_id" in tool_start_events[0]["data"]

    def test_pre_tool_use_non_skill_without_context_not_tagged(self, tmp_path):
        """Non-Skill tool call with no active context → no active_skill_id in event data."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        jsonl_files = list(tc_dir.glob("events-*.jsonl"))
        events = [json.loads(l) for l in jsonl_files[0].read_text().splitlines() if l.strip()]
        tool_start_events = [e for e in events if e["event"] == "tool_start"]
        assert len(tool_start_events) == 1
        assert "active_skill_id" not in tool_start_events[0]["data"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_skill_tool_emits_skill_use_event tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_skill_tool_writes_context_file tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_non_skill_tool_with_active_context_tagged tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_non_skill_without_context_not_tagged -v
```

Expected: all 4 FAIL

- [ ] **Step 3: Rewrite pre_tool_use.py**

Replace the full content of `claude-plugin/hooks/pre_tool_use.py`:

```python
#!/usr/bin/env python3
"""PreToolUse hook — push to pending stack, log tool_start, detect skill invocations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, load_config, write_event,
    sanitize_tool_input, push_pending, generate_correlation_id,
    write_skill_context, read_skill_context,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name = hook_input.get("tool_name", "unknown")
    tool_input = hook_input.get("tool_input") or {}

    config = load_config()
    correlation_id = generate_correlation_id()

    # Read context BEFORE updating it — so the Skill tool's own tool_start
    # gets tagged with the parent skill (if nested), not itself.
    ctx = read_skill_context(session_id)
    active_skill_id = ctx["activation_id"] if ctx else None

    # Push to pending stack for PostToolUse correlation
    push_pending(session_id, tool_name, correlation_id)

    # Build base tool_start data
    tool_data: dict = {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "input_preview": sanitize_tool_input(tool_input, config),
    }
    if active_skill_id:
        tool_data["active_skill_id"] = active_skill_id

    write_event("tool_start", session_id, tool_data)

    # Detect Skill invocations — emit skill_use and update context
    if tool_name == "Skill":
        skill_name = tool_input.get("skill", "unknown")
        args = tool_input.get("args", "")
        activation_id = generate_correlation_id()

        write_event("skill_use", session_id, {
            "skill_name": skill_name,
            "args_preview": str(args)[:100] if args else None,
            "activation_id": activation_id,
        })

        write_skill_context(session_id, activation_id, skill_name)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_skill_tool_emits_skill_use_event tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_skill_tool_writes_context_file tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_non_skill_tool_with_active_context_tagged tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_non_skill_without_context_not_tagged -v
```

Expected: all 4 PASS

- [ ] **Step 5: Run full test suite**

```bash
cd claude-plugin && python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/hooks/pre_tool_use.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): emit skill_use events and tag tool_start with active_skill_id"
```

---

## Task 3: Update post_tool_use.py to tag tool_end events

**Files:**
- Modify: `claude-plugin/hooks/post_tool_use.py`
- Modify: `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing integration test**

Add inside `TestHookIntegration` in `claude-plugin/tests/test_telemetry.py`:

```python
    def test_post_tool_use_tags_active_skill_id_when_context_set(self, tmp_path):
        """PostToolUse with active skill context → active_skill_id in tool_end event."""
        # Write a context file directly to simulate an active skill
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        tc_dir.mkdir(parents=True, exist_ok=True)
        (tc_dir / ".skill_context_test-s.json").write_text(
            '{"activation_id": "act-xyz", "skill_name": "test:skill", "activated_at": "2026-05-20T00:00:00.000+00:00"}'
        )
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
            "tool_response": "hi",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        jsonl_files = list(tc_dir.glob("events-*.jsonl"))
        assert len(jsonl_files) == 1
        events = [json.loads(l) for l in jsonl_files[0].read_text().splitlines() if l.strip()]
        tool_end_events = [e for e in events if e["event"] == "tool_end"]
        assert len(tool_end_events) == 1
        assert tool_end_events[0]["data"].get("active_skill_id") == "act-xyz"

    def test_post_tool_use_no_tag_without_context(self, tmp_path):
        """PostToolUse with no active context → no active_skill_id in tool_end event."""
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
            "tool_response": "hi",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        jsonl_files = list(tc_dir.glob("events-*.jsonl"))
        events = [json.loads(l) for l in jsonl_files[0].read_text().splitlines() if l.strip()]
        tool_end_events = [e for e in events if e["event"] == "tool_end"]
        assert len(tool_end_events) == 1
        assert "active_skill_id" not in tool_end_events[0]["data"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestHookIntegration::test_post_tool_use_tags_active_skill_id_when_context_set tests/test_telemetry.py::TestHookIntegration::test_post_tool_use_no_tag_without_context -v
```

Expected: both FAIL

- [ ] **Step 3: Rewrite post_tool_use.py**

Replace the full content of `claude-plugin/hooks/post_tool_use.py`:

```python
#!/usr/bin/env python3
"""PostToolUse hook — pop pending, compute duration, log tool_end."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event,
    sanitize_tool_result, pop_pending, read_skill_context,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name = hook_input.get("tool_name", "unknown")
    tool_result = hook_input.get("tool_result")

    # Pop matching pending entry
    pending = pop_pending(session_id, tool_name)

    correlation_id = None
    duration_ms = None
    if pending:
        correlation_id = pending.get("correlation_id")
        started_ns = pending.get("started_at")
        if started_ns:
            duration_ms = (time.monotonic_ns() - started_ns) / 1_000_000

    result_info = sanitize_tool_result(tool_result)

    event_data: dict = {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "duration_ms": round(duration_ms, 1) if duration_ms is not None else None,
        "result_size": result_info.get("size"),
    }

    ctx = read_skill_context(session_id)
    if ctx:
        event_data["active_skill_id"] = ctx["activation_id"]

    write_event("tool_end", session_id, event_data)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestHookIntegration::test_post_tool_use_tags_active_skill_id_when_context_set tests/test_telemetry.py::TestHookIntegration::test_post_tool_use_no_tag_without_context -v
```

Expected: both PASS

- [ ] **Step 5: Run full test suite**

```bash
cd claude-plugin && python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/hooks/post_tool_use.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): tag tool_end events with active_skill_id"
```

---

## Task 4: Update user_prompt_submit.py to clear skill context

**Files:**
- Modify: `claude-plugin/hooks/user_prompt_submit.py`
- Modify: `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing integration test**

Add inside `TestHookIntegration` in `claude-plugin/tests/test_telemetry.py`:

```python
    def test_user_prompt_submit_clears_skill_context(self, tmp_path):
        """UserPromptSubmit → skill context file removed."""
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        tc_dir.mkdir(parents=True, exist_ok=True)
        ctx_file = tc_dir / ".skill_context_test-s.json"
        ctx_file.write_text('{"activation_id": "act-abc", "skill_name": "test:skill", "activated_at": "2026-05-20T00:00:00.000+00:00"}')
        assert ctx_file.exists()

        r = self._run_hook(tmp_path, "user_prompt_submit.py", {
            "session_id": "test-s",
            "prompt": "do something",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        assert not ctx_file.exists(), "skill context must be cleared on new user prompt"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestHookIntegration::test_user_prompt_submit_clears_skill_context -v
```

Expected: FAIL (context file still exists)

- [ ] **Step 3: Update user_prompt_submit.py**

Replace the full content of `claude-plugin/hooks/user_prompt_submit.py`:

```python
#!/usr/bin/env python3
"""UserPromptSubmit hook — log prompt metadata, clear skill activation context."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import read_hook_input, is_enabled, load_config, write_event, clear_skill_context


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    prompt = hook_input.get("prompt", "")

    # New user turn — close any open skill activation window
    clear_skill_context(session_id)

    config = load_config()
    log_content = config.get("privacy", {}).get("log_prompt_content", False)

    data = {
        "prompt_length": len(prompt),
        "word_count": len(prompt.split()),
    }

    if log_content:
        data["prompt"] = prompt

    write_event("prompt", session_id, data)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestHookIntegration::test_user_prompt_submit_clears_skill_context -v
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
cd claude-plugin && python -m pytest tests/ -v
```

Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/hooks/user_prompt_submit.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): clear skill activation context on UserPromptSubmit"
```

---

## Task 5: Add get_skill_stats database RPC

**Files:**
- Create: `supabase/migrations/017_skill_stats.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/017_skill_stats.sql`:

```sql
-- 017: get_skill_stats RPC
-- Queries skill_use events and correlates them with tool_use events via
-- active_skill_id to produce per-skill invocation counts and tool attribution.

create or replace function public.get_skill_stats(
  p_user_id uuid,
  p_from date,
  p_to date
)
returns json
language plpgsql
security definer
as $$
declare
  result json;
begin
  select coalesce(json_agg(s order by s.invocation_count desc), '[]'::json)
  into result
  from (
    select
      sk.skill_name,
      count(*)                                                    as invocation_count,
      coalesce(sum(sk.tool_calls_triggered), 0)                  as tool_calls_triggered,
      case
        when count(*) > 0
        then round(
          coalesce(sum(sk.tool_calls_triggered), 0)::numeric / count(*),
          1
        )
        else 0
      end                                                         as avg_tools_per_invocation
    from (
      select
        e.data->>'skill_name'   as skill_name,
        e.data->>'activation_id' as activation_id,
        (
          select count(*)
          from public.events te
          where te.user_id     = p_user_id
            and te.event_type  = 'tool_use'
            and te.data->>'active_skill_id' = e.data->>'activation_id'
            and te.timestamp::date between p_from and p_to
        )                       as tool_calls_triggered
      from public.events e
      where e.user_id    = p_user_id
        and e.event_type = 'skill_use'
        and e.timestamp::date between p_from and p_to
    ) sk
    group by sk.skill_name
  ) s;

  return result;
end;
$$;
```

- [ ] **Step 2: Apply the migration to your local Supabase**

```bash
supabase db push
```

Expected: migration applied without errors. If `supabase` CLI is not available, apply via the Supabase dashboard SQL editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/017_skill_stats.sql
git commit -m "feat(db): add get_skill_stats RPC for skill usage analytics"
```

---

## Task 6: Add SkillStat type

**Files:**
- Modify: `apps/app/src/types/analytics.ts`

- [ ] **Step 1: Add SkillStat interface**

Add after the `AgentStat` interface in `apps/app/src/types/analytics.ts`:

```typescript
export interface SkillStat {
  skill_name: string;
  invocation_count: number;
  tool_calls_triggered: number;
  avg_tools_per_invocation: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
bun run --filter @trenchcoat/app build 2>&1 | head -30
```

Expected: no TypeScript errors (build may fail on other things; look only for type errors in `analytics.ts`)

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/types/analytics.ts
git commit -m "feat(types): add SkillStat interface for skill analytics"
```

---

## Task 7: Build the Skills dashboard page

**Files:**
- Create: `apps/app/src/app/(dashboard)/skills/page.tsx`
- Create: `apps/app/src/app/(dashboard)/skills/loading.tsx`

- [ ] **Step 1: Create the loading skeleton**

Create `apps/app/src/app/(dashboard)/skills/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

export default function SkillsLoading() {
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table card */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 border-b pb-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-20 ml-auto" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-28" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b py-3 last:border-0">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-4 w-12 ml-auto" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Create the skills page**

Create `apps/app/src/app/(dashboard)/skills/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseDateRange } from "@/lib/date-range";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { SkillStat } from "@/types/analytics";

export default async function SkillsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { from, to } = await searchParams;
  const { p_from, p_to } = parseDateRange(from, to);

  const { data } = await supabase.rpc("get_skill_stats", {
    p_user_id: user.id,
    p_from,
    p_to,
  });

  const skills: SkillStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    skill_name: row.skill_name as string,
    invocation_count: row.invocation_count as number,
    tool_calls_triggered: row.tool_calls_triggered as number,
    avg_tools_per_invocation: row.avg_tools_per_invocation as number,
  }));

  const totalInvocations = skills.reduce((sum, s) => sum + s.invocation_count, 0);
  const uniqueSkills = skills.length;
  const avgToolsOverall =
    totalInvocations > 0
      ? (
          skills.reduce((sum, s) => sum + s.tool_calls_triggered, 0) /
          totalInvocations
        ).toFixed(1)
      : "0";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Skills</h1>
        <p className="text-sm text-muted-foreground">
          Skill invocation counts and downstream tool attribution.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Invocations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalInvocations.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Unique Skills
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{uniqueSkills}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Tools / Invocation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{avgToolsOverall}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Skill Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead className="text-right">Invocations</TableHead>
                <TableHead className="text-right">Tools Triggered</TableHead>
                <TableHead className="text-right">Avg Tools / Invocation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No skill usage data found for this date range.
                  </TableCell>
                </TableRow>
              ) : (
                skills.map((skill) => (
                  <TableRow key={skill.skill_name}>
                    <TableCell className="font-medium font-mono text-sm">
                      {skill.skill_name}
                    </TableCell>
                    <TableCell className="text-right">{skill.invocation_count}</TableCell>
                    <TableCell className="text-right">{skill.tool_calls_triggered}</TableCell>
                    <TableCell className="text-right">{skill.avg_tools_per_invocation}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles without errors**

```bash
bun run --filter @trenchcoat/app build 2>&1 | head -40
```

Expected: no TypeScript errors in the new files

- [ ] **Step 4: Commit**

```bash
git add apps/app/src/app/\(dashboard\)/skills/
git commit -m "feat(dashboard): add Skills page with invocation counts and tool attribution"
```

---

## Task 8: Add Skills entry to the sidebar

**Files:**
- Modify: `apps/app/src/components/dashboard/sidebar.tsx`

- [ ] **Step 1: Add the Skills nav item**

In `apps/app/src/components/dashboard/sidebar.tsx`, update the import line for lucide icons to include `Sparkles`:

```typescript
import {
  LayoutDashboard,
  Terminal,
  Wrench,
  Bot,
  DollarSign,
  Activity,
  Users,
  Settings,
  Sparkles,
} from "lucide-react";
```

Then update the `navItems` array to add Skills between Tools and Agents:

```typescript
const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/sessions", label: "Sessions", icon: Terminal },
  { href: "/tools", label: "Tools", icon: Wrench },
  { href: "/skills", label: "Skills", icon: Sparkles },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/cost", label: "Cost", icon: DollarSign },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/teams", label: "Teams", icon: Users },
];
```

- [ ] **Step 2: Build to check for TypeScript errors**

```bash
bun run --filter @trenchcoat/app build 2>&1 | head -20
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/components/dashboard/sidebar.tsx
git commit -m "feat(dashboard): add Skills nav entry to sidebar"
```

---

## Self-Review Checklist

- [ ] **spec coverage:** Plugin changes (tasks 1–4) ✓, DB RPC (task 5) ✓, Type (task 6) ✓, Dashboard page (task 7) ✓, Sidebar (task 8) ✓
- [ ] **No placeholders** — all steps include complete code
- [ ] **Type consistency** — `SkillStat` defined in task 6, used identically in task 7; `write_skill_context`/`read_skill_context`/`clear_skill_context` defined in task 1, imported by exact name in tasks 2, 3, 4
- [ ] **RPC column names** — `get_skill_stats` returns `skill_name`, `invocation_count`, `tool_calls_triggered`, `avg_tools_per_invocation` — dashboard maps exact same keys
