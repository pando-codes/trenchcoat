#!/usr/bin/env python3
"""PreToolUse hook — push to pending stack, log tool_start."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, load_config, write_event,
    sanitize_tool_input, push_pending, generate_correlation_id,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name = hook_input.get("tool_name", "unknown")
    tool_input = hook_input.get("tool_input")

    config = load_config()
    correlation_id = generate_correlation_id()

    # Push to pending stack for PostToolUse correlation
    push_pending(session_id, tool_name, correlation_id)

    write_event("tool_start", session_id, {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "input_preview": sanitize_tool_input(tool_input, config),
    })


if __name__ == "__main__":
    main()
