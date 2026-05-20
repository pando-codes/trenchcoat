# Universal Spawner Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the narrow `active_skill_id` field with a universal `spawner_id` + `spawner_type` chain that links Tools, Skills, Agent invocations, and Sessions into a traversable parent-child graph.

**Architecture:** The plugin tracks the "active context" (current spawner) per session in a local file; a second file propagates parent context across the subprocess boundary when the `Agent` tool fires. The DB stores parent/spawner columns on the `sessions` table, enabling recursive CTE tree queries. The dashboard gains a parent-session banner, child-session list, and a cross-session tool count on the Skills page.

**Tech Stack:** Python (plugin hooks), pytest, Supabase/Postgres (recursive CTEs), TypeScript/Next.js 16 App Router, shadcn/ui, Bun.

**Spec:** `docs/superpowers/specs/2026-05-20-universal-spawner-chain-design.md`

---

## File Map

| Action | Path |
|---|---|
| Modify | `claude-plugin/lib/telemetry.py` |
| Modify | `claude-plugin/tests/test_telemetry.py` |
| Modify | `claude-plugin/hooks/pre_tool_use.py` |
| Modify | `claude-plugin/hooks/post_tool_use.py` |
| Modify | `claude-plugin/hooks/session_start.py` |
| Modify | `claude-plugin/hooks/subagent_stop.py` |
| Modify | `claude-plugin/hooks/user_prompt_submit.py` |
| Create | `supabase/migrations/019_universal_spawner_chain.sql` |
| Modify | `apps/app/src/lib/services/events.service.ts` |
| Modify | `apps/app/src/types/analytics.ts` |
| Modify | `apps/app/src/app/(dashboard)/sessions/page.tsx` |
| Modify | `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx` |
| Modify | `apps/app/src/app/(dashboard)/skills/page.tsx` |

---

## Task 1: telemetry.py — unified active context + agent spawn context helpers

**Files:**
- Modify: `claude-plugin/lib/telemetry.py`

Replace the three skill context helpers with generalized active context helpers, add three agent spawn context helpers, extend `push_pending` to carry `agent_id`, and add `peek_pending_by_tool`.

- [ ] **Step 1: Replace skill context helpers with active context helpers**

In `telemetry.py`, find the `# --- Skill activation context ---` section (lines 358–387) and replace it entirely:

```python
# --- Active spawner context ---

def write_active_context(session_id: str, spawner_id: str, spawner_type: str, spawner_name: str) -> None:
    """Write the current spawner context for a session."""
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)
    ctx_file = TRENCHCOAT_DIR / f".active_context_{session_id}.json"
    ctx_file.write_text(json.dumps({
        "spawner_id": spawner_id,
        "spawner_type": spawner_type,
        "spawner_name": spawner_name,
        "activated_at": _now_iso(),
    }))


def read_active_context(session_id: str) -> dict | None:
    """Return the active spawner context for a session, or None if not set."""
    ctx_file = TRENCHCOAT_DIR / f".active_context_{session_id}.json"
    if not ctx_file.exists():
        return None
    try:
        return json.loads(ctx_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def clear_active_context(session_id: str) -> None:
    """Remove the active spawner context for a session."""
    ctx_file = TRENCHCOAT_DIR / f".active_context_{session_id}.json"
    try:
        ctx_file.unlink(missing_ok=True)
    except OSError:
        pass


# --- Agent spawn context (cross-process, not session-scoped) ---

def write_agent_spawn_context(
    parent_session_id: str,
    agent_id: str,
    spawner_id: str | None,
    spawner_type: str | None,
) -> None:
    """Write spawn context for the child process to read at session_start.

    Not session-scoped: the child process has a different session_id and reads
    this file by path. Safe because Claude Code spawns one subagent at a time.
    """
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)
    ctx: dict = {
        "parent_session_id": parent_session_id,
        "agent_id": agent_id,
    }
    if spawner_id:
        ctx["spawner_id"] = spawner_id
        ctx["spawner_type"] = spawner_type
    (TRENCHCOAT_DIR / ".agent_spawn_context.json").write_text(json.dumps(ctx))


def read_agent_spawn_context() -> dict | None:
    """Return the agent spawn context, or None if not present."""
    ctx_file = TRENCHCOAT_DIR / ".agent_spawn_context.json"
    if not ctx_file.exists():
        return None
    try:
        return json.loads(ctx_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def clear_agent_spawn_context() -> None:
    """Remove the agent spawn context file."""
    ctx_file = TRENCHCOAT_DIR / ".agent_spawn_context.json"
    try:
        ctx_file.unlink(missing_ok=True)
    except OSError:
        pass
```

- [ ] **Step 2: Extend push_pending to carry agent_id**

Find `push_pending` (around line 309) and add an optional `agent_id` parameter:

```python
def push_pending(session_id: str, tool_name: str, correlation_id: str, agent_id: str | None = None) -> None:
    """Push a tool_start to the pending stack for later correlation."""
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    pending_file = PENDING_DIR / f"{session_id}.json"

    stack = []
    if pending_file.exists():
        try:
            stack = json.loads(pending_file.read_text())
        except (json.JSONDecodeError, OSError):
            stack = []

    entry: dict = {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "started_at": time.monotonic_ns(),
        "started_ts": _now_iso(),
    }
    if agent_id:
        entry["agent_id"] = agent_id

    stack.append(entry)
    pending_file.write_text(json.dumps(stack) + "\n")
```

