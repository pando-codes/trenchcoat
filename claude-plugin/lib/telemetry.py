"""
Core telemetry engine — event writing, config, sanitization, correlation.

Design goals:
- <3ms per hook invocation
- Append-only JSONL with flock for safe concurrent writes
- Day-partitioned files for easy retention
- Privacy-first: no prompt content, truncated tool inputs, size-only results
"""

import fcntl
import json
import os
import sys
import time
import uuid
from collections import Counter
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Paths — all plugin data lives under ~/.claude/trenchcoat/ (our own namespace).
# Do NOT use ~/.claude/telemetry/; that name risks conflating with Claude Code's
# own OpenTelemetry feature (CLAUDE_CODE_ENABLE_TELEMETRY / OTEL_* env vars).
TRENCHCOAT_DIR = Path.home() / ".claude" / "trenchcoat"
CONFIG_PATH = TRENCHCOAT_DIR / "config.json"
SESSIONS_PATH = TRENCHCOAT_DIR / "sessions.json"
PENDING_DIR = TRENCHCOAT_DIR / ".pending"
PUSH_QUEUE_PATH = TRENCHCOAT_DIR / ".push_queue.jsonl"

# Non-credential config only. Credentials live in ~/.claude/settings.json env block:
#   TRENCHCOAT_API_KEY  — ct_live_... key
#   TRENCHCOAT_API_URL  — SaaS endpoint (default: https://app.trenchcoat.io)
DEFAULT_CONFIG = {
    "enabled": True,
    "privacy": {
        "log_prompt_content": False,
        "tool_input_preview_chars": 100,
        "log_tool_results": False,  # only log result size
    },
    "retention_days": 30,
    "push_batch_size": 100,  # events per batch POST
}
_DEFAULT_API_URL = "https://app.trenchcoat.io"


def _get_credentials() -> tuple[str | None, str]:
    """Return (api_key, api_url) from environment variables."""
    api_key = os.environ.get("TRENCHCOAT_API_KEY")
    api_url = os.environ.get("TRENCHCOAT_API_URL", _DEFAULT_API_URL)
    return api_key, api_url

# Map local event types to SaaS-expected types
_EVENT_TYPE_MAP = {
    "tool_start": "tool_use",
    "tool_end": "tool_result",
    "prompt": "prompt_submit",
    "stop": "assistant_stop",
    "skill_use": "skill_use",
}

