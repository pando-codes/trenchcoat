# Track A: OpenAI Agents SDK Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `trenchcoat-openai-agents`, a Python package that passively instruments OpenAI Agents SDK runs and sends telemetry events to the Trenchcoat API with full parity to the Claude Code plugin.

**Architecture:** Implements `RunHooks` and `AgentHooks` from the `openai-agents` SDK. Events accumulate in an in-process list during a run and flush to `POST /api/v1/events` on `on_agent_end`. Every hook method is wrapped in `try/except` so telemetry never breaks agent runs.

**Tech Stack:** Python 3.11+, `openai-agents`, `httpx` (async HTTP), `pytest` + `pytest-asyncio` + `respx` (test mocking)

---

## File Map

All new files under `packages/trenchcoat-openai-agents/`:

| File | Responsibility |
|---|---|
| `pyproject.toml` | Package metadata, deps, pytest config |
| `src/trenchcoat_openai_agents/__init__.py` | Public exports: `TrenchcoatHooks`, `TrenchcoatAgentHooks`, `instrument` |
| `src/trenchcoat_openai_agents/_core.py` | `TrenchcoatConfig`, `sanitize_tool_input`, `build_event`, `flush_events` |
| `src/trenchcoat_openai_agents/hooks.py` | `TrenchcoatHooks` (implements `RunHooks`), `instrument()`, module-level `_default_config` |
| `src/trenchcoat_openai_agents/agent_hooks.py` | `TrenchcoatAgentHooks` (implements `AgentHooks`, writes into parent's event buffer) |
| `tests/conftest.py` | `reset_default_config` autouse fixture |
| `tests/test_core.py` | Unit tests for `_core.py` |
| `tests/test_hooks.py` | Unit tests for `hooks.py` |
| `tests/test_agent_hooks.py` | Unit tests for `agent_hooks.py` |
| `tests/test_integration.py` | End-to-end: full lifecycle → events arrive at mock HTTP API |

---

### Task 1: Package Scaffold

**Files:**
- Create: `packages/trenchcoat-openai-agents/pyproject.toml`
- Create: `packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/__init__.py`
- Create: `packages/trenchcoat-openai-agents/tests/conftest.py`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents
mkdir -p packages/trenchcoat-openai-agents/tests
```

- [ ] **Step 2: Write `pyproject.toml`**

`packages/trenchcoat-openai-agents/pyproject.toml`:
```toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[project]
name = "trenchcoat-openai-agents"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "openai-agents>=0.0.3",
    "httpx>=0.27",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "respx>=0.21",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.hatch.build.targets.wheel]
packages = ["src/trenchcoat_openai_agents"]
```

- [ ] **Step 3: Create empty `__init__.py`**

`packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/__init__.py`:
```python
# populated in Task 5
```

- [ ] **Step 4: Create `tests/conftest.py`**

`packages/trenchcoat-openai-agents/tests/conftest.py`:
```python
import pytest
import trenchcoat_openai_agents.hooks as _hooks_module


@pytest.fixture(autouse=True)
def reset_default_config():
    _hooks_module._default_config = None
    yield
    _hooks_module._default_config = None
```

Note: this fixture will fail to import until `hooks.py` exists (Task 3). Run `pytest` only from Task 3 onward.

- [ ] **Step 5: Install the package**

```bash
cd packages/trenchcoat-openai-agents
pip install -e ".[dev]"
```

Expected: no errors. `python -c "import trenchcoat_openai_agents"` succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/trenchcoat-openai-agents/
git commit -m "feat(openai-agents): scaffold trenchcoat-openai-agents package"
```

---

### Task 2: Core Utilities (`_core.py`)

**Files:**
- Create: `packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/_core.py`
- Create: `packages/trenchcoat-openai-agents/tests/test_core.py`

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-openai-agents/tests/test_core.py`:
```python
import json
import pytest
import respx
import httpx
from trenchcoat_openai_agents._core import (
    TrenchcoatConfig,
    sanitize_tool_input,
    build_event,
    flush_events,
)

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"


def test_sanitize_none_returns_none():
    assert sanitize_tool_input(None) is None


def test_sanitize_short_string_unchanged():
    assert sanitize_tool_input("hello") == "hello"


def test_sanitize_long_string_truncated():
    result = sanitize_tool_input("x" * 200)
    assert result.endswith("...")
    assert len(result) == 103  # 100 chars + "..."


