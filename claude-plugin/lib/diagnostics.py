"""
Diagnostics and verification for the trenchcoat plugin.

Provides run_verify() (quick check) and run_doctor() (full diagnostic).
"""

import json
import os
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
from pathlib import Path

TRENCHCOAT_DIR = Path.home() / ".claude" / "trenchcoat"
CONFIG_PATH = TRENCHCOAT_DIR / "config.json"
SESSIONS_PATH = TRENCHCOAT_DIR / "sessions.json"
PUSH_QUEUE_PATH = TRENCHCOAT_DIR / ".push_queue.jsonl"
PENDING_DIR = TRENCHCOAT_DIR / ".pending"
CLAUDE_SETTINGS_PATH = Path.home() / ".claude" / "settings.json"
_DEFAULT_API_URL = "https://app.trenchcoat.io"

_ICONS = {"ok": "✓", "warn": "!", "fail": "✗", "info": "i"}


class Check:
    def __init__(self, label: str, status: str, detail: str = "", fix: str = ""):
        self.label = label
        self.status = status  # ok | warn | fail | info
        self.detail = detail
        self.fix = fix

    def __str__(self) -> str:
        icon = _ICONS.get(self.status, "?")
        line = f"  [{icon}] {self.label}"
        if self.detail:
            line += f" — {self.detail}"
        return line


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------

def _check_python() -> Check:
    v = sys.version_info
    ver = f"{v.major}.{v.minor}.{v.micro}"
    if v >= (3, 8):
        return Check("Python", "ok", ver)
    return Check("Python", "fail", f"{ver} — requires 3.8+", "Upgrade Python to 3.8 or later")


def _check_plugin_root() -> Check:
    root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    if root and Path(root).exists():
        return Check("Plugin root", "ok", root)
    if root:
        return Check("Plugin root", "warn", f"CLAUDE_PLUGIN_ROOT set but path not found: {root}")
    return Check("Plugin root", "info", "CLAUDE_PLUGIN_ROOT not set (normal outside hook context)")


def _check_config() -> tuple[Check, dict]:
    if not TRENCHCOAT_DIR.exists():
        return (
            Check("Data directory", "warn",
                  f"{TRENCHCOAT_DIR} not found — no sessions recorded yet",
                  "Start a Claude Code session; the directory is created automatically"),
            {},
        )
    if not CONFIG_PATH.exists():
        return Check("Config file", "info", "Not present — defaults will be used"), {}
    try:
        config = json.loads(CONFIG_PATH.read_text())
        return Check("Config file", "ok", str(CONFIG_PATH)), config
    except json.JSONDecodeError as exc:
        return (
            Check("Config file", "fail",
                  f"Invalid JSON: {exc}",
                  f"Delete {CONFIG_PATH} and it will be recreated with defaults"),
            {},
        )


def _check_enabled(config: dict) -> Check:
    if config.get("enabled", True):
        return Check("Telemetry enabled", "ok")
    return Check(
        "Telemetry enabled", "fail",
        "Plugin is disabled",
        f'Set "enabled": true in {CONFIG_PATH}',
    )


def _check_api_key() -> tuple[Check, str]:
    key = os.environ.get("TRENCHCOAT_API_KEY", "")
    if not key:
        return (
            Check("API key", "info",
                  "Not set — running in local-only mode (events are not pushed to the SaaS)"),
            "",
        )
    if not key.startswith("ct_live_"):
        return (
            Check("API key", "warn",
                  f"Unexpected format (expected ct_live_..., got {key[:12]}...)"),
            key,
        )
    return Check("API key", "ok", f"{key[:16]}..."), key


def _check_api_url() -> tuple[Check, str]:
    url = os.environ.get("TRENCHCOAT_API_URL", _DEFAULT_API_URL)
    label = "(default)" if url == _DEFAULT_API_URL else "(custom)"
    return Check("API URL", "ok", f"{url} {label}"), url


