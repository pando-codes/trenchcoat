# Agent-Native Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Trenchcoat plugin emit the identifiers Claude Code actually provides — `tool_use_id`, native `duration_ms`, base `agent_id`/`agent_type`, SubagentStop's real `agent_id` — and delete the guesswork it currently substitutes.

**Architecture:** Capture-side only. Every change is additive inside event `data` except the removal of dead code and one renamed field (`reason` → `stop_hook_active`). No read-side, DB, or dashboard change.

**Tech Stack:** Python 3 plugin hooks, pytest (`uv run --with pytest pytest tests/`).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-20-agent-native-capture-design.md`. This plan implements D1 only.
- **Capture-side only.** Do NOT touch `apps/app/`, `supabase/migrations/`, or any RPC. The spawn graph stays empty after this slice — that is D2's job, by design.
- **`tool_use_id` is required on both PreToolUse and PostToolUse** per Claude Code's schema. It is the correlation key.
- **`duration_ms` on PostToolUse is schema-OPTIONAL.** Prefer it; fall back to the existing monotonic computation; always emit `duration_source: "native" | "computed"`. Do not delete the fallback.
- **Base `agent_id`/`agent_type`** come from the shared hook-input base object and are present only when the hook fires *inside* a subagent. Use `agent_id` (not `agent_type`) as the subagent signal — `agent_type` is also set on the main thread of `--agent` sessions.
- **`stop_hook_reason` DOES NOT EXIST.** The real key is `stop_hook_active` (boolean). Drop the `reason` field entirely rather than keep a permanently-wrong value.
- **Agent `tool_response` capture is a strict ALLOWLIST**: `agentId`, `status`, `resolvedModel`, `totalDurationMs`, `totalTokens`, `totalToolUseCount`, `toolStats`, `isAsync`. NEVER `prompt`, `content`, `description`, or `outputFile`. Async results legitimately lack most fields — all optional.
- **All pending-file IO must hold an exclusive `flock`** for the whole read-modify-write, matching `write_event`'s existing pattern.
- Non-Agent tools must be unaffected by every change.
- Plugin version `1.2.0` → `1.3.0` (Task 7).
- **Tests:** `cd claude-plugin && uv run --with pytest pytest tests/ -q` (baseline **117**). Add to the existing `claude-plugin/tests/test_telemetry.py`; reuse `_run_hook`/`_read_events` in `TestHookIntegration` and the `isolated_telemetry` fixture for unit tests.
- **Commit** after each task with the shown message.

---

## File Structure

**Modified**
- `claude-plugin/lib/telemetry.py` — pending re-key + flock; `base_agent_fields()`; `sanitize_agent_result()`; delete spawn-context functions.
- `claude-plugin/hooks/pre_tool_use.py` — `tool_use_id`, base agent fields, drop spawn-context write.
- `claude-plugin/hooks/post_tool_use.py` — `tool_use_id`, native duration, base agent fields, Agent result metrics, drop spawn-context clear.
- `claude-plugin/hooks/subagent_stop.py` — real `agent_id`, `stop_hook_active`.
- `claude-plugin/hooks/session_start.py` — drop spawn-context read.
- `claude-plugin/hooks/hooks.json` — register SubagentStart.
- `claude-plugin/.claude-plugin/plugin.json` — 1.3.0.
- `claude-plugin/tests/test_telemetry.py`

**New**
- `claude-plugin/hooks/subagent_start.py`

---

## Task 1: Re-key the pending map on `tool_use_id`, under `flock`

Fixes both the ordering assumption and the unlocked read-modify-write race.

**Files:** Modify `claude-plugin/lib/telemetry.py`; Test `claude-plugin/tests/test_telemetry.py`

**Interfaces:**
- Produces: `push_pending(session_id, tool_name, correlation_id, tool_use_id=None, agent_id=None, edge_label=None)`; `pop_pending(session_id, tool_name, tool_use_id=None)`; `peek_pending_by_tool` unchanged in signature.

- [ ] **Step 1: Write the failing tests**

Add to `claude-plugin/tests/test_telemetry.py`:

```python
class TestPendingByToolUseId:
    def test_pops_by_tool_use_id_regardless_of_order(self, isolated_telemetry):
        """The case LIFO gets wrong: two Agent calls, first-started finishes first."""
        telemetry.push_pending("s1", "Agent", "corr-a", tool_use_id="toolu_A", agent_id="ag-a")
        telemetry.push_pending("s1", "Agent", "corr-b", tool_use_id="toolu_B", agent_id="ag-b")

        first = telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_A")
        assert first["agent_id"] == "ag-a", "must pop the matching entry, not the LIFO top"

        second = telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_B")
        assert second["agent_id"] == "ag-b"

    def test_falls_back_to_lifo_when_no_tool_use_id(self, isolated_telemetry):
        telemetry.push_pending("s1", "Bash", "corr-1")
        telemetry.push_pending("s1", "Bash", "corr-2")
        assert telemetry.pop_pending("s1", "Bash")["correlation_id"] == "corr-2"

    def test_unknown_tool_use_id_returns_none_without_consuming(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-a", tool_use_id="toolu_A")
        assert telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_ZZZ") is None
        assert telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_A") is not None

    def test_tool_use_id_is_persisted_on_the_entry(self, isolated_telemetry):
        telemetry.push_pending("s1", "Agent", "corr-a", tool_use_id="toolu_A")
        assert telemetry.pop_pending("s1", "Agent", tool_use_id="toolu_A")["tool_use_id"] == "toolu_A"

    def test_concurrent_pushes_lose_no_entries(self, isolated_telemetry):
        """Unlocked read-modify-write loses updates; flock must not."""
        import threading
        def push(i):
            telemetry.push_pending("s1", "Bash", f"corr-{i}", tool_use_id=f"toolu_{i}")
        threads = [threading.Thread(target=push, args=(i,)) for i in range(25)]
        for t in threads: t.start()
        for t in threads: t.join()
        found = sum(1 for i in range(25)
                    if telemetry.pop_pending("s1", "Bash", tool_use_id=f"toolu_{i}") is not None)
        assert found == 25, f"lost {25 - found} entries to a race"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k PendingByToolUseId -q`
Expected: FAIL — `push_pending` takes no `tool_use_id`.

- [ ] **Step 3: Implement**

In `claude-plugin/lib/telemetry.py`, replace the bodies of `push_pending` and `pop_pending` so ALL file IO happens inside one exclusive lock, and add a `tool_use_id` field. Keep the on-disk shape a JSON **list** of entries (backward compatible with in-flight files).

```python
def _mutate_pending(session_id: str, mutate):
    """Read-modify-write the pending file under an exclusive lock.

    mutate(stack) -> (new_stack, result). Matches write_event's flock discipline;
    the previous unlocked read_text/write_text lost updates under concurrency.
    """
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    pending_file = PENDING_DIR / f"{session_id}.json"
    fd = os.open(str(pending_file), os.O_RDWR | os.O_CREAT, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        os.lseek(fd, 0, os.SEEK_SET)
        raw = os.read(fd, 10_000_000).decode() or ""
        try:
            stack = json.loads(raw) if raw.strip() else []
        except json.JSONDecodeError:
            stack = []
        new_stack, result = mutate(stack)
        data = (json.dumps(new_stack) + "\n").encode()
        os.lseek(fd, 0, os.SEEK_SET)
        os.write(fd, data)
        os.ftruncate(fd, len(data))
        return result
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def push_pending(session_id: str, tool_name: str, correlation_id: str,
                 tool_use_id: str | None = None,
                 agent_id: str | None = None,
                 edge_label: str | None = None) -> None:
    """Push a tool_start onto the pending list for later correlation."""
    entry: dict = {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "started_at": time.monotonic_ns(),
        "started_ts": _now_iso(),
    }
    if tool_use_id:
        entry["tool_use_id"] = tool_use_id
    if agent_id:
        entry["agent_id"] = agent_id
    if edge_label:
        entry["edge_label"] = edge_label

    def mutate(stack):
        stack.append(entry)
        return stack, None

    _mutate_pending(session_id, mutate)


def pop_pending(session_id: str, tool_name: str,
                tool_use_id: str | None = None) -> dict | None:
    """Remove and return the pending entry for this call.

    Prefers an exact tool_use_id match (correct under parallelism and nesting);
    falls back to LIFO-by-tool_name only when no tool_use_id is supplied.
    """
    def mutate(stack):
        if tool_use_id:
            for i in range(len(stack) - 1, -1, -1):
                if stack[i].get("tool_use_id") == tool_use_id:
                    return stack[:i] + stack[i + 1:], stack[i]
            return stack, None
        for i in range(len(stack) - 1, -1, -1):
            if stack[i].get("tool_name") == tool_name:
                return stack[:i] + stack[i + 1:], stack[i]
        return stack, None

    return _mutate_pending(session_id, mutate)
```

Ensure `os`, `fcntl`, `json`, `time` are imported at module top (most already are). Leave `peek_pending_by_tool` as-is for now — Task 4 removes its only caller.

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q`
Expected: all pass (was 117, now 122). If any pre-existing pending test fails, the on-disk shape changed — it must stay a JSON list.

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/tests/test_telemetry.py
git commit -m "fix(plugin): key pending correlation on tool_use_id and lock file access"
```

---

## Task 2: Emit `tool_use_id` and prefer native `duration_ms`

**Files:** Modify `claude-plugin/hooks/pre_tool_use.py`, `claude-plugin/hooks/post_tool_use.py`; Test `claude-plugin/tests/test_telemetry.py`

**Interfaces:** Consumes Task 1's `push_pending`/`pop_pending`. Produces `tool_use_id`, `duration_ms`, `duration_source` on tool events.

- [ ] **Step 1: Write the failing tests**

Add to `class TestHookIntegration`:

```python
    def test_tool_use_id_emitted_and_matches_across_pair(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "t-s", "tool_name": "Bash", "tool_use_id": "toolu_X",
            "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "t-s", "tool_name": "Bash", "tool_use_id": "toolu_X",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
            "duration_ms": 42,
        })
        events = self._read_events(tmp_path)
        start = next(e for e in events if e["event"] == "tool_start")
        end = next(e for e in events if e["event"] == "tool_end")
        assert start["data"]["tool_use_id"] == "toolu_X"
        assert end["data"]["tool_use_id"] == "toolu_X"

    def test_prefers_native_duration_ms(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "t-s2", "tool_name": "Bash", "tool_use_id": "toolu_Y",
            "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "t-s2", "tool_name": "Bash", "tool_use_id": "toolu_Y",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
            "duration_ms": 1234,
        })
        end = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_end")
        assert end["data"]["duration_ms"] == 1234
        assert end["data"]["duration_source"] == "native"

    def test_falls_back_to_computed_duration(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "t-s3", "tool_name": "Bash", "tool_use_id": "toolu_Z",
            "tool_input": {"command": "echo hi"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "t-s3", "tool_name": "Bash", "tool_use_id": "toolu_Z",
            "tool_input": {"command": "echo hi"}, "tool_response": "hi",
        })
        end = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_end")
        assert end["data"]["duration_source"] == "computed"
        assert end["data"]["duration_ms"] is not None

    def test_out_of_order_agent_pair_correlates_correctly(self, tmp_path):
        """Two Agent spawns; the FIRST finishes first — LIFO would mispair these."""
        for tid, prompt in (("toolu_A", "first task"), ("toolu_B", "second task")):
            self._run_hook(tmp_path, "pre_tool_use.py", {
                "session_id": "p-s", "tool_name": "Agent", "tool_use_id": tid,
                "tool_input": {"description": "d", "prompt": prompt},
            })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "p-s", "tool_name": "Agent", "tool_use_id": "toolu_A",
            "tool_input": {"description": "d", "prompt": "first task"},
            "tool_response": {"agentId": "ag-first", "status": "completed"},
        })
        events = self._read_events(tmp_path)
        starts = {e["data"]["tool_use_id"]: e for e in events if e["event"] == "tool_start"}
        end = next(e for e in events if e["event"] == "tool_end")
        assert end["data"]["tool_use_id"] == "toolu_A"
        assert end["data"]["correlation_id"] == starts["toolu_A"]["data"]["correlation_id"], \
            "tool_end must carry the correlation_id of ITS OWN tool_start"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k "tool_use_id or duration or out_of_order" -q`
Expected: FAIL.

- [ ] **Step 3: Implement in `pre_tool_use.py`**

Read `tool_use_id` and thread it into both the event and the pending entry:

```python
    tool_use_id = hook_input.get("tool_use_id")
