#!/usr/bin/env python3
"""PostToolUse hook — pop pending, compute duration, log tool_end."""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event,
    sanitize_tool_result, pop_pending,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name = hook_input.get("tool_name", "unknown")
    tool_result = hook_input.get("tool_result")

    # Pop matching pending entry
    pending = pop_pending(session_id, tool_name)

    correlation_id = None
    duration_ms = None
    if pending:
        correlation_id = pending.get("correlation_id")
        started_ns = pending.get("started_at")
        if started_ns:
            duration_ms = (time.monotonic_ns() - started_ns) / 1_000_000

    result_info = sanitize_tool_result(tool_result)

    write_event("tool_end", session_id, {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "duration_ms": round(duration_ms, 1) if duration_ms is not None else None,
        "result_size": result_info.get("size"),
    })


if __name__ == "__main__":
    main()
