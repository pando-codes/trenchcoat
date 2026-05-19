#!/usr/bin/env python3
"""UserPromptSubmit hook — log prompt metadata (not content by default)."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "lib"))

from telemetry import read_hook_input, is_enabled, load_config, write_event


def main():
    hook_input = read_hook_input()
    if not is_enabled():
        return

    session_id = hook_input.get("session_id", "unknown")
    prompt = hook_input.get("prompt", "")

    config = load_config()
    log_content = config.get("privacy", {}).get("log_prompt_content", False)

    data = {
        "prompt_length": len(prompt),
        "word_count": len(prompt.split()),
    }

    if log_content:
        data["prompt"] = prompt

    write_event("prompt", session_id, data)


if __name__ == "__main__":
    main()