# Module-level sequence counter (per-process)
_seq_counter = 0


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def _today_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def load_config() -> dict:
    """Load config, creating defaults if missing."""
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)
    if CONFIG_PATH.exists():
        try:
            return json.loads(CONFIG_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    # Write defaults
    CONFIG_PATH.write_text(json.dumps(DEFAULT_CONFIG, indent=2) + "\n")
    return dict(DEFAULT_CONFIG)


def is_enabled() -> bool:
    return load_config().get("enabled", True)


def _get_seq() -> int:
    global _seq_counter
    _seq_counter += 1
    return _seq_counter


def sanitize_tool_input(tool_input, config: dict) -> str | None:
    """Return a truncated preview of tool input."""
    max_chars = config.get("privacy", {}).get("tool_input_preview_chars", 100)
    if tool_input is None:
        return None
    if isinstance(tool_input, dict):
        text = json.dumps(tool_input, default=str)
    else:
        text = str(tool_input)
    if len(text) > max_chars:
        return text[:max_chars] + "..."
    return text


def sanitize_tool_result(tool_response) -> dict:
    """Return size + error info about a tool response.

    Never surfaces the full content. The only place we expose actual content is
    ``error_preview`` — a short (≤200 char) excerpt that is only populated when
    we can affirmatively detect an error (``is_error is True``). Error messages
    are short, high-signal, and the user opts into telemetry by enabling the
    plugin, so we surface them without a separate config flag.

    Detection:
    - ``None`` → unknown; ``is_error`` and ``error_preview`` are both ``None``.
    - ``dict`` with ``"is_error"`` key → trust that boolean. When True, pull
      ``error_preview`` from ``content`` / ``error`` / ``message`` (first
      string match wins), truncated to 200 chars.
    - ``dict`` without ``"is_error"`` → unknown; no preview.
    - ``str`` or any other type → unknown; size only.
    """
    if tool_response is None:
        return {"size": 0, "is_error": None, "error_preview": None}

    if isinstance(tool_response, str):
        return {"size": len(tool_response), "is_error": None, "error_preview": None}

    if isinstance(tool_response, dict):
        text = json.dumps(tool_response, default=str)
        is_error = tool_response.get("is_error") if "is_error" in tool_response else None
        error_preview = None
        if is_error is True:
            for key in ("content", "error", "message"):
                candidate = tool_response.get(key)
                if isinstance(candidate, str) and candidate:
                    error_preview = candidate[:200]
                    break
        return {"size": len(text), "is_error": is_error, "error_preview": error_preview}

    # Fallback for unknown types (list, etc.) — size only.
    text = json.dumps(tool_response, default=str)
    return {"size": len(text), "is_error": None, "error_preview": None}


def write_event(event_type: str, session_id: str, data: dict) -> None:
    """Append a single event to today's JSONL file with flock."""
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)

    event = {
        "ts": _now_iso(),
        "event": event_type,
        "session_id": session_id,
        "seq": _get_seq(),
        "data": data,
    }

    line = json.dumps(event, default=str) + "\n"
    event_file = TRENCHCOAT_DIR / f"events-{_today_str()}.jsonl"

    fd = os.open(str(event_file), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        os.write(fd, line.encode())
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

    # Queue for SaaS push if credentials are configured
    api_key, _ = _get_credentials()
    if api_key:
        _queue_for_push(event)

    # Fire webhook if configured (legacy per-event webhook)
    webhook_url = load_config().get("webhook_url")
    if webhook_url:
        _fire_webhook(webhook_url, event)


def _queue_for_push(event: dict) -> None:
    """Append event to the push queue for batch flush on session_end."""
    saas_event = {
        "ts": event["ts"],
        "event": _EVENT_TYPE_MAP.get(event["event"], event["event"]),
        "session_id": event["session_id"],
        "seq": event["seq"],
        "data": event.get("data", {}),
    }
    line = json.dumps(saas_event, default=str) + "\n"

    fd = os.open(str(PUSH_QUEUE_PATH), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        os.write(fd, line.encode())
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def flush_push_queue() -> dict:
    """Flush queued events to the SaaS API in batches. Returns stats."""
    api_key, api_url = _get_credentials()

    if not api_key:
        return {"status": "skipped", "reason": "TRENCHCOAT_API_KEY not set in environment"}

    if not PUSH_QUEUE_PATH.exists():
        return {"status": "ok", "pushed": 0}

    # Read all queued events
    events = []
    try:
        with open(PUSH_QUEUE_PATH, "r") as f:
            for line in f:
                line = line.strip()
                if line:
                    events.append(json.loads(line))
    except (json.JSONDecodeError, OSError):
        return {"status": "error", "reason": "failed to read push queue"}

    if not events:
        _clear_push_queue()
        return {"status": "ok", "pushed": 0}

    batch_size = load_config().get("push_batch_size", 100)
    total_pushed = 0
    errors = []

    for i in range(0, len(events), batch_size):
        batch = events[i:i + batch_size]
        try:
            _post_batch(api_url, api_key, batch)
            total_pushed += len(batch)
        except Exception as e:
            errors.append(f"batch {i // batch_size}: {e}")

    if total_pushed == len(events):
        _clear_push_queue()
    elif total_pushed > 0:
        # Partial success — keep only unsent events
        remaining = events[total_pushed:]
        _rewrite_push_queue(remaining)

    result = {"status": "ok", "pushed": total_pushed, "total": len(events)}
    if errors:
        result["errors"] = errors
        result["status"] = "partial" if total_pushed > 0 else "error"
    return result


def _post_batch(api_url: str, api_key: str, events: list) -> None:
    """POST a batch of events to the SaaS ingestion endpoint."""
    import urllib.request

    url = f"{api_url.rstrip('/')}/api/v1/events"
    payload = json.dumps({"events": events}).encode()

    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-API-Key": api_key,
        },
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=30)
    if resp.status not in (200, 201):
        raise RuntimeError(f"API returned {resp.status}")


