import pytest
import respx
import httpx
from unittest.mock import AsyncMock, patch
from trenchcoat_copilot_extension._core import TrenchcoatConfig
from trenchcoat_copilot_extension.event_emitter import EventEmitter

API_KEY = "ct_live_test"
API_URL = "https://app.trenchcoat.io"
CONFIG = TrenchcoatConfig(api_key=API_KEY, api_url=API_URL)


def test_append_adds_event_to_buffer():
    emitter = EventEmitter(CONFIG, "sess-1")
    emitter.append("session_start", {"platform": "github-copilot"})
    assert len(emitter._events) == 1
    assert emitter._events[0]["event"] == "session_start"
    assert emitter._events[0]["session_id"] == "sess-1"
    assert emitter._events[0]["data"]["platform"] == "github-copilot"


def test_append_multiple_events_preserves_order():
    emitter = EventEmitter(CONFIG, "sess-1")
    for etype in ["session_start", "prompt_submit", "assistant_stop", "session_end"]:
        emitter.append(etype, {})
    types = [e["event"] for e in emitter._events]
    assert types == ["session_start", "prompt_submit", "assistant_stop", "session_end"]


@pytest.mark.asyncio
async def test_flush_sends_events_and_clears_buffer():
    emitter = EventEmitter(CONFIG, "sess-1")
    emitter.append("session_start", {})
    emitter.append("session_end", {})

    flush_mock = AsyncMock()
    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", flush_mock):
        await emitter.flush()

    flush_mock.assert_awaited_once()
    assert emitter._events == []


@pytest.mark.asyncio
async def test_flush_empty_buffer_is_noop():
    emitter = EventEmitter(CONFIG, "sess-1")
    flush_mock = AsyncMock()
    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", flush_mock):
        await emitter.flush()
    flush_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_flush_error_is_silent():
    emitter = EventEmitter(CONFIG, "sess-1")
    emitter.append("session_start", {})
    flush_mock = AsyncMock(side_effect=Exception("network error"))
    with patch("trenchcoat_copilot_extension.event_emitter.flush_events", flush_mock):
        await emitter.flush()  # must not raise
