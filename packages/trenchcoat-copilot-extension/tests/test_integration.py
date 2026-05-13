import json
import pytest
import respx
import httpx
from unittest.mock import AsyncMock, MagicMock
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from trenchcoat_copilot_extension import create_app, TrenchcoatConfig

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)


def _make_mock_openai_client() -> MagicMock:
    mock_client = MagicMock()

    async def _aiter():
        for text in ["The", " answer", " is", " 42."]:
            chunk = MagicMock()
            chunk.model_dump_json.return_value = json.dumps({
                "choices": [{"delta": {"content": text}}]
            })
            chunk.usage = None
            yield chunk
        final = MagicMock()
        final.model_dump_json.return_value = json.dumps({
            "choices": [{"delta": {}, "finish_reason": "stop"}],
        })
        final.usage = MagicMock(prompt_tokens=15, completion_tokens=7)
        yield final

    mock_stream = MagicMock()
    mock_stream.__aenter__ = AsyncMock(return_value=mock_stream)
    mock_stream.__aexit__ = AsyncMock(return_value=False)
    mock_stream.__aiter__ = lambda self: _aiter()
    mock_client.chat.completions.stream.return_value = mock_stream
    return mock_client


@pytest.mark.asyncio
@respx.mock
async def test_full_copilot_conversation_turn_sends_all_events():
    trenchcoat_route = respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(200, json={"data": {"received": 4}})
    )

    mock_llm = _make_mock_openai_client()
    from trenchcoat_copilot_extension.copilot_router import make_copilot_router
    from trenchcoat_copilot_extension.bot_router import make_bot_router
    app = FastAPI()
    app.include_router(make_copilot_router(CONFIG, _make_client=lambda api_key: mock_llm))
    app.include_router(make_bot_router(CONFIG))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={
                "messages": [{"role": "user", "content": "What is the answer?"}],
                "copilot_thread_id": "thread-integration-1",
            },
            headers={"X-GitHub-Token": "gh-test-token"},
        ) as response:
            assert response.status_code == 200
            lines = [line async for line in response.aiter_lines() if line]

    # SSE stream contains [DONE]
    assert "data: [DONE]" in lines

    # Trenchcoat API received events
    assert trenchcoat_route.called
    body = json.loads(trenchcoat_route.calls[0].request.content)
    event_types = [e["event"] for e in body["events"]]
    assert event_types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]

    # All events share the thread ID as session_id
    session_ids = {e["session_id"] for e in body["events"]}
    assert session_ids == {"thread-integration-1"}

    # session_start has correct platform
    assert body["events"][0]["data"]["platform"] == "github-copilot"

    # Token counts in assistant_stop and session_end
    assistant_stop = next(e for e in body["events"] if e["event"] == "assistant_stop")
    assert assistant_stop["data"]["input_tokens"] == 15
    assert assistant_stop["data"]["output_tokens"] == 7

    # buffer is cleared after flush
    assert mock_llm.chat.completions.stream.call_count == 1


@pytest.mark.asyncio
@respx.mock
async def test_telemetry_flush_failure_does_not_break_sse_stream():
    """If the Trenchcoat API is down, the SSE response still completes."""
    respx.post(f"{API_URL}/api/v1/events").mock(
        return_value=httpx.Response(500, json={"error": "server error"})
    )

    mock_llm = _make_mock_openai_client()
    from trenchcoat_copilot_extension.copilot_router import make_copilot_router
    from trenchcoat_copilot_extension.bot_router import make_bot_router
    app = FastAPI()
    app.include_router(make_copilot_router(CONFIG, _make_client=lambda api_key: mock_llm))
    app.include_router(make_bot_router(CONFIG))

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-2"},
            headers={"X-GitHub-Token": "gh-test-token"},
        ) as response:
            assert response.status_code == 200
            lines = [line async for line in response.aiter_lines() if line]

    assert "data: [DONE]" in lines  # stream completed despite API failure