def _clear_push_queue() -> None:
    """Remove the push queue file."""
    try:
        PUSH_QUEUE_PATH.unlink(missing_ok=True)
    except OSError:
        pass


def _rewrite_push_queue(events: list) -> None:
    """Rewrite the push queue with only the given events."""
    try:
        with open(PUSH_QUEUE_PATH, "w") as f:
            for event in events:
                f.write(json.dumps(event, default=str) + "\n")
    except OSError:
        pass


def _fire_webhook(url: str, event: dict) -> None:
    """Fire-and-forget POST via fork. Hot path stays local."""
    try:
        pid = os.fork()
        if pid == 0:
            # Child process
            try:
                import urllib.request
                req = urllib.request.Request(
                    url,
                    data=json.dumps(event).encode(),
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=5)
            except Exception:
                pass
            os._exit(0)
    except OSError:
        pass  # Fork failed — skip webhook silently


# --- Session index ---

def update_session_index(session_id: str, data: dict) -> None:
    """Update the lightweight session index."""
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)

    sessions = {}
    if SESSIONS_PATH.exists():
        try:
            sessions = json.loads(SESSIONS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            sessions = {}

    if session_id in sessions:
        sessions[session_id].update(data)
    else:
        sessions[session_id] = data

    SESSIONS_PATH.write_text(json.dumps(sessions, indent=2, default=str) + "\n")


# --- Pre/Post correlation ---

def push_pending(session_id: str, tool_name: str, correlation_id: str, agent_id: str | None = None) -> None:
    """Push a tool_start to the pending stack for later correlation."""
    PENDING_DIR.mkdir(parents=True, exist_ok=True)
    pending_file = PENDING_DIR / f"{session_id}.json"

    stack = []
    if pending_file.exists():
        try:
            stack = json.loads(pending_file.read_text())
        except (json.JSONDecodeError, OSError):
            stack = []

    entry: dict = {
        "tool_name": tool_name,
        "correlation_id": correlation_id,
        "started_at": time.monotonic_ns(),
        "started_ts": _now_iso(),
    }
    if agent_id:
        entry["agent_id"] = agent_id

    stack.append(entry)
    pending_file.write_text(json.dumps(stack) + "\n")


def pop_pending(session_id: str, tool_name: str) -> dict | None:
    """Pop the most recent matching tool_start (LIFO). Returns None if not found."""
    pending_file = PENDING_DIR / f"{session_id}.json"

    if not pending_file.exists():
        return None

    try:
        stack = json.loads(pending_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None

    # Find the last entry matching this tool_name (LIFO)
    for i in range(len(stack) - 1, -1, -1):
        if stack[i].get("tool_name") == tool_name:
            entry = stack.pop(i)
            pending_file.write_text(json.dumps(stack) + "\n")
            return entry

    return None


def peek_pending_by_tool(session_id: str, tool_name: str) -> dict | None:
    """Return the most recent pending entry matching tool_name without popping it."""
    pending_file = PENDING_DIR / f"{session_id}.json"
    if not pending_file.exists():
        return None
    try:
        stack = json.loads(pending_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None
    for entry in reversed(stack):
        if entry.get("tool_name") == tool_name:
            return entry
    return None


def generate_correlation_id() -> str:
    return uuid.uuid4().hex[:12]


# --- Active spawner context ---

def write_active_context(session_id: str, spawner_id: str, spawner_type: str, spawner_name: str) -> None:
    """Write the current spawner context for a session."""
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)
    ctx_file = TRENCHCOAT_DIR / f".active_context_{session_id}.json"
    ctx_file.write_text(json.dumps({
        "spawner_id": spawner_id,
        "spawner_type": spawner_type,
        "spawner_name": spawner_name,
        "activated_at": _now_iso(),
    }))


def read_active_context(session_id: str) -> dict | None:
    """Return the active spawner context for a session, or None if not set."""
    ctx_file = TRENCHCOAT_DIR / f".active_context_{session_id}.json"
    if not ctx_file.exists():
        return None
    try:
        return json.loads(ctx_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def clear_active_context(session_id: str) -> None:
    """Remove the active spawner context for a session."""
    ctx_file = TRENCHCOAT_DIR / f".active_context_{session_id}.json"
    try:
        ctx_file.unlink(missing_ok=True)
    except OSError:
        pass


# --- Agent spawn context (cross-process, not session-scoped) ---

def write_agent_spawn_context(
    parent_session_id: str,
    agent_id: str,
    spawner_id: str | None,
    spawner_type: str | None,
) -> None:
    """Write spawn context for the child process to read at session_start.

    Not session-scoped: the child process has a different session_id and reads
    this file by path. Safe because Claude Code spawns one subagent at a time.
    """
    TRENCHCOAT_DIR.mkdir(parents=True, exist_ok=True)
    ctx: dict = {
        "parent_session_id": parent_session_id,
        "agent_id": agent_id,
    }
    if spawner_id:
        ctx["spawner_id"] = spawner_id
        ctx["spawner_type"] = spawner_type
    (TRENCHCOAT_DIR / ".agent_spawn_context.json").write_text(json.dumps(ctx))


def read_agent_spawn_context() -> dict | None:
    """Return the agent spawn context, or None if not present."""
    ctx_file = TRENCHCOAT_DIR / ".agent_spawn_context.json"
    if not ctx_file.exists():
        return None
    try:
        return json.loads(ctx_file.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def clear_agent_spawn_context() -> None:
    """Remove the agent spawn context file."""
    ctx_file = TRENCHCOAT_DIR / ".agent_spawn_context.json"
    try:
        ctx_file.unlink(missing_ok=True)
    except OSError:
        pass


# --- Retention cleanup ---

def cleanup_old_events(retention_days: int = 30) -> int:
    """Delete JSONL files older than retention_days. Returns count deleted."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    deleted = 0

    for f in TRENCHCOAT_DIR.glob("events-*.jsonl"):
        # Extract date from filename: events-YYYY-MM-DD.jsonl
        date_part = f.stem.replace("events-", "")
        if date_part < cutoff_str:
            f.unlink()
            deleted += 1

    # Clean up stale pending files
    for f in PENDING_DIR.glob("*.json"):
        try:
            age = time.time() - f.stat().st_mtime
            if age > 86400:  # 24 hours
                f.unlink()
        except OSError:
            pass

    return deleted


# --- Agent transcript parsing ---

def parse_agent_transcript(transcript_path: str) -> dict:
    """Parse transcript JSONL for tool usage, token counts, and model."""
    path = Path(transcript_path)
    if not path.exists():
        return {}

    tool_counts = Counter()
    turns = 0
    input_tokens = 0
    output_tokens = 0
    model = None

    try:
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue

            if entry.get("type") != "assistant":
                continue

            turns += 1
            msg = entry.get("message", {})

            if msg.get("model"):
                model = msg["model"]

            usage = msg.get("usage", {})
            input_tokens += int(usage.get("input_tokens") or 0)
            output_tokens += int(usage.get("output_tokens") or 0)

            for block in msg.get("content", []):
                if isinstance(block, dict) and block.get("type") == "tool_use":
                    tool_counts[block.get("name", "unknown")] += 1
    except OSError:
        return {}

    return {
        "tool_counts": dict(tool_counts.most_common()),
        "total_tools": sum(tool_counts.values()),
        "turns": turns,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "model": model,
    }


# --- Hook input helper ---

def read_hook_input() -> dict:
    """Read JSON from stdin (standard hook input protocol)."""
    try:
        return json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        return {}
