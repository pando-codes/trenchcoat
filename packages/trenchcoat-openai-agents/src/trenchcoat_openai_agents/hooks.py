from __future__ import annotations

import uuid
from typing import Any

from agents import RunHooks

from ._core import TrenchcoatConfig, build_event, flush_events

_default_config: TrenchcoatConfig | None = None


class TrenchcoatHooks(RunHooks):
    def __init__(
        self,
        api_key: str | None = None,
        api_url: str | None = None,
        batch_size: int = 100,
    ) -> None:
        if api_key is None:
            if _default_config is None:
                raise ValueError(
                    "api_key required. Pass it directly or call instrument() first."
                )
            self._config = _default_config
        else:
            self._config = TrenchcoatConfig(
                api_key=api_key,
                api_url=api_url or "https://app.trenchcoat.io",
                batch_size=batch_size,
            )
        self._session_id: str = ""
        self._events: list[dict] = []

    async def on_agent_start(self, context: Any, agent: Any) -> None:
        try:
            self._session_id = str(uuid.uuid4())
            self._events.append(
                build_event("session_start", self._session_id, {
                    "agent_name": agent.name,
                    "platform": "openai-agents",
                })
            )
        except Exception:
            pass

    async def on_tool_start(self, context: Any, agent: Any, tool: Any) -> None:
        try:
            self._events.append(
                build_event("tool_use", self._session_id, {"tool_name": tool.name})
            )
        except Exception:
            pass

    async def on_tool_end(self, context: Any, agent: Any, tool: Any, result: str) -> None:
        try:
            self._events.append(
                build_event("tool_result", self._session_id, {
                    "tool_name": tool.name,
                    "result_size": len(result) if result else 0,
                })
            )
        except Exception:
            pass

    async def on_handoff(self, context: Any, from_agent: Any, to_agent: Any) -> None:
        try:
            self._events.append(
                build_event("subagent_stop", self._session_id, {
                    "from_agent": from_agent.name,
                    "to_agent": to_agent.name,
                })
            )
        except Exception:
            pass

    async def on_agent_end(self, context: Any, agent: Any, output: Any) -> None:
        try:
            usage_data: dict = {}
            if hasattr(context, "usage") and context.usage is not None:
                usage_data = {
                    "input_tokens": getattr(context.usage, "input_tokens", 0),
                    "output_tokens": getattr(context.usage, "output_tokens", 0),
                }
            self._events.append(
                build_event("session_end", self._session_id, {
                    "agent_name": agent.name,
                    **usage_data,
                })
            )
            events_to_flush = list(self._events)
            self._events.clear()
            await flush_events(events_to_flush, self._config)
        except Exception:
            pass


def instrument(api_key: str, api_url: str | None = None, batch_size: int = 100) -> None:
    """Set default config so TrenchcoatHooks() can be called without arguments."""
    global _default_config
    _default_config = TrenchcoatConfig(
        api_key=api_key,
        api_url=api_url or "https://app.trenchcoat.io",
        batch_size=batch_size,
    )