- [ ] **Step 3: Add peek_pending_by_tool**

Add this function immediately after `pop_pending`:

```python
def peek_pending_by_tool(session_id: str, tool_name: str) -> dict | None:
    """Return the most recent pending entry matching tool_name without popping it."""
    pending_file = PENDING_DIR / f"{session_id}.json"
    if not pending_file.exists():
        return None
    try:
        stack = json.loads(pending_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    for entry in reversed(stack):
        if entry.get("tool_name") == tool_name:
            return entry
    return None
```

- [ ] **Step 4: Verify no references to old names remain**

```bash
grep -n "write_skill_context\|read_skill_context\|clear_skill_context\|active_skill_id\|\.skill_context_" claude-plugin/lib/telemetry.py
```

Expected: no output (zero matches).

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/lib/telemetry.py
git commit -m "refactor(plugin): replace skill context with universal active context + agent spawn helpers"
```

---

## Task 2: test_telemetry.py — update unit and integration tests

**Files:**
- Modify: `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Replace TestSkillContext with TestActiveContext**

Find the `class TestSkillContext` block (around line 712) and replace it entirely:

```python
class TestActiveContext:
    def test_write_then_read_roundtrip(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-abc", "skill", "superpowers:brainstorming")
        ctx = telemetry.read_active_context("s1")
        assert ctx is not None
        assert ctx["spawner_id"] == "act-abc"
        assert ctx["spawner_type"] == "skill"
        assert ctx["spawner_name"] == "superpowers:brainstorming"

    def test_read_returns_none_when_no_context(self, isolated_telemetry):
        assert telemetry.read_active_context("s1") is None

    def test_clear_removes_context(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-abc", "skill", "superpowers:brainstorming")
        telemetry.clear_active_context("s1")
        assert telemetry.read_active_context("s1") is None

    def test_clear_is_safe_when_no_context(self, isolated_telemetry):
        telemetry.clear_active_context("no-such-session")  # must not raise

    def test_contexts_are_session_scoped(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-1", "skill", "skill-a")
        telemetry.write_active_context("s2", "act-2", "agent", "Agent")
        assert telemetry.read_active_context("s1")["spawner_id"] == "act-1"
        assert telemetry.read_active_context("s2")["spawner_id"] == "act-2"

    def test_write_overwrites_previous(self, isolated_telemetry):
        telemetry.write_active_context("s1", "act-1", "skill", "skill-a")
        telemetry.write_active_context("s1", "act-2", "skill", "skill-b")
        ctx = telemetry.read_active_context("s1")
        assert ctx["spawner_id"] == "act-2"
        assert ctx["spawner_name"] == "skill-b"
```

- [ ] **Step 2: Add TestAgentSpawnContext**

Add after `TestActiveContext`:

```python
class TestAgentSpawnContext:
    def test_write_then_read_roundtrip(self, isolated_telemetry):
        telemetry.write_agent_spawn_context("parent-s1", "agt-abc", "act-xyz", "skill")
        ctx = telemetry.read_agent_spawn_context()
        assert ctx is not None
        assert ctx["parent_session_id"] == "parent-s1"
        assert ctx["agent_id"] == "agt-abc"
        assert ctx["spawner_id"] == "act-xyz"
        assert ctx["spawner_type"] == "skill"

    def test_write_without_spawner(self, isolated_telemetry):
        telemetry.write_agent_spawn_context("parent-s1", "agt-abc", None, None)
        ctx = telemetry.read_agent_spawn_context()
        assert ctx["parent_session_id"] == "parent-s1"
        assert "spawner_id" not in ctx

    def test_read_returns_none_when_absent(self, isolated_telemetry):
        assert telemetry.read_agent_spawn_context() is None

    def test_clear_removes_file(self, isolated_telemetry):
        telemetry.write_agent_spawn_context("p", "a", None, None)
        telemetry.clear_agent_spawn_context()
        assert telemetry.read_agent_spawn_context() is None

    def test_clear_safe_when_absent(self, isolated_telemetry):
        telemetry.clear_agent_spawn_context()  # must not raise
```

- [ ] **Step 3: Add agent_id tests to TestPendingStack**

Add these two test methods to `class TestPendingStack`:

```python
    def test_push_with_agent_id_roundtrip(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-xyz", agent_id="agt-001")
        entry = telemetry.pop_pending("s1", "Agent")
        assert entry is not None
        assert entry["agent_id"] == "agt-001"

    def test_push_without_agent_id_has_no_agent_id_key(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-abc")
        entry = telemetry.pop_pending("s1", "Bash")
        assert "agent_id" not in entry
```

- [ ] **Step 4: Add TestPeekPendingByTool**

Add after `TestPendingStack`:

```python
class TestPeekPendingByTool:
    def test_peek_returns_entry_without_removing(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-abc", agent_id="agt-1")
        peeked = telemetry.peek_pending_by_tool("s1", "Agent")
        assert peeked is not None
        assert peeked["agent_id"] == "agt-1"
        # Entry still present after peek
        popped = telemetry.pop_pending("s1", "Agent")
        assert popped is not None

    def test_peek_returns_none_when_no_match(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-xyz")
        assert telemetry.peek_pending_by_tool("s1", "Agent") is None

    def test_peek_returns_none_for_missing_session(self, isolated_telemetry):
        assert telemetry.peek_pending_by_tool("no-session", "Agent") is None

    def test_peek_returns_most_recent_match(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-1", agent_id="agt-old")
        telemetry.push_pending("s1", "Agent", "corr-2", agent_id="agt-new")
        peeked = telemetry.peek_pending_by_tool("s1", "Agent")
        assert peeked["agent_id"] == "agt-new"
```

