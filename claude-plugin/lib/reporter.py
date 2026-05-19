"""
Reporting engine — JSONL loading, aggregation, text reports, HTML dashboard.
"""

import json
import os
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from pathlib import Path
from string import Template

TRENCHCOAT_DIR = Path.home() / ".claude" / "trenchcoat"
TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


def load_events(days: int = 7) -> list[dict]:
    """Load events from the last N days of JSONL files."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    cutoff_str = cutoff.strftime("%Y-%m-%d")
    events = []

    for f in sorted(TRENCHCOAT_DIR.glob("events-*.jsonl")):
        date_part = f.stem.replace("events-", "")
        if date_part < cutoff_str:
            continue
        try:
            for line in f.read_text().splitlines():
                line = line.strip()
                if line:
                    events.append(json.loads(line))
        except (json.JSONDecodeError, OSError):
            continue

    return events


def load_sessions() -> dict:
    """Load session index."""
    sessions_path = TRENCHCOAT_DIR / "sessions.json"
    if sessions_path.exists():
        try:
            return json.loads(sessions_path.read_text())
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def aggregate(events: list[dict]) -> dict:
    """Compute aggregate stats from events."""
    tool_counts = Counter()
    tool_durations = defaultdict(list)
    event_type_counts = Counter()
    sessions = set()
    prompts = 0
    prompt_words = 0
    compacts = 0
    stops = Counter()
    agents = Counter()
    agent_tools = defaultdict(Counter)  # agent_type -> {tool: count}
    hourly = Counter()
    daily = Counter()

    for e in events:
        event_type = e.get("event", "")
        event_type_counts[event_type] += 1
        session_id = e.get("session_id", "")
        data = e.get("data", {})
        ts = e.get("ts", "")

        sessions.add(session_id)

        if ts:
            try:
                dt = datetime.fromisoformat(ts)
                hourly[dt.hour] += 1
                daily[dt.strftime("%Y-%m-%d")] += 1
            except ValueError:
                pass

        if event_type == "tool_end":
            tool_name = data.get("tool_name", "unknown")
            tool_counts[tool_name] += 1
            dur = data.get("duration_ms")
            if dur is not None:
                tool_durations[tool_name].append(dur)

        elif event_type == "prompt":
            prompts += 1
            prompt_words += data.get("word_count", 0)

        elif event_type == "pre_compact":
            compacts += 1

        elif event_type == "stop":
            stops[data.get("reason", "unknown")] += 1

        elif event_type == "subagent_stop":
            agent_type = data.get("agent_type") or data.get("agent_name") or "unknown"
            agents[agent_type] += 1
            # Accumulate per-agent tool breakdown from transcript parsing
            tc = data.get("tool_counts", {})
            if tc:
                for tool, count in tc.items():
                    agent_tools[agent_type][tool] += count

    # Compute tool duration stats
    tool_stats = {}
    for tool, durations in tool_durations.items():
        if durations:
            tool_stats[tool] = {
                "count": tool_counts[tool],
                "avg_ms": round(sum(durations) / len(durations), 1),
                "min_ms": round(min(durations), 1),
                "max_ms": round(max(durations), 1),
                "p50_ms": round(sorted(durations)[len(durations) // 2], 1),
            }

    return {
        "total_events": len(events),
        "unique_sessions": len(sessions),
        "total_prompts": prompts,
        "total_prompt_words": prompt_words,
        "total_compacts": compacts,
        "tool_counts": dict(tool_counts.most_common()),
        "tool_stats": tool_stats,
        "stop_reasons": dict(stops),
        "agent_counts": dict(agents.most_common()),
        "agent_tools": {agent: dict(tools.most_common()) for agent, tools in agent_tools.items()},
        "event_type_counts": dict(event_type_counts),
        "hourly_distribution": dict(sorted(hourly.items())),
        "daily_counts": dict(sorted(daily.items())),
    }


def text_report(days: int = 7) -> str:
    """Generate a text summary report."""
    events = load_events(days)
    if not events:
        return f"No telemetry events found in the last {days} days."

    stats = aggregate(events)
    sessions = load_sessions()

    lines = [
        f"# Claude Code Telemetry Report ({days}-day window)",
        "",
        "## Overview",
        f"- **Total events:** {stats['total_events']}",
        f"- **Unique sessions:** {stats['unique_sessions']}",
        f"- **Total prompts:** {stats['total_prompts']}",
        f"- **Total prompt words:** {stats['total_prompt_words']}",
        f"- **Context compactions:** {stats['total_compacts']}",
        "",
    ]

    # Tool usage
    if stats["tool_counts"]:
        lines.append("## Tool Usage (by call count)")
        lines.append("")
        lines.append("| Tool | Calls | Avg (ms) | P50 (ms) | Max (ms) |")
        lines.append("|------|------:|--------:|---------:|---------:|")
        for tool, count in stats["tool_counts"].items():
            ts = stats["tool_stats"].get(tool, {})
            avg = ts.get("avg_ms", "-")
            p50 = ts.get("p50_ms", "-")
            mx = ts.get("max_ms", "-")
            lines.append(f"| {tool} | {count} | {avg} | {p50} | {mx} |")
        lines.append("")

    # Agents
    if stats["agent_counts"]:
        lines.append("## Subagent Usage")
        lines.append("")
        for agent, count in stats["agent_counts"].items():
            tools = stats.get("agent_tools", {}).get(agent, {})
            if tools:
                top_tools = ", ".join(f"{t}({c})" for t, c in list(tools.items())[:5])
                lines.append(f"- **{agent}:** {count} invocations — tools: {top_tools}")
            else:
                lines.append(f"- **{agent}:** {count} invocations")
        lines.append("")

    # Stop reasons
    if stats["stop_reasons"]:
        lines.append("## Stop Reasons")
        lines.append("")
        for reason, count in stats["stop_reasons"].items():
            lines.append(f"- {reason}: {count}")
        lines.append("")

    # Daily activity
    if stats["daily_counts"]:
        lines.append("## Daily Activity")
        lines.append("")
        for day, count in stats["daily_counts"].items():
            bar = "#" * min(count // 5, 40)
            lines.append(f"- {day}: {count} events {bar}")
        lines.append("")

    # Hourly distribution
    if stats["hourly_distribution"]:
        lines.append("## Hourly Distribution (UTC)")
        lines.append("")
        for hour, count in stats["hourly_distribution"].items():
            bar = "#" * min(count // 3, 30)
            lines.append(f"- {hour:02d}:00 — {count} {bar}")
        lines.append("")

    # Recent sessions
    active = [(sid, s) for sid, s in sessions.items() if s.get("status") == "active"]
    ended = [(sid, s) for sid, s in sessions.items() if s.get("status") == "ended"]
    ended.sort(key=lambda x: x[1].get("ended_at", ""), reverse=True)

    if active:
        lines.append("## Active Sessions")
        lines.append("")
        for sid, s in active:
            lines.append(f"- `{sid[:12]}...` — {s.get('cwd', '?')}")
        lines.append("")

    if ended:
        lines.append("## Recent Sessions (last 5)")
        lines.append("")
        for sid, s in ended[:5]:
            dur = s.get("duration_ms")
            dur_str = f"{dur / 1000:.0f}s" if dur else "?"
            lines.append(f"- `{sid[:12]}...` — {dur_str} — {s.get('cwd', '?')}")
        lines.append("")

    return "\n".join(lines)


def html_dashboard(days: int = 7) -> str:
    """Generate an HTML dashboard using Chart.js."""
    events = load_events(days)
    stats = aggregate(events)

    template_path = TEMPLATE_DIR / "dashboard.html"
    if not template_path.exists():
        return "<html><body><h1>Template not found</h1></body></html>"

    template = template_path.read_text()

    # Prepare data for Chart.js
    tool_labels = json.dumps(list(stats["tool_counts"].keys())[:15])
    tool_values = json.dumps(list(stats["tool_counts"].values())[:15])

    hourly_labels = json.dumps([f"{h:02d}:00" for h in range(24)])
    hourly_values = json.dumps([stats["hourly_distribution"].get(h, 0) for h in range(24)])

    daily_labels = json.dumps(list(stats["daily_counts"].keys()))
    daily_values = json.dumps(list(stats["daily_counts"].values()))

    agent_labels = json.dumps(list(stats["agent_counts"].keys())[:10])
    agent_values = json.dumps(list(stats["agent_counts"].values())[:10])

    # Tool duration data
    dur_tools = []
    dur_avgs = []
    dur_p50s = []
    for tool, ts in sorted(stats["tool_stats"].items(), key=lambda x: x[1]["count"], reverse=True)[:10]:
        dur_tools.append(tool)
        dur_avgs.append(ts["avg_ms"])
        dur_p50s.append(ts["p50_ms"])

    return template.replace(
        "/*TOOL_LABELS*/", tool_labels
    ).replace(
        "/*TOOL_VALUES*/", tool_values
    ).replace(
        "/*HOURLY_LABELS*/", hourly_labels
    ).replace(
        "/*HOURLY_VALUES*/", hourly_values
    ).replace(
        "/*DAILY_LABELS*/", daily_labels
    ).replace(
        "/*DAILY_VALUES*/", daily_values
    ).replace(
        "/*AGENT_LABELS*/", agent_labels
    ).replace(
        "/*AGENT_VALUES*/", agent_values
    ).replace(
        "/*DUR_LABELS*/", json.dumps(dur_tools)
    ).replace(
        "/*DUR_AVGS*/", json.dumps(dur_avgs)
    ).replace(
        "/*DUR_P50S*/", json.dumps(dur_p50s)
    ).replace(
        "/*TOTAL_EVENTS*/", str(stats["total_events"])
    ).replace(
        "/*UNIQUE_SESSIONS*/", str(stats["unique_sessions"])
    ).replace(
        "/*TOTAL_PROMPTS*/", str(stats["total_prompts"])
    ).replace(
        "/*TOTAL_COMPACTS*/", str(stats["total_compacts"])
    ).replace(
        "/*DAYS*/", str(days)
    )
