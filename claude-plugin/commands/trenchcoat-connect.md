---
description: Connect the trenchcoat plugin to a Trenchcoat SaaS instance for team analytics
allowed-tools: AskUserQuestion, Bash, Read, Write
---

# Connect to Trenchcoat SaaS

Help the user connect their local trenchcoat plugin to a Trenchcoat SaaS instance for team analytics.

## Steps

1. **Ask for the API key:**

Use AskUserQuestion to collect:
- **API Key**: A `ct_live_...` API key generated from the SaaS dashboard (Settings → API Keys)
- **API URL** (optional): Only needed if self-hosting. Default is `https://app.trenchcoat.io`.

2. **Write credentials to `~/.claude/settings.json`:**

The Claude-standard location for secrets is the `env` block in `~/.claude/settings.json`. Read the existing file, then upsert `TRENCHCOAT_API_KEY` (and optionally `TRENCHCOAT_API_URL`) into the top-level `env` object — preserving all other settings.

Example result:
```json
{
  "env": {
    "TRENCHCOAT_API_KEY": "ct_live_...",
    "TRENCHCOAT_API_URL": "https://app.trenchcoat.io"
  }
}
```

Omit `TRENCHCOAT_API_URL` if using the default hosted instance. Never put credentials in `~/.claude/trenchcoat/config.json` — that file is for non-secret settings only.

3. **Test the connection:**

Run a curl command to verify the API key works:
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  "${TRENCHCOAT_API_URL:-https://app.trenchcoat.io}/api/v1/events" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <api_key>" \
  -d '{"events":[{"ts":"'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'","event":"session_start","session_id":"test-connection","seq":0,"data":{"cwd":"test"}}]}'
```

If it returns 201, the connection works. If it returns 401 or 403, the API key is invalid.

4. **Confirm success:**

Tell the user:
- Credentials are stored in `~/.claude/settings.json` under `env` (Claude Code's standard secrets location)
- Events will now be queued locally during each session
- On session end, all queued events are batch-pushed to the SaaS
- Local JSONL files in `~/.claude/trenchcoat/` are still preserved
- They can view their analytics at the dashboard after their next session
- A new Claude Code session is required for the env vars to take effect

If the connection test failed, help them troubleshoot (wrong URL, expired key, etc.).
