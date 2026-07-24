#!/usr/bin/env python3
"""SubagentStart hook — record a subagent spawn at the moment it begins."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event, classify_agent_kind,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    cwd = hook_input.get("cwd") or None

    event_data: dict = {}
    agent_id = hook_input.get("agent_id")
    if agent_id:
        event_data["agent_id"] = agent_id
    agent_type = hook_input.get("agent_type")
    if agent_type:
        event_data["agent_type"] = agent_type
        event_data["agent_kind"] = classify_agent_kind(agent_type, cwd)

    write_event("subagent_start", session_id, event_data)


if __name__ == "__main__":
    main()
