#!/usr/bin/env python3
"""Stop hook — log stop reason with session-level token totals."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import read_hook_input, is_enabled, write_event, parse_agent_transcript


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    reason = hook_input.get("stop_hook_reason", "unknown")
    transcript_path = hook_input.get("transcript_path")

    transcript = {}
    if transcript_path:
        transcript = parse_agent_transcript(transcript_path)

    write_event("stop", session_id, {
        "reason": reason,
        "input_tokens": transcript.get("input_tokens", 0),
        "output_tokens": transcript.get("output_tokens", 0),
        "cache_creation_tokens": transcript.get("cache_creation_tokens"),
        "cache_read_tokens": transcript.get("cache_read_tokens"),
        "model": transcript.get("model"),
    })


if __name__ == "__main__":
    main()