- [ ] **Step 5: Update integration tests that reference old field names**

Find and replace the four integration test methods that use old names. Replace them with:

```python
    def test_user_prompt_submit_clears_active_context(self, tmp_path):
        """UserPromptSubmit → active context file removed."""
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        tc_dir.mkdir(parents=True, exist_ok=True)
        ctx_file = tc_dir / ".active_context_test-s.json"
        ctx_file.write_text('{"spawner_id": "act-abc", "spawner_type": "skill", "spawner_name": "test:skill", "activated_at": "2026-05-20T00:00:00.000+00:00"}')
        assert ctx_file.exists()

        r = self._run_hook(tmp_path, "user_prompt_submit.py", {
            "session_id": "test-s",
            "prompt": "do something",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        assert not ctx_file.exists(), "active context must be cleared on new user prompt"

    def test_pre_tool_use_skill_tool_writes_active_context_file(self, tmp_path):
        """Skill tool call → .active_context_{session_id}.json written."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": ""},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        ctx_file = tmp_path / ".claude" / "trenchcoat" / ".active_context_test-s.json"
        assert ctx_file.exists(), "active context file must be written"
        ctx = json.loads(ctx_file.read_text())
        assert ctx["spawner_name"] == "superpowers:brainstorming"
        assert ctx["spawner_type"] == "skill"
        assert "spawner_id" in ctx

    def test_pre_tool_use_non_skill_tool_with_active_context_tagged(self, tmp_path):
        """Non-Skill tool call when context is active → spawner_id in event data."""
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Skill",
            "tool_input": {"skill": "superpowers:brainstorming", "args": ""},
        })
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Read",
            "tool_input": {"file_path": "/tmp/foo.py"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        read_starts = [e for e in events if e["event"] == "tool_start" and e["data"].get("tool_name") == "Read"]
        assert len(read_starts) == 1
        assert "spawner_id" in read_starts[0]["data"]
        assert read_starts[0]["data"]["spawner_type"] == "skill"

    def test_pre_tool_use_non_skill_without_context_not_tagged(self, tmp_path):
        """Non-Skill tool call with no active context → no spawner_id in event data."""
        r = self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        tool_starts = [e for e in events if e["event"] == "tool_start"]
        assert len(tool_starts) == 1
        assert "spawner_id" not in tool_starts[0]["data"]

    def test_post_tool_use_tags_spawner_when_context_set(self, tmp_path):
        """PostToolUse with active context → spawner_id + spawner_type in tool_end event."""
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        tc_dir.mkdir(parents=True, exist_ok=True)
        (tc_dir / ".active_context_test-s.json").write_text(
            '{"spawner_id": "act-xyz", "spawner_type": "skill", "spawner_name": "test:skill", "activated_at": "2026-05-20T00:00:00.000+00:00"}'
        )
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
            "tool_response": "hi",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        tool_ends = [e for e in events if e["event"] == "tool_end"]
        assert len(tool_ends) == 1
        assert tool_ends[0]["data"].get("spawner_id") == "act-xyz"
        assert tool_ends[0]["data"].get("spawner_type") == "skill"

    def test_post_tool_use_no_tag_without_context(self, tmp_path):
        """PostToolUse with no active context → no spawner_id in tool_end event."""
        r = self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "test-s",
            "tool_name": "Bash",
            "tool_input": {"command": "echo hi"},
            "tool_response": "hi",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        tc_dir = tmp_path / ".claude" / "trenchcoat"
        events = [json.loads(l) for l in list(tc_dir.glob("events-*.jsonl"))[0].read_text().splitlines() if l.strip()]
        tool_ends = [e for e in events if e["event"] == "tool_end"]
        assert len(tool_ends) == 1
        assert "spawner_id" not in tool_ends[0]["data"]
```

Also delete the old test methods with these names (they are being replaced):
- `test_user_prompt_submit_clears_skill_context`
- `test_pre_tool_use_skill_tool_writes_context_file`
- `test_pre_tool_use_non_skill_tool_with_active_context_tagged`
- `test_pre_tool_use_non_skill_without_context_not_tagged`
- `test_post_tool_use_tags_active_skill_id_when_context_set`
- `test_post_tool_use_no_tag_without_context`