```
(place next to the existing `tool_name`/`tool_input` reads), add to `tool_data`:
```python
    if tool_use_id:
        tool_data["tool_use_id"] = tool_use_id
```
and pass it in ALL THREE `push_pending(...)` call sites (Agent, Skill, else) as `tool_use_id=tool_use_id`.

- [ ] **Step 4: Implement in `post_tool_use.py`**

```python
    tool_use_id = hook_input.get("tool_use_id")
    native_duration = hook_input.get("duration_ms")

    pending = pop_pending(session_id, tool_name, tool_use_id=tool_use_id)
```

then replace the duration block:

```python
    duration_source = None
    if native_duration is not None:
        duration_ms = float(native_duration)
        duration_source = "native"
    elif pending and pending.get("started_at"):
        duration_ms = (time.monotonic_ns() - pending["started_at"]) / 1_000_000
        duration_source = "computed"
```

and add to `event_data`:
```python
        "duration_source": duration_source,
```
plus
```python
    if tool_use_id:
        event_data["tool_use_id"] = tool_use_id
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass.

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/hooks/pre_tool_use.py claude-plugin/hooks/post_tool_use.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): emit tool_use_id and prefer native duration_ms"
```

---

## Task 3: Attribute events to their originating subagent

**Files:** Modify `claude-plugin/lib/telemetry.py`, `claude-plugin/hooks/pre_tool_use.py`, `claude-plugin/hooks/post_tool_use.py`; Test `claude-plugin/tests/test_telemetry.py`

**Interfaces:** Produces `base_agent_fields(hook_input) -> dict` in telemetry; `origin_agent_id`/`origin_agent_type` on tool events.

> Named `origin_*` deliberately: on an Agent `tool_end`, `agent_id` already means "the agent this call SPAWNED". The base field means "the agent this call CAME FROM". Conflating them would be a correctness bug.

- [ ] **Step 1: Write the failing tests**

```python
class TestBaseAgentFields:
    def test_extracts_both_when_present(self):
        got = telemetry.base_agent_fields({"agent_id": "ag-1", "agent_type": "Explore"})
        assert got == {"origin_agent_id": "ag-1", "origin_agent_type": "Explore"}

    def test_empty_when_main_thread(self):
        assert telemetry.base_agent_fields({"session_id": "s"}) == {}

    def test_agent_type_alone_is_not_a_subagent_signal(self):
        """--agent sessions set agent_type on the MAIN thread; agent_id is the real signal."""
        assert telemetry.base_agent_fields({"agent_type": "general-purpose"}) == {}
