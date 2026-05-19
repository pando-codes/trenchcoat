import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from trenchcoat_copilot_extension._core import TrenchcoatConfig
from trenchcoat_copilot_extension.bot_router import make_bot_router

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)

ACTIVITY = {
    "type": "message",
    "id": "act-1",
    "text": "What is 2+2?",
    "from": {"id": "user-1", "name": "Alice"},
    "conversation": {"id": "conv-abc"},
    "serviceUrl": "https://smba.trafficmanager.net/apis/",
}


def _make_mock_openai_client(reply: str = "4") -> MagicMock:
    mock_client = MagicMock()
    response = MagicMock()
    response.choices[0].message.content = reply
    response.usage.prompt_tokens = 8
    response.usage.completion_tokens = 3
    mock_client.chat.completions.create = AsyncMock(return_value=response)
    return mock_client


@pytest.fixture()
def app_with_mock_client():
    mock_client = _make_mock_openai_client()
    router = make_bot_router(CONFIG, _make_client=lambda: mock_client)
    app = FastAPI()
    app.include_router(router)
    return app, mock_client


@pytest.mark.asyncio
async def test_message_activity_returns_reply(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/bot",
            json=ACTIVITY,
            headers={"Authorization": "Bearer test-token"},
        )
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "message"
    assert body["text"] == "4"


@pytest.mark.asyncio
async def test_non_message_activity_returns_200(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post(
            "/bot",
            json={"type": "conversationUpdate"},
            headers={"Authorization": "Bearer test-token"},
        )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_missing_auth_returns_401(app_with_mock_client):
    app, _ = app_with_mock_client
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/bot", json=ACTIVITY)
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_message_activity_emits_telemetry_events(app_with_mock_client):
    app, _ = app_with_mock_client
    emitted: list[dict] = []

    async def capture_flush(events, config):
        emitted.extend(events)

    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", capture_flush):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            await client.post(
                "/bot",
                json=ACTIVITY,
                headers={"Authorization": "Bearer test-token"},
            )

    event_types = [e["event"] for e in emitted]
    assert event_types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]
    assert emitted[0]["data"]["platform"] == "m365-copilot"
    # Session ID derived from conversation ID
    assert all(e["session_id"] == "conv-abc" for e in emitted)