def _check_connectivity(api_url: str, api_key: str) -> list[Check]:
    checks: list[Check] = []

    # Reachability — probe /api/v1/events without a body; expect 4xx, not a network error
    try:
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/v1/events",
            method="GET",
            headers={"X-API-Key": api_key or "probe"},
        )
        urllib.request.urlopen(req, timeout=8)
        checks.append(Check("API reachable", "ok", api_url))
    except urllib.error.HTTPError as exc:
        # Any HTTP response means the server is reachable
        checks.append(Check("API reachable", "ok", f"{api_url} (HTTP {exc.code})"))
    except Exception as exc:
        checks.append(Check(
            "API reachable", "fail",
            f"Cannot reach {api_url}: {exc}",
            "Check your network or run /trenchcoat-connect to update the URL",
        ))
        return checks

    if not api_key:
        checks.append(Check("API key validation", "info", "Skipped — no API key configured"))
        return checks

    # Validate key by posting a minimal test event
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    payload = json.dumps({"events": [{
        "ts": now,
        "event": "session_start",
        "session_id": "trenchcoat-verify",
        "seq": 0,
        "data": {"cwd": "verify"},
    }]}).encode()

    try:
        req = urllib.request.Request(
            f"{api_url.rstrip('/')}/api/v1/events",
            data=payload,
            headers={"Content-Type": "application/json", "X-API-Key": api_key},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10)
        checks.append(Check("API key valid", "ok", f"Accepted — HTTP {resp.status}"))
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            checks.append(Check(
                "API key valid", "fail",
                "Invalid API key (401 Unauthorized)",
                "Generate a new key at app.trenchcoat.io → Settings → API Keys, then run /trenchcoat-connect",
            ))
        elif exc.code == 403:
            checks.append(Check(
                "API key valid", "fail",
                "API key lacks write:events scope (403 Forbidden)",
                "Regenerate the key with the write:events scope enabled",
            ))
        else:
            checks.append(Check("API key valid", "warn", f"HTTP {exc.code}"))
    except Exception as exc:
        checks.append(Check("API key valid", "fail", f"Request error: {exc}"))

    return checks


def _check_local_data() -> list[Check]:
    checks: list[Check] = []

    if not TRENCHCOAT_DIR.exists():
        return [Check("Local data", "info", "Data directory not yet created")]

    jsonl_files = sorted(TRENCHCOAT_DIR.glob("events-*.jsonl"))
    if not jsonl_files:
        checks.append(Check(
            "Event files", "warn",
            "No event files found",
            "Start a new Claude Code session to begin recording",
        ))
    else:
        checks.append(Check("Event files", "ok", f"{len(jsonl_files)} file(s)"))

        cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).strftime("%Y-%m-%d")
        recent = [f for f in jsonl_files if f.stem.replace("events-", "") >= cutoff]
        if recent:
            latest = sorted(recent)[-1]
            try:
                count = sum(1 for ln in latest.read_text().splitlines() if ln.strip())
                checks.append(Check("Recent data", "ok", f"{count} events in {latest.name}"))
            except OSError:
                checks.append(Check("Recent data", "ok", f"Found {latest.name}"))
        else:
            checks.append(Check(
                "Recent data", "warn",
                "No events in the last 7 days",
                "Verify hooks are installed and the plugin is enabled",
            ))

    # Push queue
    if PUSH_QUEUE_PATH.exists():
        try:
            lines = [ln for ln in PUSH_QUEUE_PATH.read_text().splitlines() if ln.strip()]
            count = len(lines)
            if count > 0:
                age_s = datetime.now().timestamp() - PUSH_QUEUE_PATH.stat().st_mtime
                if age_s > 3600:
                    checks.append(Check(
                        "Push queue", "warn",
                        f"{count} events pending for >{int(age_s / 3600)}h (flush may have failed)",
                        "Check your API key with /trenchcoat-verify; events will retry on next session end",
                    ))
                else:
                    checks.append(Check(
                        "Push queue", "ok",
                        f"{count} events queued (will flush on next session end)",
                    ))
        except OSError:
            pass

    return checks