```

and in `class TestHookIntegration`:

```python
    def test_tool_events_carry_origin_agent(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "o-s", "tool_name": "Bash", "tool_use_id": "toolu_O",
            "tool_input": {"command": "echo hi"},
            "agent_id": "ag-child", "agent_type": "Explore",
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert start["data"]["origin_agent_id"] == "ag-child"
        assert start["data"]["origin_agent_type"] == "Explore"

    def test_main_thread_tool_events_have_no_origin_agent(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "o-s2", "tool_name": "Bash", "tool_use_id": "toolu_P",
            "tool_input": {"command": "echo hi"},
        })
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_start")
        assert "origin_agent_id" not in start["data"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k "BaseAgentFields or origin_agent" -q` → FAIL.

- [ ] **Step 3: Implement the helper**

In `claude-plugin/lib/telemetry.py`:

```python
def base_agent_fields(hook_input: dict) -> dict:
    """Subagent attribution from the shared hook-input base object.

    Claude Code sets agent_id only when a hook fires from inside a subagent.
    agent_type alone is NOT a subagent signal — it is also set on the main
    thread of a session started with --agent.
    """
    agent_id = hook_input.get("agent_id")
    if not agent_id:
        return {}
    fields = {"origin_agent_id": agent_id}
    agent_type = hook_input.get("agent_type")
    if agent_type:
        fields["origin_agent_type"] = agent_type
    return fields
```

- [ ] **Step 4: Wire into both tool hooks**

Import `base_agent_fields` in `pre_tool_use.py` and `post_tool_use.py`. In `pre_tool_use.py` merge into `tool_data` right after it is built:
```python
    tool_data.update(base_agent_fields(hook_input))
```
In `post_tool_use.py` merge into `event_data` before `write_event`:
```python
    event_data.update(base_agent_fields(hook_input))
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass.

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/hooks/pre_tool_use.py claude-plugin/hooks/post_tool_use.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): attribute tool events to their originating subagent"
```

---

## Task 4: `subagent_stop` — read the real `agent_id`, fix the phantom key

**Files:** Modify `claude-plugin/hooks/subagent_stop.py`; Test `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing tests**

