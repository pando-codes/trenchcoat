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
async def test_on_agent_end_flush_failure_retains_events():
    hooks = TrenchcoatHooks(api_key=API_KEY, api_url=API_URL)
    hooks._session_id = "sess-1"

    import httpx
    flush_mock = AsyncMock(side_effect=httpx.HTTPError("connection failed"))
    with patch("trenchcoat_openai_agents.hooks.flush_events", flush_mock):
        await hooks.on_agent_end(_ctx(), _agent(), "output")  # must not raise

    # events are retained when flush fails (not lost)
    assert len(hooks._events) > 0
    assert hooks._events[-1]["event"] == "session_end"


@pytest.mark.asyncio
async def test_hook_errors_are_silent():
    hooks = TrenchcoatHooks(api_key=API_KEY)
    broken_agent = MagicMock()
    broken_agent.name = MagicMock(side_effect=RuntimeError("boom"))
    await hooks.on_agent_start(_ctx(), broken_agent)   # must not raise
    await hooks.on_tool_start(_ctx(), broken_agent, _tool())  # must not raise