- [ ] **Step 6: Run all plugin tests to verify they fail on missing implementations**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py -v 2>&1 | tail -30
```

Expected: tests in `TestActiveContext`, `TestAgentSpawnContext`, `TestPeekPendingByTool`, and `TestPendingStack` (new methods) **pass** (since Task 1 already implemented them). The updated hook integration tests will **fail** because the hooks still use old names.

- [ ] **Step 7: Commit**

```bash
git add claude-plugin/tests/test_telemetry.py
git commit -m "test(plugin): update tests for universal spawner chain — active context + agent spawn"
```

---

## Task 3: pre_tool_use.py — full spawner chain logic

**Files:**
- Modify: `claude-plugin/hooks/pre_tool_use.py`

- [ ] **Step 1: Replace the file entirely**

```python
#!/usr/bin/env python3
"""PreToolUse hook — push to pending stack, log tool_start, detect skill/agent invocations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, load_config, write_event,
    sanitize_tool_input, push_pending, generate_correlation_id,
    write_active_context, read_active_context,
    write_agent_spawn_context,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name  = hook_input.get("tool_name", "unknown")
    tool_input = hook_input.get("tool_input") or {}

    config         = load_config()
    correlation_id = generate_correlation_id()

    # Read context BEFORE updating it — Skill/Agent tool_start is tagged with
    # the parent spawner (not itself), matching behavior of nested invocations.
    ctx          = read_active_context(session_id)
    spawner_id   = ctx["spawner_id"]   if ctx else None
    spawner_type = ctx["spawner_type"] if ctx else None

    tool_data: dict = {
        "tool_name":     tool_name,
        "correlation_id": correlation_id,
        "input_preview": sanitize_tool_input(tool_input, config),
    }
    if spawner_id:
        tool_data["spawner_id"]   = spawner_id
        tool_data["spawner_type"] = spawner_type

    if tool_name == "Agent":
        agent_id = generate_correlation_id()
        tool_data["agent_id"] = agent_id
        push_pending(session_id, tool_name, correlation_id, agent_id=agent_id)
        write_event("tool_start", session_id, tool_data)
        write_agent_spawn_context(
            parent_session_id=session_id,
            agent_id=agent_id,
            spawner_id=spawner_id,
            spawner_type=spawner_type,
        )

    elif tool_name == "Skill":
        activation_id = generate_correlation_id()
        skill_name    = tool_input.get("skill", "unknown")
        args          = tool_input.get("args", "")
        push_pending(session_id, tool_name, correlation_id)
        write_event("tool_start", session_id, tool_data)
        skill_data: dict = {
            "skill_name":   skill_name,
            "args_preview": str(args)[:100] if args else None,
            "activation_id": activation_id,
        }
        if spawner_id:
            skill_data["spawner_id"]   = spawner_id
            skill_data["spawner_type"] = spawner_type
        write_event("skill_use", session_id, skill_data)
        write_active_context(session_id, activation_id, "skill", skill_name)

    else:
        push_pending(session_id, tool_name, correlation_id)
        write_event("tool_start", session_id, tool_data)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run affected integration tests**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_exits_zero tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_skill_tool_emits_skill_use_event tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_skill_tool_writes_active_context_file tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_non_skill_tool_with_active_context_tagged tests/test_telemetry.py::TestHookIntegration::test_pre_tool_use_non_skill_without_context_not_tagged -v
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add claude-plugin/hooks/pre_tool_use.py
git commit -m "feat(plugin): rewrite pre_tool_use for universal spawner chain — Skill + Agent handling"
```

---

## Task 4: Four small hook files

**Files:**
- Modify: `claude-plugin/hooks/post_tool_use.py`
- Modify: `claude-plugin/hooks/session_start.py`
- Modify: `claude-plugin/hooks/subagent_stop.py`
- Modify: `claude-plugin/hooks/user_prompt_submit.py`

- [ ] **Step 1: Replace post_tool_use.py**

```python
#!/usr/bin/env python3
"""PostToolUse hook — pop pending, compute duration, log tool_end."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event,
    sanitize_tool_result, pop_pending, read_active_context,
    clear_agent_spawn_context,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name  = hook_input.get("tool_name", "unknown")
    tool_result = hook_input.get("tool_result")

    pending = pop_pending(session_id, tool_name)

    correlation_id = None
    duration_ms    = None
    if pending:
        correlation_id = pending.get("correlation_id")
        started_ns     = pending.get("started_at")
        if started_ns:
            duration_ms = (time.monotonic_ns() - started_ns) / 1_000_000

    result_info = sanitize_tool_result(tool_result)

    event_data: dict = {
        "tool_name":     tool_name,
        "correlation_id": correlation_id,
        "duration_ms":   round(duration_ms, 1) if duration_ms is not None else None,
        "result_size":   result_info.get("size"),
    }

    ctx = read_active_context(session_id)
    if ctx:
        event_data["spawner_id"]   = ctx["spawner_id"]
        event_data["spawner_type"] = ctx["spawner_type"]

    write_event("tool_end", session_id, event_data)

    if tool_name == "Agent":
        # Guard: clear spawn context in case the child process crashed before reading it.
        clear_agent_spawn_context()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Replace session_start.py**