def test_sanitize_dict_serialized():
    result = sanitize_tool_input({"key": "value"})
    assert "key" in result
    assert "value" in result


def test_build_event_shape():
    event = build_event("tool_use", "sess-123", {"tool_name": "Read"})
    assert event["event"] == "tool_use"
    assert event["session_id"] == "sess-123"
    assert event["data"]["tool_name"] == "Read"
    assert "ts" in event


@pytest.mark.asyncio
async def test_flush_events_empty_is_noop():
    config = TrenchcoatConfig(api_key=API_KEY)
    await flush_events([], config)  # must not raise or make HTTP calls


@pytest.mark.asyncio
@respx.mock
async def test_flush_events_posts_to_api():
    config = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)
    route = respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": {"received": 1}})
    )
    events = [build_event("session_start", "sess-1", {})]
    await flush_events(events, config)

    assert route.called
    body = json.loads(route.calls[0].request.content)
    assert body["events"][0]["event"] == "session_start"
    assert route.calls[0].request.headers["X-API-Key"] == API_KEY


@pytest.mark.asyncio
@respx.mock
async def test_flush_events_batches_correctly():
    config = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL, batch_size=2)
    route = respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": {}})
    )
    events = [build_event("tool_use", "sess-1", {}) for _ in range(5)]
    await flush_events(events, config)
    assert route.call_count == 3  # [2, 2, 1]
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_core.py -v
```

Expected: `ImportError: cannot import name 'TrenchcoatConfig'`

- [ ] **Step 3: Write `_core.py`**

`packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/_core.py`:
```python
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx


@dataclass
class TrenchcoatConfig:
    api_key: str
    api_url: str = "https://app.trenchcoat.io"
    batch_size: int = 100
    tool_input_preview_chars: int = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def sanitize_tool_input(tool_input: Any, max_chars: int = 100) -> str | None:
    if tool_input is None:
        return None
    if isinstance(tool_input, (dict, list)):
        text = json.dumps(tool_input, default=str)
    else:
        text = str(tool_input)
    return (text[:max_chars] + "...") if len(text) > max_chars else text


def build_event(event_type: str, session_id: str, data: dict) -> dict:
    return {
        "ts": _now_iso(),
        "event": event_type,
        "session_id": session_id,
        "data": data,
    }


