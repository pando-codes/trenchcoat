#!/usr/bin/env python3
"""SessionEnd hook — record session end, compute duration, run retention cleanup."""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import (
    read_hook_input, is_enabled, write_event, update_session_index,
    load_config, cleanup_old_events, flush_push_queue, SESSIONS_PATH, PENDING_DIR,
)


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")

    # Compute duration from session index
    duration_ms = None
    try:
        if SESSIONS_PATH.exists():
            sessions = json.loads(SESSIONS_PATH.read_text())
            session = sessions.get(session_id, {})
            started_at = session.get("started_at")
            if started_at:
                start = datetime.fromisoformat(started_at)
                now = datetime.now(timezone.utc)
                duration_ms = int((now - start).total_seconds() * 1000)
    except (json.JSONDecodeError, OSError, ValueError):
        pass

    write_event("session_end", session_id, {
        "duration_ms": duration_ms,
    })

    update_session_index(session_id, {
        "ended_at": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
        "duration_ms": duration_ms,
        "status": "ended",
    })

    # Cleanup pending file for this session
    pending_file = PENDING_DIR / f"{session_id}.json"
    if pending_file.exists():
        try:
            pending_file.unlink()
        except OSError:
            pass

    # Flush queued events to SaaS (non-blocking via fork)
    config = load_config()
    if config.get("api_key"):
        try:
            pid = os.fork()
            if pid == 0:
                try:
                    flush_push_queue()
                except Exception:
                    pass
                os._exit(0)
        except OSError:
            pass

    # Retention cleanup
    retention_days = config.get("retention_days", 30)
    cleanup_old_events(retention_days)


if __name__ == "__main__":
    main()