```python
#!/usr/bin/env python3
"""SessionStart hook — record session begin, read agent spawn context if present."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event, update_session_index,
    read_agent_spawn_context, clear_agent_spawn_context,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    cwd        = hook_input.get("cwd", "")

    spawn_ctx = read_agent_spawn_context()
    clear_agent_spawn_context()

    event_data: dict = {"cwd": cwd}
    if spawn_ctx:
        event_data["parent_session_id"] = spawn_ctx["parent_session_id"]
        if spawn_ctx.get("spawner_id"):
            event_data["spawner_id"]   = spawn_ctx["spawner_id"]
            event_data["spawner_type"] = spawn_ctx["spawner_type"]

    write_event("session_start", session_id, event_data)

    update_session_index(session_id, {
        "started_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(timespec="milliseconds"),
        "cwd": cwd,
        "status": "active",
    })


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Replace subagent_stop.py**

```python
#!/usr/bin/env python3
"""SubagentStop hook — log agent completion with tool attribution from transcript."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event, parse_agent_transcript,
    peek_pending_by_tool,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id      = hook_input.get("session_id", "unknown")
    agent_type      = hook_input.get("agent_type", "unknown")
    stop_reason     = hook_input.get("stop_hook_reason", "unknown")
    transcript_path = hook_input.get("agent_transcript_path")

    tool_summary = {}
    if transcript_path:
        tool_summary = parse_agent_transcript(transcript_path)

    pending  = peek_pending_by_tool(session_id, "Agent")
    agent_id = pending.get("agent_id") if pending else None

    event_data: dict = {
        "agent_type":       agent_type,
        "reason":           stop_reason,
        "tool_counts":      tool_summary.get("tool_counts", {}),
        "tool_count_total": tool_summary.get("total_tools", 0),
        "turns":            tool_summary.get("turns", 0),
        "input_tokens":     tool_summary.get("input_tokens", 0),
        "output_tokens":    tool_summary.get("output_tokens", 0),
        "model":            tool_summary.get("model"),
    }
    if agent_id:
        event_data["agent_id"] = agent_id

    write_event("subagent_stop", session_id, event_data)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Replace user_prompt_submit.py**

```python
#!/usr/bin/env python3
"""UserPromptSubmit hook — log prompt metadata, clear active spawner context."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import read_hook_input, is_enabled, load_config, write_event, clear_active_context


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    prompt     = hook_input.get("prompt", "")

    clear_active_context(session_id)

    config      = load_config()
    log_content = config.get("privacy", {}).get("log_prompt_content", False)

    data = {
        "prompt_length": len(prompt),
        "word_count":    len(prompt.split()),
    }

    if log_content:
        data["prompt"] = prompt

    write_event("prompt", session_id, data)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run all plugin tests**

```bash
cd claude-plugin && python -m pytest tests/test_telemetry.py -v 2>&1 | tail -20
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/hooks/post_tool_use.py claude-plugin/hooks/session_start.py \
        claude-plugin/hooks/subagent_stop.py claude-plugin/hooks/user_prompt_submit.py
git commit -m "feat(plugin): update hook files for universal spawner chain"
```

---

## Task 5: Database migration 019

