#!/usr/bin/env python3
"""PostToolUse hook — pop pending, compute duration, log tool_end."""

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event,
    sanitize_tool_result, pop_pending, read_active_context,
    clear_agent_spawn_context,
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

    pending = pop_pending(session_id, tool_name)

    correlation_id = None
    duration_ms    = None
    if pending:
        correlation_id = pending.get("correlation_id")
        started_ns     = pending.get("started_at")
        if started_ns:
            duration_ms = (time.monotonic_ns() - started_ns) / 1_000_000

    result_info = sanitize_tool_result(tool_response)

    event_data: dict = {
        "tool_name":     tool_name,
        "correlation_id": correlation_id,
        "duration_ms":   round(duration_ms, 1) if duration_ms is not None else None,
        "result_size":   result_info.get("size"),
        "is_error":      result_info.get("is_error"),
        "error_preview": result_info.get("error_preview"),
    }

    ctx = read_active_context(session_id)
    if ctx:
        event_data["spawner_id"]   = ctx["spawner_id"]
        event_data["spawner_type"] = ctx["spawner_type"]

    write_event("tool_end", session_id, event_data)

    if tool_name == "Agent":
        # Guard: clear spawn context in case the child process crashed before reading it.
        clear_agent_spawn_context()


if __name__ == "__main__":
    main()
