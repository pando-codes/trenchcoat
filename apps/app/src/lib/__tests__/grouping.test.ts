import { describe, it, expect } from "bun:test";
import {
  groupEventsByTurn,
  buildTimelineRows,
  countCompactions,
  countToolErrors,
  countUserTurns,
} from "../events/grouping";
import type { TelemetryEvent, EventType } from "@/types/events";

// --- Helpers ---

interface EventOverrides {
  id?: string;
  seq?: number;
  event_type: EventType;
  tool_name?: string | null;
  timestamp?: string;
  duration_ms?: number | null;
  data?: Record<string, unknown>;
}

let idCounter = 0;
function mkEvent(overrides: EventOverrides): TelemetryEvent {
  idCounter++;
  return {
    id: overrides.id ?? `evt-${idCounter}`,
    user_id: "user-1",
    session_id: "sess-1",
    event_type: overrides.event_type,
    timestamp: overrides.timestamp ?? "2026-05-21T00:00:00.000Z",
    seq: overrides.seq ?? idCounter,
    tool_name: overrides.tool_name ?? null,
    duration_ms: overrides.duration_ms ?? null,
    data: overrides.data ?? {},
    created_at: overrides.timestamp ?? "2026-05-21T00:00:00.000Z",
  };
}

// --- groupEventsByTurn ---

describe("groupEventsByTurn", () => {
  it("returns empty array for no events", () => {
    expect(groupEventsByTurn([])).toEqual([]);
  });

  it("groups a single prompt_submit + tools + assistant_stop into one turn", () => {
    const events = [
      mkEvent({
        seq: 1,
        event_type: "prompt_submit",
        timestamp: "2026-05-21T00:00:00.000Z",
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_use",
        tool_name: "Read",
        timestamp: "2026-05-21T00:00:01.000Z",
      }),
      mkEvent({
        seq: 3,
        event_type: "tool_result",
        tool_name: "Read",
        timestamp: "2026-05-21T00:00:02.000Z",
      }),
      mkEvent({
        seq: 4,
        event_type: "assistant_stop",
        timestamp: "2026-05-21T00:00:05.000Z",
        data: { input_tokens: 100, output_tokens: 200, reason: "end_turn" },
      }),
    ];

    const groups = groupEventsByTurn(events);
    expect(groups.length).toBe(1);
    expect(groups[0].index).toBe(1);
    expect(groups[0].isPreFirstPrompt).toBe(false);
    expect(groups[0].toolCount).toBe(1);
    expect(groups[0].inputTokens).toBe(100);
    expect(groups[0].outputTokens).toBe(200);
    expect(groups[0].stopReason).toBe("end_turn");
    expect(groups[0].durationMs).toBe(5000);
    expect(groups[0].events.length).toBe(4);
  });

  it("groups multiple turns starting at index 1 when no pre-first-prompt events", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "prompt_submit" }),
      mkEvent({ seq: 2, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({ seq: 3, event_type: "assistant_stop" }),
      mkEvent({ seq: 4, event_type: "prompt_submit" }),
      mkEvent({ seq: 5, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({ seq: 6, event_type: "assistant_stop" }),
    ];

    const groups = groupEventsByTurn(events);
    expect(groups.length).toBe(2);
    expect(groups[0].index).toBe(1);
    expect(groups[1].index).toBe(2);
    expect(groups[0].isPreFirstPrompt).toBe(false);
    expect(groups[1].isPreFirstPrompt).toBe(false);
    expect(groups[0].toolCount).toBe(1);
    expect(groups[1].toolCount).toBe(1);
  });

  it("creates a pre-first-prompt group at index 0 when session_start exists before any prompt", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "session_start" }),
      mkEvent({ seq: 2, event_type: "prompt_submit" }),
      mkEvent({ seq: 3, event_type: "assistant_stop" }),
    ];

    const groups = groupEventsByTurn(events);
    expect(groups.length).toBe(2);
    expect(groups[0].index).toBe(0);
    expect(groups[0].isPreFirstPrompt).toBe(true);
    expect(groups[0].promptEvent).toBeNull();
    expect(groups[0].events.length).toBe(1);
    expect(groups[1].index).toBe(1);
    expect(groups[1].isPreFirstPrompt).toBe(false);
  });

  it("handles a turn with only a prompt_submit (no stop yet)", () => {
    const events = [
      mkEvent({
        seq: 1,
        event_type: "prompt_submit",
        timestamp: "2026-05-21T00:00:00.000Z",
      }),
    ];

    const groups = groupEventsByTurn(events);
    expect(groups.length).toBe(1);
    expect(groups[0].toolCount).toBe(0);
    expect(groups[0].durationMs).toBeNull();
    expect(groups[0].stopReason).toBeNull();
    expect(groups[0].inputTokens).toBeNull();
    expect(groups[0].outputTokens).toBeNull();
  });

  it("sorts events defensively when input is unsorted", () => {
    const events = [
      mkEvent({ seq: 4, event_type: "assistant_stop" }),
      mkEvent({ seq: 2, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({ seq: 1, event_type: "prompt_submit" }),
      mkEvent({ seq: 3, event_type: "tool_result", tool_name: "Read" }),
    ];

    const groups = groupEventsByTurn(events);
    expect(groups.length).toBe(1);
    expect(groups[0].events[0].seq).toBe(1);
    expect(groups[0].events[3].seq).toBe(4);
  });

  it("falls back to first->last duration when no prompt or stop pair available", () => {
    const events = [
      mkEvent({
        seq: 1,
        event_type: "session_start",
        timestamp: "2026-05-21T00:00:00.000Z",
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_use",
        tool_name: "Read",
        timestamp: "2026-05-21T00:00:03.000Z",
      }),
    ];
    const groups = groupEventsByTurn(events);
    expect(groups.length).toBe(1);
    expect(groups[0].isPreFirstPrompt).toBe(true);
    expect(groups[0].durationMs).toBe(3000);
  });
});