def _check_hooks() -> list[Check]:
    checks: list[Check] = []

    if not CLAUDE_SETTINGS_PATH.exists():
        checks.append(Check(
            "~/.claude/settings.json", "info",
            "File not found — hooks may be installed via the plugin system",
        ))
        return checks

    try:
        settings = json.loads(CLAUDE_SETTINGS_PATH.read_text())
    except json.JSONDecodeError:
        checks.append(Check("~/.claude/settings.json", "fail", "Invalid JSON"))
        return checks

    hooks_cfg = settings.get("hooks", {})
    # Hook types the trenchcoat plugin installs
    expected = [
        ("SessionStart", "session_start"),
        ("SessionEnd", "session_end"),
        ("PreToolUse", "pre_tool_use"),
        ("PostToolUse", "post_tool_use"),
        ("Stop", "stop"),
        ("SubagentStop", "subagent_stop"),
        ("UserPromptSubmit", "user_prompt_submit"),
    ]

    found_any = False
    for hook_type, script_name in expected:
        entries = hooks_cfg.get(hook_type, [])
        present = any(script_name in json.dumps(e) for e in entries)
        if present:
            found_any = True
            checks.append(Check(f"Hook {hook_type}", "ok"))

    if not found_any:
        # Plugin-based installs don't write to settings.json — that's normal
        checks.append(Check(
            "Hooks in settings.json", "info",
            "None found (expected for plugin-based installs — hooks are managed by the plugin system)",
        ))

    return checks


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def run_verify() -> int:
    """Quick pass/fail verification. Returns 0 if ok, 1 if any errors."""
    print("Trenchcoat Verify")
    print("=" * 42)

    config_check, config = _check_config()
    key_check, api_key = _check_api_key()
    url_check, api_url = _check_api_url()
    conn_checks = _check_connectivity(api_url, api_key)
    data_checks = _check_local_data()

    checks = [config_check]
    if config:
        checks.append(_check_enabled(config))
    checks += [key_check, url_check] + conn_checks + data_checks

    for c in checks:
        print(c)

    fails = [c for c in checks if c.status == "fail"]
    warns = [c for c in checks if c.status == "warn"]

    print()
    if not fails:
        status = "READY ✓" if not warns else f"READY ✓  ({len(warns)} warning(s))"
        print(f"Status: {status}")
        if warns:
            print("Run /trenchcoat-doctor for details.")
    else:
        print(f"Status: ISSUES FOUND  ({len(fails)} error(s), {len(warns)} warning(s))")
        actionable = [c for c in fails + warns if c.fix]
        if actionable:
            print()
            print("Fixes:")
            for c in actionable:
                print(f"  • {c.label}: {c.fix}")

    return 1 if fails else 0


def run_doctor() -> int:
    """Comprehensive diagnostic. Returns 0 if ok, 1 if any errors."""
    print("Trenchcoat Doctor")
    print("=" * 42)

    config_check, config = _check_config()
    key_check, api_key = _check_api_key()
    url_check, api_url = _check_api_url()

    sections = [
        ("System", [_check_python(), _check_plugin_root()]),
        ("Configuration", ([config_check, _check_enabled(config)] if config else [config_check])),
        ("Credentials", [key_check, url_check]),
        ("Hooks", _check_hooks()),
        ("Local Data", _check_local_data()),
        ("API Connectivity", _check_connectivity(api_url, api_key)),
    ]

    all_checks: list[Check] = []
    for section_name, checks in sections:
        print(f"\n{section_name}")
        for c in checks:
            print(c)
        all_checks.extend(checks)

    fails = [c for c in all_checks if c.status == "fail"]
    warns = [c for c in all_checks if c.status == "warn"]
    actionable = [c for c in fails + warns if c.fix]

    print()
    print("─" * 42)

    if not fails and not warns:
        print("All checks passed. ✓")
    else:
        if fails:
            print(f"Errors:   {len(fails)}")
        if warns:
            print(f"Warnings: {len(warns)}")
        if actionable:
            print("\nRemediation:")
            for c in actionable:
                print(f"  • {c.label}: {c.fix}")

    return 1 if fails else 0


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "doctor"
    sys.exit(run_verify() if mode == "verify" else run_doctor())
