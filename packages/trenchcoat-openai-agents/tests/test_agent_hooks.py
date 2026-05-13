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