// --- buildTimelineRows ---

describe("buildTimelineRows", () => {
  it("pairs tool_use and tool_result by correlation_id", () => {
    const events = [
      mkEvent({
        seq: 1,
        event_type: "tool_use",
        tool_name: "Read",
        data: { correlation_id: "abc123" },
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { correlation_id: "abc123", duration_ms: 42 },
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.kind).toBe("tool");
    if (row.kind === "tool") {
      expect(row.toolName).toBe("Read");
      expect(row.resultEvent).not.toBeNull();
      expect(row.durationMs).toBe(42);
    }
  });

  it("pairs tool_use and tool_result by tool_name as fallback", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { duration_ms: 12 },
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    if (rows[0].kind === "tool") {
      expect(rows[0].durationMs).toBe(12);
    }
  });

  it("keeps 2 consecutive identical tool calls as separate rows", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({ seq: 2, event_type: "tool_use", tool_name: "Edit" }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(2);
    expect(rows[0].kind).toBe("tool");
    expect(rows[1].kind).toBe("tool");
  });

  it("collapses 3 or more consecutive identical tool calls into a tool_run", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { duration_ms: 5 },
      }),
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { duration_ms: 7 },
      }),
      mkEvent({ seq: 5, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({
        seq: 6,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { duration_ms: 11 },
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.kind).toBe("tool_run");
    if (row.kind === "tool_run") {
      expect(row.toolName).toBe("Edit");
      expect(row.count).toBe(3);
      expect(row.useEvents.length).toBe(3);
      expect(row.totalDurationMs).toBe(23);
    }
  });

  it("does not collapse runs of different tools", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({ seq: 2, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Read" }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.kind === "tool")).toBe(true);
  });

  it("renders pre_compact as a divider row with the right label", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({ seq: 2, event_type: "pre_compact" }),
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Edit" }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(3);
    expect(rows[1].kind).toBe("divider");
    if (rows[1].kind === "divider") {
      expect(rows[1].label).toBe("Context compacted");
    }
  });

  it("renders skill_use as a skill row using data.skill_name", () => {
    const events = [
      mkEvent({
        seq: 1,
        event_type: "skill_use",
        data: { skill_name: "verify" },
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe("skill");
    if (rows[0].kind === "skill") {
      expect(rows[0].skillName).toBe("verify");
    }
  });

  it("renders subagent_stop as a subagent_stop row", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "subagent_stop", data: { reason: "ok" } }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe("subagent_stop");
  });

  it("filters out session_start, session_end, prompt_submit, assistant_stop", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "session_start" }),
      mkEvent({ seq: 2, event_type: "prompt_submit" }),
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({ seq: 4, event_type: "assistant_stop" }),
      mkEvent({ seq: 5, event_type: "session_end" }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    expect(rows[0].kind).toBe("tool");
  });

  it("handles tool_use without a matching tool_result", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    if (rows[0].kind === "tool") {
      expect(rows[0].resultEvent).toBeNull();
      expect(rows[0].durationMs).toBeNull();
    }
  });

  it("prefers correlation_id pairing over tool_name when both are available", () => {
    // Two reads in flight; the first tool_result has a different correlation_id
    // than the first tool_use, so it should pair with the second tool_use.
    const events = [
      mkEvent({
        seq: 1,
        event_type: "tool_use",
        tool_name: "Read",
        data: { correlation_id: "aaa" },
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_use",
        tool_name: "Read",
        data: { correlation_id: "bbb" },
      }),
      mkEvent({
        seq: 3,
        event_type: "tool_result",
        tool_name: "Read",
        data: { correlation_id: "bbb", duration_ms: 100 },
      }),
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Read",
        data: { correlation_id: "aaa", duration_ms: 200 },
      }),
    ];
    const rows = buildTimelineRows(events);
    // 2 consecutive Reads, stays as separate rows (not collapsed).
    expect(rows.length).toBe(2);
    if (rows[0].kind === "tool" && rows[1].kind === "tool") {
      expect(rows[0].durationMs).toBe(200); // matches first use's correlation aaa
      expect(rows[1].durationMs).toBe(100); // matches second use's correlation bbb
    }
  });

  it("uses event.duration_ms top-level column when data.duration_ms is missing", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        duration_ms: 75,
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    if (rows[0].kind === "tool") {
      expect(rows[0].durationMs).toBe(75);
    }
  });

  it("returns empty array for no events", () => {
    expect(buildTimelineRows([])).toEqual([]);
  });
});