```python
    def test_subagent_stop_uses_payload_agent_id(self, tmp_path):
        r = self._run_hook(tmp_path, "subagent_stop.py", {
            "session_id": "ss-1", "agent_id": "ag-real", "agent_type": "Explore",
            "stop_hook_active": False,
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        ev = next(e for e in self._read_events(tmp_path) if e["event"] == "subagent_stop")
        assert ev["data"]["agent_id"] == "ag-real"

    def test_subagent_stop_emits_stop_hook_active_not_reason(self, tmp_path):
        self._run_hook(tmp_path, "subagent_stop.py", {
            "session_id": "ss-2", "agent_id": "ag-x", "agent_type": "Explore",
            "stop_hook_active": True,
        })
        ev = next(e for e in self._read_events(tmp_path) if e["event"] == "subagent_stop")
        assert ev["data"]["stop_hook_active"] is True
        assert "reason" not in ev["data"], "the nonexistent stop_hook_reason key must be gone"

    def test_subagent_stop_without_agent_id_omits_it(self, tmp_path):
        self._run_hook(tmp_path, "subagent_stop.py", {
            "session_id": "ss-3", "agent_type": "Explore", "stop_hook_active": False,
        })
        ev = next(e for e in self._read_events(tmp_path) if e["event"] == "subagent_stop")
        assert "agent_id" not in ev["data"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k subagent_stop -q` → FAIL.