**Files:**
- Create: `supabase/migrations/019_universal_spawner_chain.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- 019: Universal spawner chain
-- Adds parent session linkage columns to sessions and replaces
-- active_skill_id with spawner_id/spawner_type in RPC queries.

-- -----------------------------------------------------------------------
-- Sessions table: parent linkage columns
-- -----------------------------------------------------------------------
alter table public.sessions
  add column if not exists parent_session_id text,
  add column if not exists spawner_id        text,
  add column if not exists spawner_type      text
    check (spawner_type in ('skill', 'agent'));

create index if not exists idx_sessions_parent_session_id
  on public.sessions(parent_session_id)
  where parent_session_id is not null;

-- -----------------------------------------------------------------------
-- Drop old active_skill_id index (replaced by spawner_id below)
-- -----------------------------------------------------------------------
drop index if exists public.idx_events_active_skill_id;

create index if not exists idx_events_spawner_id
  on public.events (user_id, event_type, (data->>'spawner_id'))
  where event_type = 'tool_use';

-- -----------------------------------------------------------------------
-- Update get_skill_stats: active_skill_id → spawner_id + spawner_type,
-- add cross_session_tool_calls field.
-- -----------------------------------------------------------------------
create or replace function public.get_skill_stats(
  p_user_id uuid,
  p_from    date,
  p_to      date
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
      coalesce(sum(sk.cross_session_tool_calls), 0)              as cross_session_tool_calls,
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
        e.data->>'skill_name'    as skill_name,
        e.data->>'activation_id' as activation_id,
        -- Same-session tool calls attributed to this skill invocation
        (
          select count(*)
          from public.events te
          where te.user_id              = p_user_id
            and te.event_type           = 'tool_use'
            and te.data->>'spawner_id'  = e.data->>'activation_id'
            and te.data->>'spawner_type' = 'skill'
            and te.timestamp::date between p_from and p_to
        ) as tool_calls_triggered,
        -- Tool calls in subagent sessions spawned by this skill invocation
        (
          select count(*)
          from public.sessions s
          join public.events te2
            on te2.session_id = s.session_id
           and te2.user_id    = p_user_id
           and te2.event_type = 'tool_use'
          where s.user_id      = p_user_id
            and s.spawner_id   = e.data->>'activation_id'
            and s.spawner_type = 'skill'
        ) as cross_session_tool_calls
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

-- -----------------------------------------------------------------------
-- get_session_tree: recursive subtree rooted at a given session
-- -----------------------------------------------------------------------
create or replace function public.get_session_tree(
  p_user_id    uuid,
  p_session_id text
)
returns table (
  session_id        text,
  parent_session_id text,
  spawner_id        text,
  spawner_type      text,
  depth             int,
  started_at        timestamptz,
  ended_at          timestamptz,
  tool_count        bigint,
  skill_count       bigint,
  subagent_count    bigint,
  input_tokens      bigint,
  output_tokens     bigint
)
language sql stable
as $$
  with recursive tree as (
    select
      s.session_id,
      s.parent_session_id,
      s.spawner_id,
      s.spawner_type,
      0 as depth,
      s.started_at,
      s.ended_at
    from public.sessions s
    where s.session_id = p_session_id
      and s.user_id    = p_user_id

    union all

    select
      s.session_id,
      s.parent_session_id,
      s.spawner_id,
      s.spawner_type,
      t.depth + 1,
      s.started_at,
      s.ended_at
    from public.sessions s
    join tree t on s.parent_session_id = t.session_id
    where s.user_id = p_user_id
  )
  select
    t.session_id,
    t.parent_session_id,
    t.spawner_id,
    t.spawner_type,
    t.depth,
    t.started_at,
    t.ended_at,
    count(e.id) filter (where e.event_type = 'tool_use')      as tool_count,
    count(e.id) filter (where e.event_type = 'skill_use')     as skill_count,
    count(e.id) filter (where e.event_type = 'subagent_stop') as subagent_count,
    coalesce(max(s2.input_tokens),  0)                        as input_tokens,
    coalesce(max(s2.output_tokens), 0)                        as output_tokens
  from tree t
  left join public.events e
    on e.session_id = t.session_id
   and e.user_id    = p_user_id
  left join public.sessions s2
    on s2.session_id = t.session_id
   and s2.user_id    = p_user_id
  group by
    t.session_id, t.parent_session_id, t.spawner_id,
    t.spawner_type, t.depth, t.started_at, t.ended_at
  order by t.depth, t.started_at;
$$;

-- -----------------------------------------------------------------------
-- get_entity_rollup: aggregate stats for a spawner across all descendants
-- -----------------------------------------------------------------------
create or replace function public.get_entity_rollup(
  p_user_id      uuid,
  p_spawner_id   text,
  p_spawner_type text,
  p_date_from    date,
  p_date_to      date
)
returns table (
  total_tools     bigint,
  total_skills    bigint,
  total_subagents bigint,
  input_tokens    bigint,
  output_tokens   bigint
)
language sql stable
as $$
  with recursive descendant_sessions as (
    select session_id, input_tokens, output_tokens
    from public.sessions
    where spawner_id   = p_spawner_id
      and spawner_type = p_spawner_type
      and user_id      = p_user_id
      and started_at::date between p_date_from and p_date_to

    union all

    select s.session_id, s.input_tokens, s.output_tokens
    from public.sessions s
    join descendant_sessions ds on s.parent_session_id = ds.session_id
    where s.user_id = p_user_id
  )
  select
    -- Direct tool calls with matching spawner_id
    coalesce((
      select count(*) from public.events
      where user_id              = p_user_id
        and event_type           = 'tool_use'
        and data->>'spawner_id'  = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to
    ), 0)
    +
    -- Tool calls in all descendant sessions
    coalesce((
      select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'tool_use'
    ), 0) as total_tools,

    coalesce((
      select count(*) from public.events
      where user_id              = p_user_id
        and event_type           = 'skill_use'
        and data->>'spawner_id'  = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to
    ), 0)
    +
    coalesce((
      select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'skill_use'
    ), 0) as total_skills,

    coalesce((
      select count(*) from public.events
      where user_id              = p_user_id
        and event_type           = 'subagent_stop'
        and data->>'spawner_id'  = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to
    ), 0)
    +
    coalesce((
      select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'subagent_stop'
    ), 0) as total_subagents,

    coalesce((select sum(input_tokens)  from descendant_sessions), 0) as input_tokens,
    coalesce((select sum(output_tokens) from descendant_sessions), 0) as output_tokens;
$$;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Verify the new columns exist**

```bash
npx supabase db diff --schema public 2>/dev/null | grep -A5 "parent_session_id"
```

Expected: shows `parent_session_id`, `spawner_id`, `spawner_type` on the sessions table.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/019_universal_spawner_chain.sql
git commit -m "feat(db): add universal spawner chain — sessions columns + tree/rollup RPCs"
```

---

## Task 6: events.service.ts — extract spawner fields from session_start

**Files:**
- Modify: `apps/app/src/lib/services/events.service.ts`

- [ ] **Step 1: Add the session_start extraction block**

After the existing `// Write token data and model from stop events...` block (around line 147), add a new block:

```typescript
  // -----------------------------------------------------------------------
  // Write parent session linkage from session_start events
  // -----------------------------------------------------------------------
  for (const e of events) {
    if (e.event === "session_start") {
      const parentSessionId = (e.data?.parent_session_id as string) ?? null;
      const spawnerId       = (e.data?.spawner_id        as string) ?? null;
      const spawnerType     = (e.data?.spawner_type      as string) ?? null;

      if (parentSessionId || spawnerId) {
        const update: Record<string, unknown> = {};
        if (parentSessionId) update.parent_session_id = parentSessionId;
        if (spawnerId)       update.spawner_id        = spawnerId;
        if (spawnerType)     update.spawner_type      = spawnerType;

        await adminClient
          .from("sessions")
          .update(update)
          .eq("session_id", e.session_id)
          .eq("user_id", userId);
      }
    }
  }
```

- [ ] **Step 2: Lint**

