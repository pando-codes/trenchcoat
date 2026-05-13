import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from trenchcoat_copilot_extension._core import TrenchcoatConfig
from trenchcoat_copilot_extension.copilot_router import make_copilot_router

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)


def _make_mock_openai_client(chunks: list[str]) -> MagicMock:
    """Return a mock AsyncOpenAI client that streams the given text chunks."""
    mock_client = MagicMock()

    async def _aiter():
        for text in chunks:
            chunk = MagicMock()
            chunk.model_dump_json.return_value = json.dumps({
                "choices": [{"delta": {"content": text}}]
            })
            chunk.usage = None
            yield chunk
        # Final chunk with usage
        final = MagicMock()
        final.model_dump_json.return_value = json.dumps({
            "choices": [{"delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        })
        final.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
        yield final

    mock_stream = MagicMock()
    mock_stream.__aenter__ = AsyncMock(return_value=mock_stream)
    mock_stream.__aexit__ = AsyncMock(return_value=False)
    mock_stream.__aiter__ = lambda self: _aiter()
    mock_client.chat.completions.stream.return_value = mock_stream
    return mock_client


@pytest.fixture()
def app_with_mock_client():
    mock_client = _make_mock_openai_client(["Hello", " world"])
    router = make_copilot_router(CONFIG, _make_client=lambda api_key: mock_client)
    app = FastAPI()
    app.include_router(router)
    return app, mock_client


@pytest.mark.asyncio
async def test_post_root_returns_sse_stream(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-1"},
            headers={"X-GitHub-Token": "gh-token-xxx"},
        ) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers["content-type"]
            lines = [line async for line in response.aiter_lines() if line]

    data_lines = [l for l in lines if l.startswith("data: ")]
    assert any(l == "data: [DONE]" for l in data_lines)
    content_lines = [l for l in data_lines if l != "data: [DONE]"]
    all_content = "".join(
        json.loads(l[6:])["choices"][0]["delta"].get("content", "")
        for l in content_lines
        if "choices" in json.loads(l[6:])
    )
    assert "Hello" in all_content


@pytest.mark.asyncio
async def test_post_root_calls_openai_with_messages(app_with_mock_client):
    app, mock_client = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        async with client.stream(
            "POST", "/",
            json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-1"},
            headers={"X-GitHub-Token": "gh-token-xxx"},
        ) as response:
            [_ async for _ in response.aiter_bytes()]

    mock_client.chat.completions.stream.assert_called_once()
    call_kwargs = mock_client.chat.completions.stream.call_args[1]
    assert call_kwargs["messages"] == [{"role": "user", "content": "Hi"}]


@pytest.mark.asyncio
async def test_post_root_emits_telemetry_events(app_with_mock_client):
    app, _ = app_with_mock_client
    emitted: list[dict] = []

    async def capture_flush(events, config):
        emitted.extend(events)

    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", capture_flush):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            async with client.stream(
                "POST", "/",
                json={"messages": [{"role": "user", "content": "Hi"}], "copilot_thread_id": "t-42"},
                headers={"X-GitHub-Token": "gh-token-xxx"},
            ) as response:
                [_ async for _ in response.aiter_bytes()]

    event_types = [e["event"] for e in emitted]
    assert event_types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]
    # All events share the same session_id derived from copilot_thread_id
    session_ids = {e["session_id"] for e in emitted}
    assert len(session_ids) == 1
    # session_start platform tag
    assert emitted[0]["data"]["platform"] == "github-copilot"


@pytest.mark.asyncio
async def test_missing_github_token_returns_401(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/",
            json={"messages": [], "copilot_thread_id": "t-1"},
        )
    assert response.status_code == 401