- [ ] **Step 3: Implement**

In `claude-plugin/hooks/subagent_stop.py`: drop the `peek_pending_by_tool` import and call; read the payload's own fields.

```python
    session_id      = hook_input.get("session_id", "unknown")
    agent_type      = hook_input.get("agent_type") or "general-purpose"
    agent_id        = hook_input.get("agent_id")
    stop_hook_active = bool(hook_input.get("stop_hook_active", False))
    transcript_path = hook_input.get("agent_transcript_path")
```

Replace `"reason": stop_reason,` in `event_data` with `"stop_hook_active": stop_hook_active,`. Keep the `if agent_id:` guard around setting `event_data["agent_id"]`.

Leave the transcript-parsing block untouched — it is still the token source until D2.

- [ ] **Step 4: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass. (An existing test asserting the old `reason` field may need updating — update it to the new contract rather than weakening the new tests.)

- [ ] **Step 5: Commit**

```bash
git add claude-plugin/hooks/subagent_stop.py claude-plugin/tests/test_telemetry.py
git commit -m "fix(plugin): read SubagentStop's real agent_id and stop_hook_active"
```

---

## Task 5: Capture Agent result metrics (strict allowlist)

**Files:** Modify `claude-plugin/lib/telemetry.py`, `claude-plugin/hooks/post_tool_use.py`; Test `claude-plugin/tests/test_telemetry.py`

