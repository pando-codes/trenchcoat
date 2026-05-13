from __future__ import annotations

from typing import TYPE_CHECKING, Any

from agents import AgentHooks

from ._core import build_event

if TYPE_CHECKING:
    from .hooks import TrenchcoatHooks


class TrenchcoatAgentHooks(AgentHooks):
    """Per-agent hooks that write into a parent TrenchcoatHooks event buffer."""

    def __init__(self, parent: TrenchcoatHooks) -> None:
        self._parent = parent

    async def on_start(self, context: Any, agent: Any) -> None:
        try:
            self._parent._events.append(
                build_event("agent_start", self._parent._session_id, {
                    "agent_name": agent.name,
                })
            )
        except Exception:
            pass

    async def on_end(self, context: Any, agent: Any, output: Any) -> None:
        try:
            self._parent._events.append(
                build_event("agent_end", self._parent._session_id, {
                    "agent_name": agent.name,
                })
            )
        except Exception:
            pass

    async def on_handoff(self, context: Any, agent: Any, source: Any) -> None:
        try:
            self._parent._events.append(
                build_event("subagent_stop", self._parent._session_id, {
                    "from_agent": source.name,
                    "to_agent": agent.name,
                })
            )
        except Exception:
            pass

    async def on_tool_start(self, context: Any, agent: Any, tool: Any) -> None:
        try:
            self._parent._events.append(
                build_event("tool_use", self._parent._session_id, {
                    "tool_name": tool.name,
                })
            )
        except Exception:
            pass

    async def on_tool_end(self, context: Any, agent: Any, tool: Any, result: str) -> None:
        try:
            self._parent._events.append(
                build_event("tool_result", self._parent._session_id, {
                    "tool_name": tool.name,
                    "result_size": len(result) if result else 0,
                })
            )
        except Exception:
            pass
