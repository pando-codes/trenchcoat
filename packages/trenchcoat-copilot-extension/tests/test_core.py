import json
import pytest
import respx
import httpx
from trenchcoat_copilot_extension._core import (
    TrenchcoatConfig,
    build_event,
    flush_events,
)

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"


def test_build_event_shape():
    event = build_event("session_start", "sess-abc", {"platform": "github-copilot"})
    assert event["event"] == "session_start"
    assert event["session_id"] == "sess-abc"
    assert event["data"]["platform"] == "github-copilot"
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
