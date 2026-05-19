---
description: Analyze Claude Code telemetry data and provide natural language insights about usage patterns, tool performance, and session behavior
---

# Telemetry Insights

You are an expert at analyzing Claude Code telemetry data. When the user asks about their usage patterns, tool performance, session behavior, or any telemetry question, follow this process:

## Step 1: Load the data

Run this to get raw aggregated stats:

```bash
python3 -c "
import sys, json; sys.path.insert(0, '${CLAUDE_PLUGIN_ROOT}/lib')
from reporter import load_events, aggregate, load_sessions
events = load_events(days=30)
stats = aggregate(events)
sessions = load_sessions()
print('=== STATS ===')
print(json.dumps(stats, indent=2))
print('=== SESSIONS ===')
print(json.dumps(dict(list(sessions.items())[-10:]), indent=2))
"
```

## Step 2: Analyze and answer

Based on the loaded data, answer the user's question with specific numbers and insights. Common analyses:

- **Tool patterns**: Which tools are used most? Which are slowest? Are there tools that fail often (tool_start without tool_end)?
- **Session patterns**: How long are typical sessions? What directories are most worked in? How many prompts per session?
- **Productivity insights**: What times of day are most active? How has usage changed over time?
- **Performance**: Which tools have high latency? Are there correlation between tool usage and session duration?
- **Context pressure**: How often do compactions happen? Do they correlate with longer sessions?

If the user's question requires looking at raw events, read the JSONL files directly from `~/.claude/telemetry/events-*.jsonl`.

Always provide concrete numbers, not vague observations. Use tables and charts-in-text where helpful.
