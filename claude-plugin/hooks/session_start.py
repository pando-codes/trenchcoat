#!/usr/bin/env python3
"""SessionStart hook — record session begin, read agent spawn context if present."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event, update_session_index,
    read_agent_spawn_context, clear_agent_spawn_context,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    cwd        = hook_input.get("cwd", "")

    spawn_ctx = read_agent_spawn_context()
    clear_agent_spawn_context()

    event_data: dict = {"cwd": cwd}
    if spawn_ctx:
        event_data["parent_session_id"] = spawn_ctx["parent_session_id"]
        if spawn_ctx.get("agent_id"):
            event_data["agent_id"] = spawn_ctx["agent_id"]
        if spawn_ctx.get("spawner_id"):
            event_data["spawner_id"]   = spawn_ctx["spawner_id"]
            event_data["spawner_type"] = spawn_ctx["spawner_type"]

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
