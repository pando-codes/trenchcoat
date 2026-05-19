---
description: Generate a text summary of Claude Code trenchcoat data
allowed-tools: Bash, Read
user-invocable: true
---

# Trenchcoat Report

Generate a text trenchcoat report by running the reporter:

```bash
python3 -c "
import sys; sys.path.insert(0, '$CLAUDE_PLUGIN_ROOT/lib')
from reporter import text_report
days = int('$ARGUMENTS'.strip() or '7')
print(text_report(days))
"
```

Run the above command and display the output to the user as-is. The argument is the number of days to include (default: 7).
