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