// --- countCompactions / countUserTurns ---

describe("countCompactions", () => {
  it("returns 0 when there are no compactions", () => {
    expect(
      countCompactions([
        mkEvent({ seq: 1, event_type: "prompt_submit" }),
        mkEvent({ seq: 2, event_type: "tool_use", tool_name: "Read" }),
      ])
    ).toBe(0);
  });

  it("counts pre_compact events", () => {
    expect(
      countCompactions([
        mkEvent({ seq: 1, event_type: "pre_compact" }),
        mkEvent({ seq: 2, event_type: "tool_use" }),
        mkEvent({ seq: 3, event_type: "pre_compact" }),
      ])
    ).toBe(2);
  });

  it("returns 0 for empty input", () => {
    expect(countCompactions([])).toBe(0);
  });
});

describe("countUserTurns", () => {
  it("counts prompt_submit events", () => {
    expect(
      countUserTurns([
        mkEvent({ seq: 1, event_type: "session_start" }),
        mkEvent({ seq: 2, event_type: "prompt_submit" }),
        mkEvent({ seq: 3, event_type: "tool_use" }),
        mkEvent({ seq: 4, event_type: "prompt_submit" }),
        mkEvent({ seq: 5, event_type: "assistant_stop" }),
      ])
    ).toBe(2);
  });

  it("returns 0 when there are no prompts", () => {
    expect(
      countUserTurns([
        mkEvent({ seq: 1, event_type: "session_start" }),
        mkEvent({ seq: 2, event_type: "tool_use" }),
      ])
    ).toBe(0);
  });

  it("returns 0 for empty input", () => {
    expect(countUserTurns([])).toBe(0);
  });
});

// --- countToolErrors ---