async def flush_events(events: list[dict], config: TrenchcoatConfig) -> None:
    if not events:
        return
    url = f"{config.api_url.rstrip('/')}/api/v1/events"
    headers = {"X-API-Key": config.api_key, "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=30) as client:
        for i in range(0, len(events), config.batch_size):
            batch = events[i : i + config.batch_size]
            resp = await client.post(url, json={"events": batch}, headers=headers)
            resp.raise_for_status()
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_core.py -v
```

Expected: 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/_core.py \
        packages/trenchcoat-openai-agents/tests/test_core.py
git commit -m "feat(openai-agents): add core event utilities and HTTP flush"
```

---

### Task 3: `TrenchcoatHooks` (`hooks.py`)

**Files:**
- Create: `packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/hooks.py`
- Create: `packages/trenchcoat-openai-agents/tests/test_hooks.py`

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-openai-agents/tests/test_hooks.py`:
```python
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from trenchcoat_openai_agents.hooks import TrenchcoatHooks

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"


def _agent(name="agent-x"):
    a = MagicMock()
    a.name = name
    return a


def _tool(name="Read"):
    t = MagicMock()
    t.name = name
    return t


def _ctx(input_tokens=10, output_tokens=20):
    ctx = MagicMock()
    ctx.usage.input_tokens = input_tokens
    ctx.usage.output_tokens = output_tokens
    return ctx


@pytest.mark.asyncio
async def test_on_agent_start_appends_session_start():
    hooks = TrenchcoatHooks(api_key=API_KEY)
    await hooks.on_agent_start(_ctx(), _agent())
    assert len(hooks._events) == 1
    assert hooks._events[0]["event"] == "session_start"
    assert hooks._session_id != ""


@pytest.mark.asyncio
async def test_on_tool_start_appends_tool_use():
    hooks = TrenchcoatHooks(api_key=API_KEY)
    hooks._session_id = "sess-1"
    await hooks.on_tool_start(_ctx(), _agent(), _tool("Bash"))
    assert hooks._events[0]["event"] == "tool_use"
    assert hooks._events[0]["data"]["tool_name"] == "Bash"


@pytest.mark.asyncio
async def test_on_tool_end_appends_tool_result():
    hooks = TrenchcoatHooks(api_key=API_KEY)
    hooks._session_id = "sess-1"
    await hooks.on_tool_end(_ctx(), _agent(), _tool("Read"), "file contents")
    assert hooks._events[0]["event"] == "tool_result"
    assert hooks._events[0]["data"]["result_size"] == len("file contents")


@pytest.mark.asyncio
async def test_on_handoff_appends_subagent_stop():
    hooks = TrenchcoatHooks(api_key=API_KEY)
    hooks._session_id = "sess-1"
    await hooks.on_handoff(_ctx(), _agent("agent-a"), _agent("agent-b"))
    assert hooks._events[0]["event"] == "subagent_stop"
    assert hooks._events[0]["data"]["from_agent"] == "agent-a"
    assert hooks._events[0]["data"]["to_agent"] == "agent-b"


@pytest.mark.asyncio
async def test_on_agent_end_flushes_with_session_end_and_tokens():
    hooks = TrenchcoatHooks(api_key=API_KEY, api_url=API_URL)
    hooks._session_id = "sess-1"

    flush_mock = AsyncMock()
    with patch("trenchcoat_openai_agents.hooks.flush_events", flush_mock):
        await hooks.on_agent_end(_ctx(input_tokens=5, output_tokens=10), _agent(), "output")

    flush_mock.assert_awaited_once()
    flushed_events = flush_mock.call_args[0][0]
    assert flushed_events[-1]["event"] == "session_end"
    assert flushed_events[-1]["data"]["input_tokens"] == 5
    assert flushed_events[-1]["data"]["output_tokens"] == 10
    assert hooks._events == []  # buffer cleared after flush


@pytest.mark.asyncio
async def test_hook_errors_are_silent():
    hooks = TrenchcoatHooks(api_key=API_KEY)
    broken_agent = MagicMock()
    broken_agent.name = MagicMock(side_effect=RuntimeError("boom"))
    await hooks.on_agent_start(_ctx(), broken_agent)   # must not raise
    await hooks.on_tool_start(_ctx(), broken_agent, _tool())  # must not raise
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_hooks.py -v
```

Expected: `ImportError: cannot import name 'TrenchcoatHooks'`

- [ ] **Step 3: Write `hooks.py`**

`packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/hooks.py`:
```python
from __future__ import annotations

import uuid
from typing import Any

from agents import RunHooks

from ._core import TrenchcoatConfig, build_event, flush_events

_default_config: TrenchcoatConfig | None = None


class TrenchcoatHooks(RunHooks):
    def __init__(
        self,
        api_key: str | None = None,
        api_url: str | None = None,
        batch_size: int = 100,
    ) -> None:
        if api_key is None:
            if _default_config is None:
                raise ValueError(
                    "api_key required. Pass it directly or call instrument() first."
                )
            self._config = _default_config
        else:
            self._config = TrenchcoatConfig(
                api_key=api_key,
                api_url=api_url or "https://app.trenchcoat.io",
                batch_size=batch_size,
            )
        self._session_id: str = ""
        self._events: list[dict] = []

    async def on_agent_start(self, context: Any, agent: Any) -> None:
        try:
            self._session_id = str(uuid.uuid4())
            self._events.append(
                build_event("session_start", self._session_id, {
                    "agent_name": agent.name,
                    "platform": "openai-agents",
                })
            )
        except Exception:
            pass

    async def on_tool_start(self, context: Any, agent: Any, tool: Any) -> None:
        try:
            self._events.append(
                build_event("tool_use", self._session_id, {"tool_name": tool.name})
            )
        except Exception:
            pass

    async def on_tool_end(self, context: Any, agent: Any, tool: Any, result: str) -> None:
        try:
            self._events.append(
                build_event("tool_result", self._session_id, {
                    "tool_name": tool.name,
                    "result_size": len(result) if result else 0,
                })
            )
        except Exception:
            pass

    async def on_handoff(self, context: Any, from_agent: Any, to_agent: Any) -> None:
        try:
            self._events.append(
                build_event("subagent_stop", self._session_id, {
                    "from_agent": from_agent.name,
                    "to_agent": to_agent.name,
                })
            )
        except Exception:
            pass

    async def on_agent_end(self, context: Any, agent: Any, output: Any) -> None:
        try:
            usage_data: dict = {}
            if hasattr(context, "usage") and context.usage is not None:
                usage_data = {
                    "input_tokens": getattr(context.usage, "input_tokens", 0),
                    "output_tokens": getattr(context.usage, "output_tokens", 0),
                }
            self._events.append(
                build_event("session_end", self._session_id, {
                    "agent_name": agent.name,
                    **usage_data,
                })
            )
            events_to_flush = list(self._events)
            self._events.clear()
            await flush_events(events_to_flush, self._config)
        except Exception:
            pass


def instrument(api_key: str, api_url: str | None = None, batch_size: int = 100) -> None:
    """Set default config so TrenchcoatHooks() can be called without arguments."""
    global _default_config
    _default_config = TrenchcoatConfig(
        api_key=api_key,
        api_url=api_url or "https://app.trenchcoat.io",
        batch_size=batch_size,
    )
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_hooks.py -v
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/hooks.py \
        packages/trenchcoat-openai-agents/tests/test_hooks.py
git commit -m "feat(openai-agents): add TrenchcoatHooks and instrument()"
```

---

### Task 4: `TrenchcoatAgentHooks` (`agent_hooks.py`)

**Files:**
- Create: `packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/agent_hooks.py`
- Create: `packages/trenchcoat-openai-agents/tests/test_agent_hooks.py`

- [ ] **Step 1: Write the failing tests**

`packages/trenchcoat-openai-agents/tests/test_agent_hooks.py`:
```python
import pytest
from unittest.mock import MagicMock
from trenchcoat_openai_agents.hooks import TrenchcoatHooks
from trenchcoat_openai_agents.agent_hooks import TrenchcoatAgentHooks

API_KEY = "ct_live_test"


def _agent(name="agent-x"):
    a = MagicMock()
    a.name = name
    return a


def _tool(name="Write"):
    t = MagicMock()
    t.name = name
    return t


@pytest.mark.asyncio
async def test_on_start_appends_agent_start_to_parent():
    parent = TrenchcoatHooks(api_key=API_KEY)
    parent._session_id = "sess-1"
    ah = TrenchcoatAgentHooks(parent)
    await ah.on_start(MagicMock(), _agent("sub-agent"))
    assert len(parent._events) == 1
    assert parent._events[0]["event"] == "agent_start"
    assert parent._events[0]["data"]["agent_name"] == "sub-agent"


@pytest.mark.asyncio
async def test_on_tool_start_appends_tool_use_to_parent():
    parent = TrenchcoatHooks(api_key=API_KEY)
    parent._session_id = "sess-1"
    ah = TrenchcoatAgentHooks(parent)
    await ah.on_tool_start(MagicMock(), _agent(), _tool("Edit"))
    assert parent._events[0]["event"] == "tool_use"
    assert parent._events[0]["data"]["tool_name"] == "Edit"


@pytest.mark.asyncio
async def test_on_tool_end_records_result_size():
    parent = TrenchcoatHooks(api_key=API_KEY)
    parent._session_id = "sess-1"
    ah = TrenchcoatAgentHooks(parent)
    await ah.on_tool_end(MagicMock(), _agent(), _tool(), "result text")
    assert parent._events[0]["event"] == "tool_result"
    assert parent._events[0]["data"]["result_size"] == len("result text")


@pytest.mark.asyncio
async def test_agent_hooks_errors_are_silent():
    parent = TrenchcoatHooks(api_key=API_KEY)
    parent._session_id = "sess-1"
    ah = TrenchcoatAgentHooks(parent)
    broken = MagicMock()
    broken.name = MagicMock(side_effect=RuntimeError("boom"))
    await ah.on_start(MagicMock(), broken)  # must not raise
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_agent_hooks.py -v
```

Expected: `ImportError: cannot import name 'TrenchcoatAgentHooks'`

- [ ] **Step 3: Write `agent_hooks.py`**

`packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/agent_hooks.py`:
```python
from __future__ import annotations

from typing import TYPE_CHECKING, Any

from agents import AgentHooks

from ._core import build_event

if TYPE_CHECKING:
    from .hooks import TrenchcoatHooks


class TrenchcoatAgentHooks(AgentHooks):
    """Per-agent hooks that write into a parent TrenchcoatHooks event buffer."""

    def __init__(self, parent: TrenchcoatHooks) -> None:
        self._parent = parent

    async def on_start(self, context: Any, agent: Any) -> None:
        try:
            self._parent._events.append(
                build_event("agent_start", self._parent._session_id, {
                    "agent_name": agent.name,
                })
            )
        except Exception:
            pass

    async def on_end(self, context: Any, agent: Any, output: Any) -> None:
        try:
            self._parent._events.append(
                build_event("agent_end", self._parent._session_id, {
                    "agent_name": agent.name,
                })
            )
        except Exception:
            pass

    async def on_handoff(self, context: Any, agent: Any, source: Any) -> None:
        try:
            self._parent._events.append(
                build_event("subagent_stop", self._parent._session_id, {
                    "from_agent": source.name,
                    "to_agent": agent.name,
                })
            )
        except Exception:
            pass

    async def on_tool_start(self, context: Any, agent: Any, tool: Any) -> None:
        try:
            self._parent._events.append(
                build_event("tool_use", self._parent._session_id, {
                    "tool_name": tool.name,
                })
            )
        except Exception:
            pass

    async def on_tool_end(self, context: Any, agent: Any, tool: Any, result: str) -> None:
        try:
            self._parent._events.append(
                build_event("tool_result", self._parent._session_id, {
                    "tool_name": tool.name,
                    "result_size": len(result) if result else 0,
                })
            )
        except Exception:
            pass
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_agent_hooks.py -v
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/agent_hooks.py \
        packages/trenchcoat-openai-agents/tests/test_agent_hooks.py
git commit -m "feat(openai-agents): add TrenchcoatAgentHooks for per-agent attribution"
```

---

### Task 5: Public Exports and `instrument()` Tests

**Files:**
- Modify: `packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/__init__.py`
- Modify: `packages/trenchcoat-openai-agents/tests/test_hooks.py` (append 3 tests)

- [ ] **Step 1: Write the failing tests**

Append these tests to `packages/trenchcoat-openai-agents/tests/test_hooks.py`:

```python
# --- instrument() tests ---

from trenchcoat_openai_agents import TrenchcoatHooks as _TH, TrenchcoatAgentHooks, instrument
import trenchcoat_openai_agents.hooks as _hooks_mod


def test_instrument_sets_default_config():
    instrument(api_key="ct_live_x", api_url="https://example.com")
    hooks = TrenchcoatHooks()  # no args
    assert hooks._config.api_key == "ct_live_x"
    assert hooks._config.api_url == "https://example.com"


def test_hooks_without_args_raises_without_instrument():
    # reset_default_config fixture already sets _default_config = None
    with pytest.raises(ValueError, match="api_key required"):
        TrenchcoatHooks()


def test_public_api_exports():
    from trenchcoat_openai_agents import TrenchcoatHooks, TrenchcoatAgentHooks, instrument
    assert callable(TrenchcoatHooks)
    assert callable(TrenchcoatAgentHooks)
    assert callable(instrument)
```

- [ ] **Step 2: Run tests — verify the new ones fail**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_hooks.py::test_instrument_sets_default_config \
       tests/test_hooks.py::test_public_api_exports -v
```

Expected: `ImportError` on `instrument` not exported from package.

- [ ] **Step 3: Update `__init__.py`**

`packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/__init__.py`:
```python
from .hooks import TrenchcoatHooks, instrument
from .agent_hooks import TrenchcoatAgentHooks

__all__ = ["TrenchcoatHooks", "TrenchcoatAgentHooks", "instrument"]
```

- [ ] **Step 4: Run all tests — verify they pass**

```bash
cd packages/trenchcoat-openai-agents
pytest -v
```

Expected: all tests PASS (no failures, no errors).

- [ ] **Step 5: Commit**

```bash
git add packages/trenchcoat-openai-agents/src/trenchcoat_openai_agents/__init__.py \
        packages/trenchcoat-openai-agents/tests/test_hooks.py
git commit -m "feat(openai-agents): wire public exports and instrument() defaults"
```

---

### Task 6: Integration Test

**Files:**
- Create: `packages/trenchcoat-openai-agents/tests/test_integration.py`

This test simulates a complete agent lifecycle without calling the real OpenAI API. It exercises all hooks in order, mocks the HTTP endpoint, and asserts the full event sequence.

- [ ] **Step 1: Write the integration test**

`packages/trenchcoat-openai-agents/tests/test_integration.py`:
```python
import json
import pytest
import respx
import httpx
from unittest.mock import MagicMock
from trenchcoat_openai_agents import TrenchcoatHooks

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"


def _agent(name="my-agent"):
    a = MagicMock()
    a.name = name
    return a


def _tool(name="Bash"):
    t = MagicMock()
    t.name = name
    return t


def _ctx(input_tokens=50, output_tokens=100):
    ctx = MagicMock()
    ctx.usage.input_tokens = input_tokens
    ctx.usage.output_tokens = output_tokens
    return ctx


@pytest.mark.asyncio
@respx.mock
async def test_full_lifecycle_sends_correct_event_sequence():
    route = respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": {"received": 5}})
    )

    hooks = TrenchcoatHooks(api_key=API_KEY, api_url=API_URL)
    agent = _agent()
    tool = _tool()
    ctx = _ctx()

    await hooks.on_agent_start(ctx, agent)
    await hooks.on_tool_start(ctx, agent, tool)
    await hooks.on_tool_end(ctx, agent, tool, "file contents here")
    await hooks.on_handoff(ctx, agent, _agent("sub-agent"))
    await hooks.on_agent_end(ctx, agent, "final output")

    assert route.called
    body = json.loads(route.calls[0].request.content)
    event_types = [e["event"] for e in body["events"]]
    assert event_types == [
        "session_start",
        "tool_use",
        "tool_result",
        "subagent_stop",
        "session_end",
    ]

    # all events share a single session_id
    session_ids = {e["session_id"] for e in body["events"]}
    assert len(session_ids) == 1

    # session_end carries token counts
    session_end = body["events"][-1]
    assert session_end["data"]["input_tokens"] == 50
    assert session_end["data"]["output_tokens"] == 100

    # buffer is cleared after flush
    assert hooks._events == []


@pytest.mark.asyncio
@respx.mock
async def test_flush_failure_does_not_raise():
    respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(500, json={"error": "server error"})
    )
    hooks = TrenchcoatHooks(api_key=API_KEY, api_url=API_URL)
    ctx = _ctx()
    agent = _agent()

    await hooks.on_agent_start(ctx, agent)
    await hooks.on_agent_end(ctx, agent, "output")  # must not raise despite 500
```

- [ ] **Step 2: Run the integration tests**

```bash
cd packages/trenchcoat-openai-agents
pytest tests/test_integration.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 3: Run the full test suite**

```bash
cd packages/trenchcoat-openai-agents
pytest -v
```

Expected: all tests PASS, no failures.

- [ ] **Step 4: Commit**

```bash
git add packages/trenchcoat-openai-agents/tests/test_integration.py
git commit -m "test(openai-agents): add integration tests for full agent lifecycle"
```

---

## Track C

Track C (GitHub Copilot Extension + M365 Copilot Studio) is a separate plan. It requires a web server, GitHub App registration, streaming protocol implementation, and deployment infrastructure independent of this package.

---

## Self-Review

**Spec coverage:**
- `TrenchcoatHooks` (RunHooks) — Task 3 ✓
- `TrenchcoatAgentHooks` (AgentHooks) — Task 4 ✓
- `instrument()` global defaults — Task 5 ✓
- Event schema: session_start, tool_use, tool_result, subagent_stop, session_end — all covered ✓
- Token counts from `context.usage` — Task 3, `on_agent_end` ✓
- Telemetry never breaks agent run — `try/except` in every hook + `test_flush_failure_does_not_raise` ✓
- Batch flush to `/api/v1/events` — Task 2 ✓
- `platform: "openai-agents"` field distinguishes events from Claude Code events — Task 3, `on_agent_start` ✓

**No placeholders found.**

**Type consistency:** `TrenchcoatConfig` defined in `_core.py`, used in `hooks.py` line-by-line. `flush_events` signature `(events: list[dict], config: TrenchcoatConfig)` matches across all call sites. `TrenchcoatAgentHooks(parent: TrenchcoatHooks)` matches all test instantiations.

**One caveat:** The `openai-agents` SDK's exact method signatures for `RunHooks` and `AgentHooks` should be verified against the installed version on first run. If the SDK uses different method names (e.g., `on_run_start` instead of `on_agent_start`), update the method names in `hooks.py` to match. The logic inside each method is unaffected.