```bash
bun run --filter @trenchcoat/app lint
```

Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/app/src/lib/services/events.service.ts
git commit -m "feat(api): extract parent_session_id and spawner fields from session_start events"
```

---

## Task 7: TypeScript types + SkillStat cross_session_tool_calls

**Files:**
- Modify: `apps/app/src/types/analytics.ts`

- [ ] **Step 1: Extend SessionSummary with spawner fields**

Find `export interface SessionSummary` and add three fields at the end:

```typescript
export interface SessionSummary {
  id: string;
  session_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  event_count: number;
  tool_count: number;
  stop_reason: string | null;
  git_branch: string | null;
  working_directory: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  parent_session_id: string | null;
  spawner_id: string | null;
  spawner_type: "skill" | "agent" | null;
}
```

- [ ] **Step 2: Extend SkillStat with cross_session_tool_calls**

Find `export interface SkillStat` and add the new field:

```typescript
export interface SkillStat {
  skill_name: string;
  invocation_count: number;
  tool_calls_triggered: number;
  cross_session_tool_calls: number;
  avg_tools_per_invocation: number;
}
```

- [ ] **Step 3: Add SessionTreeNode and EntityRollup types**

Add at the end of the file:

```typescript
export interface SessionTreeNode {
  session_id: string;
  parent_session_id: string | null;
  spawner_id: string | null;
  spawner_type: "skill" | "agent" | null;
  depth: number;
  started_at: string;
  ended_at: string | null;
  tool_count: number;
  skill_count: number;
  subagent_count: number;
  input_tokens: number;
  output_tokens: number;
}