describe("countToolErrors", () => {
  it("returns hasData=false when no tool_result has is_error defined", () => {
    const stats = countToolErrors([
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { duration_ms: 10 },
      }),
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Edit",
        data: {},
      }),
    ]);
    expect(stats.hasData).toBe(false);
    expect(stats.errored).toBe(0);
    expect(stats.total).toBe(0);
  });

  it("returns hasData=false for empty input", () => {
    const stats = countToolErrors([]);
    expect(stats.hasData).toBe(false);
    expect(stats.errored).toBe(0);
    expect(stats.total).toBe(0);
  });

  it("counts mixed errored/successful tool_results correctly", () => {
    const stats = countToolErrors([
      mkEvent({
        seq: 1,
        event_type: "tool_result",
        tool_name: "Read",
        data: { is_error: false },
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Bash",
        data: { is_error: true, error_preview: "command not found" },
      }),
      mkEvent({
        seq: 3,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { is_error: true },
      }),
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Read",
        data: { is_error: false },
      }),
      // unknown — should be ignored entirely
      mkEvent({
        seq: 5,
        event_type: "tool_result",
        tool_name: "Grep",
        data: {},
      }),
      // non-boolean is_error — should be ignored
      mkEvent({
        seq: 6,
        event_type: "tool_result",
        tool_name: "Glob",
        data: { is_error: "yes" },
      }),
    ]);
    expect(stats.hasData).toBe(true);
    expect(stats.total).toBe(4);
    expect(stats.errored).toBe(2);
  });

  it("ignores non-tool_result events", () => {
    const stats = countToolErrors([
      // tool_use carrying is_error should not be counted (wrong event_type)
      mkEvent({
        seq: 1,
        event_type: "tool_use",
        tool_name: "Read",
        data: { is_error: true },
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { is_error: false },
      }),
    ]);
    expect(stats.hasData).toBe(true);
    expect(stats.total).toBe(1);
    expect(stats.errored).toBe(0);
  });
});

// --- buildTimelineRows error fields ---

describe("buildTimelineRows error annotations", () => {
  it("populates isError=true on a 'tool' row when paired result reports an error", () => {
    const events = [
      mkEvent({
        seq: 1,
        event_type: "tool_use",
        tool_name: "Bash",
        data: { correlation_id: "x" },
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Bash",
        data: {
          correlation_id: "x",
          is_error: true,
          error_preview: "exit 1",
        },
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.kind).toBe("tool");
    if (row.kind === "tool") {
      expect(row.isError).toBe(true);
      expect(row.resultEvent).not.toBeNull();
    }
  });

  it("populates isError=false on a 'tool' row when paired result is_error is explicitly false", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { is_error: false },
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    if (rows[0].kind === "tool") {
      expect(rows[0].isError).toBe(false);
    }
  });

  it("leaves isError=null on a 'tool' row when the result has no is_error field", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { duration_ms: 5 },
      }),
    ];
    const rows = buildTimelineRows(events);
    if (rows[0].kind === "tool") {
      expect(rows[0].isError).toBeNull();
    }
  });

  it("populates errorCount and resultEvents on a 'tool_run' row", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Bash" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Bash",
        data: { is_error: true, duration_ms: 5 },
      }),
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Bash" }),
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Bash",
        data: { is_error: false, duration_ms: 7 },
      }),
      mkEvent({ seq: 5, event_type: "tool_use", tool_name: "Bash" }),
      mkEvent({
        seq: 6,
        event_type: "tool_result",
        tool_name: "Bash",
        data: { is_error: true, duration_ms: 11 },
      }),
    ];
    const rows = buildTimelineRows(events);
    expect(rows.length).toBe(1);
    const row = rows[0];
    expect(row.kind).toBe("tool_run");
    if (row.kind === "tool_run") {
      expect(row.count).toBe(3);
      expect(row.errorCount).toBe(2);
      expect(row.resultEvents.length).toBe(3);
      expect(row.resultEvents.every((r) => r !== null)).toBe(true);
      expect(row.totalDurationMs).toBe(23);
    }
  });
});