**Interfaces:** Produces `sanitize_agent_result(tool_response) -> dict`.

- [ ] **Step 1: Write the failing tests**

```python
class TestSanitizeAgentResult:
    SYNC = {
        "status": "completed", "agentId": "ag-1", "agentType": "general-purpose",
        "resolvedModel": "claude-haiku-4-5-20251001",
        "totalDurationMs": 48262, "totalTokens": 36922, "totalToolUseCount": 15,
        "toolStats": {"readCount": 2, "bashCount": 6},
        "prompt": "SECRET PROMPT TEXT", "content": "SECRET CONTENT",
    }
    ASYNC = {
        "isAsync": True, "status": "async_launched", "agentId": "ag-2",
        "description": "SECRET DESCRIPTION", "prompt": "SECRET PROMPT",
        "outputFile": "/tmp/secret-path.output",
    }

    def test_extracts_sync_metrics(self):
        got = telemetry.sanitize_agent_result(self.SYNC)
        assert got["agentId"] == "ag-1"
        assert got["totalTokens"] == 36922
        assert got["totalDurationMs"] == 48262
        assert got["toolStats"] == {"readCount": 2, "bashCount": 6}
        assert got["resolvedModel"] == "claude-haiku-4-5-20251001"

    def test_never_leaks_prompt_content_description_or_path(self):
        for payload in (self.SYNC, self.ASYNC):
            got = telemetry.sanitize_agent_result(payload)
            blob = json.dumps(got)
            for banned in ("SECRET", "outputFile", "description", "prompt", "content"):
                assert banned not in blob, f"{banned} leaked: {blob}"

    def test_async_shape_yields_only_present_fields(self):
        got = telemetry.sanitize_agent_result(self.ASYNC)
        assert got["agentId"] == "ag-2"
        assert got["isAsync"] is True
        assert got["status"] == "async_launched"
        assert "totalTokens" not in got

    def test_non_dict_response_is_empty(self):
        assert telemetry.sanitize_agent_result("just a string") == {}
        assert telemetry.sanitize_agent_result(None) == {}
```

and an integration test:

```python
    def test_agent_tool_end_carries_result_metrics(self, tmp_path):
        self._run_hook(tmp_path, "pre_tool_use.py", {
            "session_id": "m-s", "tool_name": "Agent", "tool_use_id": "toolu_M",
            "tool_input": {"description": "d", "prompt": "p"},
        })
        self._run_hook(tmp_path, "post_tool_use.py", {
            "session_id": "m-s", "tool_name": "Agent", "tool_use_id": "toolu_M",
            "tool_input": {"description": "d", "prompt": "p"},
            "tool_response": {"status": "completed", "agentId": "ag-9",
                              "totalTokens": 100, "prompt": "SECRET"},
        })
        end = next(e for e in self._read_events(tmp_path) if e["event"] == "tool_end")
        assert end["data"]["agent_result"]["agentId"] == "ag-9"
        assert end["data"]["agent_result"]["totalTokens"] == 100
        assert "SECRET" not in json.dumps(end["data"])
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k "SanitizeAgentResult or result_metrics" -q` → FAIL.

- [ ] **Step 3: Implement the sanitizer**

In `claude-plugin/lib/telemetry.py`:

```python
AGENT_RESULT_FIELDS = (
    "agentId", "status", "resolvedModel", "totalDurationMs",
    "totalTokens", "totalToolUseCount", "toolStats", "isAsync",
)


def sanitize_agent_result(tool_response) -> dict:
    """Allowlisted metrics from an Agent tool_response.

    Strict allowlist — prompt, content, description and outputFile are never
    captured. Async results carry only a subset, so every field is optional.
    """
    if not isinstance(tool_response, dict):
        return {}
    return {k: tool_response[k] for k in AGENT_RESULT_FIELDS if k in tool_response}
```

- [ ] **Step 4: Wire into `post_tool_use.py`**

Import `sanitize_agent_result`, and before `write_event`:

```python
    if tool_name == "Agent":
        agent_result = sanitize_agent_result(tool_response)
        if agent_result:
            event_data["agent_result"] = agent_result
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass.

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/hooks/post_tool_use.py claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): capture allowlisted Agent result metrics"
```

---

## Task 6: Register the `SubagentStart` hook

**Files:** Create `claude-plugin/hooks/subagent_start.py`; Modify `claude-plugin/hooks/hooks.json`; Test `claude-plugin/tests/test_telemetry.py`

- [ ] **Step 1: Write the failing test**

```python
    def test_subagent_start_emits_agent_identity(self, tmp_path):
        r = self._run_hook(tmp_path, "subagent_start.py", {
            "session_id": "st-1", "agent_id": "ag-new", "agent_type": "Explore",
        })
        assert r.returncode == 0, f"stderr: {r.stderr}"
        ev = next(e for e in self._read_events(tmp_path) if e["event"] == "subagent_start")
        assert ev["data"]["agent_id"] == "ag-new"
        assert ev["data"]["agent_type"] == "Explore"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k subagent_start -q` → FAIL (no such hook file).

- [ ] **Step 3: Create the hook**

Create `claude-plugin/hooks/subagent_start.py`, mirroring the structure of `subagent_stop.py`:

```python
#!/usr/bin/env python3
"""SubagentStart hook — record a subagent spawn at the moment it begins."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import read_hook_input, is_enabled, write_event


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")

    event_data: dict = {}
    agent_id = hook_input.get("agent_id")
    if agent_id:
        event_data["agent_id"] = agent_id
    agent_type = hook_input.get("agent_type")
    if agent_type:
        event_data["agent_type"] = agent_type

    write_event("subagent_start", session_id, event_data)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Register it**

In `claude-plugin/hooks/hooks.json`, add a `"SubagentStart"` entry matching the exact shape of the existing `"SubagentStop"` block (same nesting, `"type": "command"`, `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/subagent_start.py`, `"timeout": 10`).

> Note: `subagent_start` is a NEW event type. The SaaS ingest Zod enum does not include it, so these events will be rejected at ingest until D2 adds it. That is expected and acceptable for this slice — local JSONL capture is unaffected. Do NOT modify the ingest schema here (out of scope).

- [ ] **Step 5: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass.

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/hooks/subagent_start.py claude-plugin/hooks/hooks.json claude-plugin/tests/test_telemetry.py
git commit -m "feat(plugin): register SubagentStart hook"
```

---

## Task 7: Delete the dead spawn-context path; bump to 1.3.0

**Files:** Modify `claude-plugin/lib/telemetry.py`, `claude-plugin/hooks/pre_tool_use.py`, `claude-plugin/hooks/post_tool_use.py`, `claude-plugin/hooks/session_start.py`, `claude-plugin/.claude-plugin/plugin.json`; Test `claude-plugin/tests/test_telemetry.py`

**Rationale:** subagents never fire `SessionStart`, so nothing ever reads this context. `parent_session_id` has zero real occurrences across all 24 captured event files.

- [ ] **Step 1: Write the failing test**

