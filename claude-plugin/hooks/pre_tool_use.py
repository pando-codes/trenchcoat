#!/usr/bin/env python3
"""PreToolUse hook — push to pending stack, log tool_start, detect skill invocations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, load_config, write_event,
    sanitize_tool_input, push_pending, generate_correlation_id,
    write_skill_context, read_skill_context,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name = hook_input.get("tool_name", "unknown")
    tool_input = hook_input.get("tool_input") or {}

    config = load_config()
    correlation_id = generate_correlation_id()

    # Read context BEFORE updating it — so the Skill tool's own tool_start
    # gets tagged with the parent skill (if nested), not itself.
    ctx = read_skill_context(session_id)
    active_skill_id = ctx["activation_id"] if ctx else None

    # Push to pending stack for PostToolUse correlation
    push_pending(session_id, tool_name, correlation_id)

    # Build base tool_start data
    tool_data: dict = {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "input_preview": sanitize_tool_input(tool_input, config),
    }
    if active_skill_id:
        tool_data["active_skill_id"] = active_skill_id

    write_event("tool_start", session_id, tool_data)

    # Detect Skill invocations — emit skill_use and update context
    if tool_name == "Skill":
        skill_name = tool_input.get("skill", "unknown")
        args = tool_input.get("args", "")
        activation_id = generate_correlation_id()

        write_event("skill_use", session_id, {
            "skill_name": skill_name,
            "args_preview": str(args)[:100] if args else None,
            "activation_id": activation_id,
        })

        write_skill_context(session_id, activation_id, skill_name)


if __name__ == "__main__":
    main()
