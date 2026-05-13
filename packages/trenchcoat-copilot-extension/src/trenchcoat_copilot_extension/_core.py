from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx


@dataclass
class TrenchcoatConfig:
    api_key: str
    api_url: str = "https://app.trenchcoat.io"
    batch_size: int = 100


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


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
