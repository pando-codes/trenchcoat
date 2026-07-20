#!/usr/bin/env python3
"""PostToolUse hook — pop pending, compute duration, log tool_end."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event,
    sanitize_tool_result, sanitize_agent_result, pop_pending, read_active_context,
    base_agent_fields,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name  = hook_input.get("tool_name", "unknown")
    # Claude Code's PostToolUse hook input uses the key "tool_response"
    # (not "tool_result"). Previously we read the wrong key, so every event
    # recorded result_size: 0 and could never detect errors.
    tool_response = hook_input.get("tool_response")
    tool_use_id     = hook_input.get("tool_use_id")
    native_duration = hook_input.get("duration_ms")

    pending = pop_pending(session_id, tool_name, tool_use_id=tool_use_id)

    correlation_id = None
    duration_ms    = None
    duration_source = None
    agent_id       = None
    edge_label     = None

    if pending:
        correlation_id = pending.get("correlation_id")
        started_ns     = pending.get("started_at")
        agent_id       = pending.get("agent_id")
        edge_label     = pending.get("edge_label")

    if native_duration is not None:
        try:
            duration_ms = float(native_duration)
            duration_source = "native"
        except (TypeError, ValueError):
            # This key's runtime type has never been observed to be
            # non-numeric, but if it ever is, fall back rather than losing
            # the whole tool_end event.
            duration_ms = None
            duration_source = None

    if duration_ms is None and pending and pending.get("started_at"):
        duration_ms = (time.monotonic_ns() - pending["started_at"]) / 1_000_000
        duration_source = "computed"

    result_info = sanitize_tool_result(tool_response)

    event_data: dict = {
        "tool_name":     tool_name,
        "correlation_id": correlation_id,
        "duration_ms":   round(duration_ms, 1) if duration_ms is not None else None,
        "duration_source": duration_source,
        "result_size":   result_info.get("size"),
        "is_error":      result_info.get("is_error"),
        "error_preview": result_info.get("error_preview"),
    }

    if tool_name == "Agent":
        # The Agent tool's error `content` is the agent's own output text.
        # Capturing it would violate log_prompt_content: False, so keep only
        # the error flag and size; structured metrics come from agent_result.
        event_data["error_preview"] = None

    if tool_use_id:
        event_data["tool_use_id"] = tool_use_id

    if agent_id:
        event_data["agent_id"] = agent_id

    if edge_label:
        event_data["edge_label"] = edge_label

    ctx = read_active_context(session_id)
    if ctx:
        event_data["spawner_id"]   = ctx["spawner_id"]
        event_data["spawner_type"] = ctx["spawner_type"]

    event_data.update(base_agent_fields(hook_input))

    if tool_name == "Agent":
        agent_result = sanitize_agent_result(tool_response)
        if agent_result:
            event_data["agent_result"] = agent_result
            # Prefer Claude Code's native agentId so this matches the agent_id
            # that SubagentStop reports; the minted id is only a local fallback.
            native_agent_id = agent_result.get("agentId")
            if native_agent_id:
                event_data["agent_id"] = native_agent_id

    write_event("tool_end", session_id, event_data)


if __name__ == "__main__":
    main()
