---
description: Generate and open an HTML trenchcoat dashboard with charts
allowed-tools: Bash, Read, Write
user-invocable: true
---

# Trenchcoat Dashboard

Generate an HTML dashboard and open it in the browser:

```bash
python3 -c "
import sys; sys.path.insert(0, '$CLAUDE_PLUGIN_ROOT/lib')
from reporter import html_dashboard
from pathlib import Path
days = int('$ARGUMENTS'.strip() or '7')
html = html_dashboard(days)
out = Path.home() / '.claude' / 'trenchcoat' / 'dashboard.html'
out.write_text(html)
print(str(out))
"
```

Run the above command, then open the resulting HTML file in the user's default browser:

```bash
open <path from previous command>
```

Tell the user the dashboard has been generated and opened.