export interface EntityRollup {
  total_tools: number;
  total_skills: number;
  total_subagents: number;
  input_tokens: number;
  output_tokens: number;
}
```

- [ ] **Step 4: Lint**

```bash
bun run --filter @trenchcoat/app lint
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/types/analytics.ts
git commit -m "feat(types): add spawner chain fields to SessionSummary + SkillStat; add SessionTreeNode + EntityRollup"
```

---

## Task 8: Sessions list page — Type badge + Subagents column

**Files:**
- Modify: `apps/app/src/app/(dashboard)/sessions/page.tsx`

- [ ] **Step 1: Add a child-session count query**

The existing `Promise.all` has three entries. Add a fourth by changing the destructure and appending to the array. Find:

```typescript
  const [branchesResult, sessionsResult, pricingResult] = await Promise.all([
```

Replace with:

```typescript
  const [branchesResult, sessionsResult, pricingResult, childCountsResult] = await Promise.all([
```

Then find the closing `]);` of the `Promise.all` and add the fourth query before it:

```typescript
    supabase
      .from("sessions")
      .select("parent_session_id")
      .eq("user_id", viewUserId)
      .not("parent_session_id", "is", null)
      .gte("started_at", p_from)
      .lte("started_at", p_to + "T23:59:59.999Z"),
```

After the `Promise.all`, add:

```typescript
  // Map: plugin session_id → DB UUID id (for building parent links)
  const sessionIdToDbId = new Map<string, string>();
  for (const s of sessions) {
    sessionIdToDbId.set(s.session_id, s.id);
  }

  // Map: plugin session_id → child count
  const childCountMap = new Map<string, number>();
  for (const row of (childCountsResult.data ?? [])) {
    const pid = row.parent_session_id as string;
    childCountMap.set(pid, (childCountMap.get(pid) ?? 0) + 1);
  }
```

- [ ] **Step 2: Add Type and Subagents columns to the table header**

Find the `<TableHeader>` block and add two columns after "Started":

```tsx
<TableHeader>
  <TableRow>
    <TableHead>Started</TableHead>
    <TableHead>Type</TableHead>
    <TableHead className="text-right">Subagents</TableHead>
    <TableHead>Duration</TableHead>
    <TableHead className="text-right">Events</TableHead>
    <TableHead className="text-right">Tools</TableHead>
    <TableHead>Branch</TableHead>
    <TableHead className="text-right">Cost</TableHead>
  </TableRow>
</TableHeader>
```

- [ ] **Step 3: Add the two cells to each data row**

Inside `sessions.map((session) => (...))`, after the "Started" `<TableCell>`, add:

```tsx
<TableCell>
  {session.parent_session_id ? (() => {
    const parentDbId = sessionIdToDbId.get(session.parent_session_id as string);
    return (
      <Link
        href={parentDbId ? `/sessions/${parentDbId}` : "#"}
        className="text-xs text-muted-foreground underline-offset-4 hover:underline"
      >
        <Badge variant="outline">Subagent</Badge>
      </Link>
    );
  })() : null}
</TableCell>
<TableCell className="text-right text-muted-foreground">
  {childCountMap.get(session.session_id) ?? "--"}
</TableCell>
```

Note: `parent_session_id` stores the plugin's text `session_id`, not the DB UUID. `sessionIdToDbId` maps text session_id → DB UUID for sessions already on this page. If the parent is on a different page the badge still renders but links to `#`; this is acceptable for a first implementation.

- [ ] **Step 4: Update the empty-state colspan**

The empty-state `<TableCell colSpan={6}` should now be `colSpan={8}` (two new columns added):

```tsx
<TableCell colSpan={8} className="text-center text-muted-foreground">
  No sessions found.
</TableCell>
```

- [ ] **Step 5: Lint**

```bash
bun run --filter @trenchcoat/app lint
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/app/src/app/\(dashboard\)/sessions/page.tsx
git commit -m "feat(dashboard): add Type and Subagents columns to sessions list"
```

---

## Task 9: Session detail page — parent banner + child sessions section

**Files:**
- Modify: `apps/app/src/app/(dashboard)/sessions/[id]/page.tsx`

- [ ] **Step 1: Add parent session query**

After the existing `session` query, add a query for the parent session (if any) and a query for child sessions:

```typescript
  const parentSessionId = (session as SessionSummary & { parent_session_id?: string }).parent_session_id ?? null;

  const [parentResult, childrenResult] = await Promise.all([
    parentSessionId
      ? supabase
          .from("sessions")
          .select("id, session_id, started_at")
          .eq("session_id", parentSessionId)   // parent_session_id stores plugin text session_id
          .eq("user_id", user.id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("sessions")
      .select("id, session_id, started_at, tool_count, input_tokens, output_tokens, model")
      .eq("parent_session_id", (session as SessionSummary).session_id)
      .eq("user_id", user.id)
      .order("started_at", { ascending: true }),
  ]);

  const parentSession = parentResult.data as { id: string; session_id: string; started_at: string } | null;
  const childSessions = (childrenResult.data ?? []) as {
    id: string;
    session_id: string;
    started_at: string;
    tool_count: number;
    input_tokens: number | null;
    output_tokens: number | null;
    model: string | null;
  }[];
```

Add `import type { SessionSummary } from "@/types/analytics";` if not already present (it is).

- [ ] **Step 2: Add parent session banner**

Insert this block immediately after the `<div>` containing the page title (before the summary cards grid):

```tsx
{parentSession && (
  <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-4 py-2 text-sm text-muted-foreground">
    <span>Subagent session — spawned by</span>
    <Link
      href={`/sessions/${parentSession.id}`}
      className="font-mono text-primary underline-offset-4 hover:underline"
    >
      {formatTimestamp(parentSession.started_at)}
    </Link>
  </div>
)}
```

- [ ] **Step 3: Add child sessions section**

Add this block after the existing "Agents" card (the `{(() => { const agentEvents = ... })()}` IIFE) and before the "Event Timeline" card:

```tsx
{childSessions.length > 0 && (
  <Card>
    <CardHeader>
      <CardTitle>Subagent Sessions</CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-2">
        {childSessions.map((child) => {
          const childCost = computeCost(
            child.input_tokens ?? null,
            child.output_tokens ?? null,
            child.model ?? null,
            rates
          );
          return (
            <div key={child.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
              <Link
                href={`/sessions/${child.id}`}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                {formatTimestamp(child.started_at)}
              </Link>
              <div className="flex gap-4 text-sm text-muted-foreground">
                <span>{child.tool_count} tools</span>
                {childCost !== null && (
                  <span className="font-mono">{formatCost(childCost)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </CardContent>
  </Card>
)}
```

- [ ] **Step 4: Lint**

```bash
bun run --filter @trenchcoat/app lint
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(dashboard\)/sessions/\[id\]/page.tsx
git commit -m "feat(dashboard): add parent session banner and child sessions to session detail page"
```

---

## Task 10: Skills page — Cross-session tools column

**Files:**
- Modify: `apps/app/src/app/(dashboard)/skills/page.tsx`

- [ ] **Step 1: Update SkillStat mapping to include cross_session_tool_calls**

Find the `skills` mapping block and add the new field:

```typescript
  const skills: SkillStat[] = ((data as Record<string, unknown>[]) ?? []).map((row) => ({
    skill_name:               row.skill_name               as string,
    invocation_count:         row.invocation_count         as number,
    tool_calls_triggered:     row.tool_calls_triggered     as number,
    cross_session_tool_calls: (row.cross_session_tool_calls as number) ?? 0,
    avg_tools_per_invocation: row.avg_tools_per_invocation as number,
  }));
```

- [ ] **Step 2: Add cross-session total to summary cards**

Add a fourth summary card after "Avg Tools / Invocation":

```tsx
<Card>
  <CardHeader>
    <CardTitle className="text-sm font-medium text-muted-foreground">
      Cross-Session Tools
    </CardTitle>
  </CardHeader>
  <CardContent>
    <p className="text-2xl font-bold">
      {skills.reduce((sum, s) => sum + s.cross_session_tool_calls, 0).toLocaleString()}
    </p>
  </CardContent>
</Card>
```

Update the summary cards grid from `sm:grid-cols-3` to `sm:grid-cols-4`.

- [ ] **Step 3: Add Cross-session Tools column to the table**

In `<TableHeader>`, add a new column after "Avg Tools / Invocation":

```tsx
<TableHead className="text-right">
  Cross-Session Tools
</TableHead>
```

In `skills.map(...)`, add the cell:

```tsx
<TableCell className="text-right">
  {skill.cross_session_tool_calls > 0
    ? skill.cross_session_tool_calls.toLocaleString()
    : <span className="text-muted-foreground">--</span>
  }
</TableCell>
```

Update the empty-state colspan from `colSpan={4}` to `colSpan={5}`.

- [ ] **Step 4: Lint**

```bash
bun run --filter @trenchcoat/app lint
```

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/app/src/app/\(dashboard\)/skills/page.tsx
git commit -m "feat(dashboard): add Cross-Session Tools column to skills page"
```

---

## Final verification

- [ ] **Run all plugin tests**

```bash
cd claude-plugin && python -m pytest tests/ -v
```

Expected: all tests PASS.

- [ ] **Run app lint**

```bash
bun run --filter @trenchcoat/app lint
```

Expected: exit 0.

- [ ] **Start the dev server and manually verify**

```bash
bun run dev:app
```

Open http://localhost:3000 and verify:
1. Sessions list shows "Type" and "Subagents" columns (populated for any sessions with `parent_session_id` set).
2. A session detail page shows "Subagent Sessions" card if child sessions exist.
3. Skills page shows "Cross-Session Tools" column.
4. No console errors.
