from __future__ import annotations

from typing import Any

from ._core import TrenchcoatConfig, build_event, flush_events


class EventEmitter:
    """Buffers Trenchcoat events for one conversation turn and flushes them together."""

    def __init__(self, config: TrenchcoatConfig, session_id: str) -> None:
        self._config = config
        self._session_id = session_id
        self._events: list[dict] = []

    def append(self, event_type: str, data: dict[str, Any] | None = None) -> None:
        self._events.append(build_event(event_type, self._session_id, data or {}))

    async def flush(self) -> None:
        if not self._events:
            return
        events_to_send = list(self._events)
        self._events.clear()
        try:
            await flush_events(events_to_send, self._config)
        except Exception:
            pass  # telemetry must never break the server
