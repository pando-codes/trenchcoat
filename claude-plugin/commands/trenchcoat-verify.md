---
description: Quickly verify your trenchcoat setup is working correctly
allowed-tools: Bash
user-invocable: true
---

# Trenchcoat Verify

Run a quick verification and display the result:

```bash
python3 "$CLAUDE_PLUGIN_ROOT/lib/diagnostics.py" verify
```

Show the output to the user exactly as printed.

If the status is **READY**, tell the user their setup is good and events will be pushed to the SaaS dashboard on the next session end.

If **ISSUES FOUND**, tell the user which checks failed and suggest:
- Run `/trenchcoat-connect` if the API key is missing or invalid.
- Run `/trenchcoat-doctor` for a full diagnostic with step-by-step remediation.
