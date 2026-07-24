#!/usr/bin/env python3
"""SubagentStop hook — log agent completion with tool attribution from transcript."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event, parse_agent_transcript,
    classify_agent_kind,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id       = hook_input.get("session_id", "unknown")
    agent_type       = hook_input.get("agent_type") or "general-purpose"
    agent_id         = hook_input.get("agent_id")
    stop_hook_active = bool(hook_input.get("stop_hook_active", False))
    transcript_path  = hook_input.get("agent_transcript_path")
    cwd              = hook_input.get("cwd") or None

    tool_summary = {}
    if transcript_path:
        tool_summary = parse_agent_transcript(transcript_path)

    event_data: dict = {
        "agent_type":       agent_type,
        "agent_kind":       classify_agent_kind(agent_type, cwd),
        "stop_hook_active": stop_hook_active,
        "tool_counts":      tool_summary.get("tool_counts", {}),
        "tool_count_total": tool_summary.get("total_tools", 0),
        "turns":            tool_summary.get("turns", 0),
        "input_tokens":     tool_summary.get("input_tokens", 0),
        "output_tokens":    tool_summary.get("output_tokens", 0),
        "model":            tool_summary.get("model"),
    }
    if agent_id:
        event_data["agent_id"] = agent_id

    write_event("subagent_stop", session_id, event_data)


if __name__ == "__main__":
    main()
