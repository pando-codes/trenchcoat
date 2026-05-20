---
description: Diagnose and troubleshoot your trenchcoat plugin setup
allowed-tools: Bash
user-invocable: true
---

# Trenchcoat Doctor

Run a comprehensive diagnostic across all aspects of the trenchcoat setup:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/lib/diagnostics.py" doctor
```

Show the output to the user exactly as printed.

After showing the output, help the user understand and act on any issues found:

**If credentials are missing or invalid (`[✗] API key`):**
Offer to run `/trenchcoat-connect` so the user can enter their API key from the dashboard (Settings → API Keys).

**If the API endpoint is unreachable (`[✗] API reachable`):**
Ask the user to check their network connection. If they are self-hosting, offer to run `/trenchcoat-connect` to update the API URL.

**If no event files exist (`[!] Event files`):**
Explain that the plugin records events via hooks, and no sessions have been tracked yet. Tell the user to start a new Claude Code session and then run `/trenchcoat-report` to confirm events are being recorded.

**If there is a stuck push queue (`[!] Push queue`):**
Explain that events are queued locally and will be retried on the next session end. If the queue has been stuck for more than an hour, the API key may be invalid — offer to validate it with `/trenchcoat-verify`.

**If telemetry is disabled (`[✗] Telemetry enabled`):**
Show the user the exact edit needed: set `"enabled": true` in `~/.claude/trenchcoat/config.json`.

**If all checks pass:**
Confirm the setup is healthy and remind the user they can view analytics at app.trenchcoat.io after their next session.
