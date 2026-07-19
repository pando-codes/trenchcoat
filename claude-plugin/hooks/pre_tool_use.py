#!/usr/bin/env python3
"""PreToolUse hook — push to pending stack, log tool_start, detect skill/agent invocations."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, load_config, write_event,
    sanitize_tool_input, push_pending, generate_correlation_id,
    write_active_context, read_active_context,
    write_agent_spawn_context, parse_edge_label,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    tool_name  = hook_input.get("tool_name", "unknown")
    tool_input = hook_input.get("tool_input") or {}

    config         = load_config()
    correlation_id = generate_correlation_id()

    # Read context BEFORE updating it — Skill/Agent tool_start is tagged with
    # the parent spawner (not itself), matching behavior of nested invocations.
    ctx          = read_active_context(session_id)
    spawner_id   = ctx["spawner_id"]   if ctx else None
    spawner_type = ctx["spawner_type"] if ctx else None

    tool_data: dict = {
        "tool_name":     tool_name,
        "correlation_id": correlation_id,
        "input_preview": sanitize_tool_input(tool_input, config),
    }
    if spawner_id:
        tool_data["spawner_id"]   = spawner_id
        tool_data["spawner_type"] = spawner_type

    if tool_name == "Agent":
        edge_label, cleaned_prompt = parse_edge_label(tool_input.get("prompt"))
        if edge_label:
            # Rebuild the preview from input with the marker removed so it
            # neither leaks nor consumes the truncation budget.
            cleaned_input = dict(tool_input)
            cleaned_input["prompt"] = cleaned_prompt
            tool_data["input_preview"] = sanitize_tool_input(cleaned_input, config)
            tool_data["edge_label"] = edge_label

        agent_id = generate_correlation_id()
        tool_data["agent_id"] = agent_id
        push_pending(session_id, tool_name, correlation_id,
                     agent_id=agent_id, edge_label=edge_label)
        write_event("tool_start", session_id, tool_data)
        write_agent_spawn_context(
            parent_session_id=session_id,
            agent_id=agent_id,
            spawner_id=spawner_id,
            spawner_type=spawner_type,
        )

    elif tool_name == "Skill":
        activation_id = generate_correlation_id()
        skill_name    = tool_input.get("skill", "unknown")
        args          = tool_input.get("args", "")
        push_pending(session_id, tool_name, correlation_id)
        write_event("tool_start", session_id, tool_data)
        skill_data: dict = {
            "skill_name":   skill_name,
            "args_preview": str(args)[:100] if args else None,
            "activation_id": activation_id,
        }
        if spawner_id:
            skill_data["spawner_id"]   = spawner_id
            skill_data["spawner_type"] = spawner_type
        write_event("skill_use", session_id, skill_data)
        write_active_context(session_id, activation_id, "skill", skill_name)

    else:
        push_pending(session_id, tool_name, correlation_id)
        write_event("tool_start", session_id, tool_data)


if __name__ == "__main__":
    main()
