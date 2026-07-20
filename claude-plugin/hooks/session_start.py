#!/usr/bin/env python3
"""SessionStart hook — record session begin."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event, update_session_index,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    cwd        = hook_input.get("cwd", "")

    event_data: dict = {"cwd": cwd}

    eval_id = os.environ.get("TRENCHCOAT_EVAL_ID")
    if eval_id:
        event_data["eval_id"] = eval_id[:128]

    eval_variant = os.environ.get("TRENCHCOAT_EVAL_VARIANT")
    if eval_variant:
        event_data["eval_variant"] = eval_variant[:128]

    write_event("session_start", session_id, event_data)

    update_session_index(session_id, {
        "started_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc
        ).isoformat(timespec="milliseconds"),
        "cwd": cwd,
        "status": "active",
    })


if __name__ == "__main__":
    main()