```python
    def test_session_start_no_longer_emits_spawn_parentage(self, tmp_path):
        self._run_hook(tmp_path, "session_start.py", {"session_id": "d-s", "cwd": "/tmp"})
        start = next(e for e in self._read_events(tmp_path) if e["event"] == "session_start")
        assert "parent_session_id" not in start["data"]
        assert "agent_id" not in start["data"]

    def test_spawn_context_helpers_are_gone(self):
        for name in ("write_agent_spawn_context", "read_agent_spawn_context",
                     "clear_agent_spawn_context"):
            assert not hasattr(telemetry, name), f"{name} should be deleted"
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd claude-plugin && uv run --with pytest pytest tests/test_telemetry.py -k "spawn_parentage or spawn_context_helpers" -q` → FAIL.

- [ ] **Step 3: Delete the code**

- `claude-plugin/lib/telemetry.py`: remove `write_agent_spawn_context`, `read_agent_spawn_context`, `clear_agent_spawn_context`, and the module-level agent-spawn-context path constant they use (grep for it; remove only if unreferenced elsewhere).
- `claude-plugin/hooks/pre_tool_use.py`: remove the `write_agent_spawn_context` import and its call in the Agent branch.
- `claude-plugin/hooks/post_tool_use.py`: remove the `clear_agent_spawn_context` import and the trailing `if tool_name == "Agent":` guard block that calls it.
- `claude-plugin/hooks/session_start.py`: remove the `read_agent_spawn_context`/`clear_agent_spawn_context` imports, the `spawn_ctx` read, and the `parent_session_id`/`agent_id`/`spawner_id`/`spawner_type` block. Keep `cwd`, both eval fields, and `update_session_index`.

Delete any existing tests that assert the removed behavior (they encode a contract that is now known false) — do not weaken the new tests to accommodate them.

- [ ] **Step 4: Bump the version**

`claude-plugin/.claude-plugin/plugin.json`: `"version": "1.2.0"` → `"version": "1.3.0"`.

- [ ] **Step 5: Run to verify it passes**

Run: `cd claude-plugin && uv run --with pytest pytest tests/ -q` → all pass.
Also grep to confirm nothing dangles: `grep -rn "agent_spawn_context" claude-plugin/` → no hits.

- [ ] **Step 6: Commit**

```bash
git add claude-plugin/lib/telemetry.py claude-plugin/hooks/ claude-plugin/.claude-plugin/plugin.json claude-plugin/tests/test_telemetry.py
git commit -m "refactor(plugin): delete dead agent spawn-context path; bump to 1.3.0"
```

---

## Self-Review

**Spec coverage:**
- §3.1 `tool_use_id` correlation + flock → Tasks 1, 2 ✓
- §3.2 native duration with fallback + `duration_source` → Task 2 ✓
- §3.3 base `agent_id`/`agent_type` attribution → Task 3 ✓
- §3.4 SubagentStop real `agent_id` + `stop_hook_active`; SubagentStart → Tasks 4, 6 ✓
- §3.5 Agent result allowlist → Task 5 ✓
- §3.6 delete dead spawn-context path → Task 7 ✓
- §2 version bump 1.3.0 → Task 7 ✓
- §5 test coverage incl. the out-of-order regression case and a concurrency test → Tasks 1, 2 ✓
- §2 out-of-scope honored: no `apps/app/`, no migrations, no RPCs touched by any task ✓

**Placeholder scan:** none — every step carries real code. Task 6 Step 4 and Task 7 Step 3 direct edits by reference to existing structures rather than restating them, which is precise, not vague.

**Type/name consistency:** `push_pending`/`pop_pending` signatures defined Task 1, used Task 2; `base_agent_fields` defined Task 3, used Task 3; `sanitize_agent_result` defined Task 5, used Task 5; `origin_agent_id`/`origin_agent_type` deliberately distinct from the spawn-meaning `agent_id` throughout.

**Known consequences (documented, not gaps):** `subagent_start` events will be rejected by the SaaS ingest enum until D2; the spawn graph remains empty until D2; historical data is not repaired.
