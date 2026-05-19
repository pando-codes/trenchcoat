#!/usr/bin/env python3
"""PreCompact hook — log context pressure event."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import read_hook_input, is_enabled, write_event


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")

    write_event("pre_compact", session_id, {})


if __name__ == "__main__":
    main()
