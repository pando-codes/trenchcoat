#!/usr/bin/env python3
"""SessionStart hook — record session begin + initialize session index."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import read_hook_input, is_enabled, write_event, update_session_index


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    cwd = hook_input.get("cwd", "")

    write_event("session_start", session_id, {
        "cwd": cwd,
    })

    update_session_index(session_id, {
        "started_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(timespec="milliseconds"),
        "cwd": cwd,
        "status": "active",
    })


if __name__ == "__main__":
    main()
