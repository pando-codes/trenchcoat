import { describe, it, expect } from "bun:test";
import {
  classifyEventPhase,
  computeTurnPhaseProportions,
} from "../events/phase-detection";
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

/** Build a JSON-stringified input_preview for a Bash command, optionally
 *  truncated mid-command. */
function bashPreview(command: string, truncate = false): string {
  const json = JSON.stringify({ command });
  if (!truncate) return json;
  // Drop the last few chars so the trailing quote/brace is missing.
  return json.slice(0, json.length - 6) + "...";
}

// --- classifyEventPhase ---

describe("classifyEventPhase", () => {
  it("classifies tool_use Read as explore", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "tool_use", tool_name: "Read" }))
    ).toBe("explore");
  });

  it("classifies tool_use Grep as explore", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "tool_use", tool_name: "Grep" }))
    ).toBe("explore");
  });

  it("classifies tool_use Glob as explore", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "tool_use", tool_name: "Glob" }))
    ).toBe("explore");
  });

  it("classifies tool_use LS as explore", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "tool_use", tool_name: "LS" }))
    ).toBe("explore");
  });

  it("classifies tool_use WebSearch as explore", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: "WebSearch" })
      )
    ).toBe("explore");
  });

  it("classifies tool_use WebFetch as explore", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: "WebFetch" })
      )
    ).toBe("explore");
  });

  it("classifies tool_use Edit as implement", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "tool_use", tool_name: "Edit" }))
    ).toBe("implement");
  });

  it("classifies tool_use Write as implement", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: "Write" })
      )
    ).toBe("implement");
  });

  it("classifies tool_use MultiEdit as implement", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: "MultiEdit" })
      )
    ).toBe("implement");
  });

  it("classifies tool_use NotebookEdit as implement", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: "NotebookEdit" })
      )
    ).toBe("implement");
  });

  it("classifies tool_use Bash with 'bun test foo' as verify", () => {
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: bashPreview("bun test foo") },
        })
      )
    ).toBe("verify");
  });

  it("classifies tool_use Bash with lint command as verify", () => {
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: bashPreview("bun run lint") },
        })
      )
    ).toBe("verify");
  });

  it("classifies tool_use Bash with tsc command as verify", () => {
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: bashPreview("npx tsc --noEmit") },
        })
      )
    ).toBe("verify");
  });

  it("classifies tool_use Bash with typecheck command as verify", () => {
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: bashPreview("pnpm typecheck") },
        })
      )
    ).toBe("verify");
  });

  it("classifies tool_use Bash with build command as verify", () => {
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: bashPreview("bun run build") },
        })
      )
    ).toBe("verify");
  });

  it("classifies tool_use Bash with 'ls -la' as other", () => {
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: bashPreview("ls -la") },
        })
      )
    ).toBe("other");
  });

  it("matches verify keyword case-insensitively", () => {
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: bashPreview("RUN TEST suite") },
        })
      )
    ).toBe("verify");
  });

  it("tolerates a Bash input_preview truncated mid-command", () => {
    // The "...test..." substring remains visible even after truncation, so
    // classification still resolves to verify.
    const truncated = bashPreview("bun test integration/foo/bar", true);
    expect(
      classifyEventPhase(
        mkEvent({
          event_type: "tool_use",
          tool_name: "Bash",
          data: { input_preview: truncated },
        })
      )
    ).toBe("verify");
  });

  it("returns other for Bash with no input_preview", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: "Bash", data: {} })
      )
    ).toBe("other");
  });

  it("returns other for tool_use with an unknown tool name", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: "Bogus" })
      )
    ).toBe("other");
  });

  it("returns other for tool_use with null tool_name", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_use", tool_name: null })
      )
    ).toBe("other");
  });

  it("returns other for a tool_result event", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "tool_result", tool_name: "Read" })
      )
    ).toBe("other");
  });

  it("returns other for skill_use", () => {
    expect(
      classifyEventPhase(
        mkEvent({ event_type: "skill_use", data: { skill_name: "verify" } })
      )
    ).toBe("other");
  });

  it("returns other for pre_compact", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "pre_compact" }))
    ).toBe("other");
  });

  it("returns other for prompt_submit", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "prompt_submit" }))
    ).toBe("other");
  });

  it("returns other for assistant_stop, session_start, session_end", () => {
    expect(
      classifyEventPhase(mkEvent({ event_type: "assistant_stop" }))
    ).toBe("other");
    expect(
      classifyEventPhase(mkEvent({ event_type: "session_start" }))
    ).toBe("other");
    expect(
      classifyEventPhase(mkEvent({ event_type: "session_end" }))
    ).toBe("other");
  });
});

// --- computeTurnPhaseProportions ---

describe("computeTurnPhaseProportions", () => {
  it("returns all zeros and totalMs=0 for empty events", () => {
    expect(computeTurnPhaseProportions([])).toEqual({
      explore: 0,
      implement: 0,
      verify: 0,
      other: 0,
      totalMs: 0,
    });
  });

  it("returns explore=1 for a single Read pair of 500ms", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { duration_ms: 500 },
      }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(1);
    expect(result.implement).toBe(0);
    expect(result.verify).toBe(0);
    expect(result.other).toBe(0);
    expect(result.totalMs).toBe(500);
  });

  it("computes proportions for a Read + Edit + Bash-test mix", () => {
    const events = [
      // Read 1000ms → explore
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { duration_ms: 1000 },
      }),
      // Edit 500ms → implement
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { duration_ms: 500 },
      }),
      // Bash test 500ms → verify
      mkEvent({
        seq: 5,
        event_type: "tool_use",
        tool_name: "Bash",
        data: { input_preview: bashPreview("bun test foo") },
      }),
      mkEvent({
        seq: 6,
        event_type: "tool_result",
        tool_name: "Bash",
        data: { duration_ms: 500 },
      }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(0.5);
    expect(result.implement).toBe(0.25);
    expect(result.verify).toBe(0.25);
    expect(result.other).toBe(0);
    expect(result.totalMs).toBe(2000);
  });

  it("contributes 0 for tool_use with no matching tool_result", () => {
    const events = [
      // Paired Edit 800ms → implement
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { duration_ms: 800 },
      }),
      // Un-paired Read → no contribution
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Read" }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(0);
    expect(result.implement).toBe(1);
    expect(result.totalMs).toBe(800);
  });

  it("returns all zeros when no tool_use events are paired", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({ seq: 2, event_type: "tool_use", tool_name: "Edit" }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result).toEqual({
      explore: 0,
      implement: 0,
      verify: 0,
      other: 0,
      totalMs: 0,
    });
  });

  it("pairs by correlation_id even when tool_name does not match", () => {
    const events = [
      mkEvent({
        seq: 1,
        event_type: "tool_use",
        tool_name: "Read",
        data: { correlation_id: "abc" },
      }),
      // tool_result has a different tool_name but matching correlation_id.
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "SomethingElse",
        data: { correlation_id: "abc", duration_ms: 250 },
      }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(1);
    expect(result.totalMs).toBe(250);
  });

  it("falls back to tool_name pairing when correlation_id mismatches", () => {
    // tool_use has correlation_id "x"; the only tool_result has "y" but the
    // same tool_name. Falls back to tool_name pairing.
    const events = [
      mkEvent({
        seq: 1,
        event_type: "tool_use",
        tool_name: "Read",
        data: { correlation_id: "x" },
      }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { correlation_id: "y", duration_ms: 333 },
      }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(1);
    expect(result.totalMs).toBe(333);
  });

  it("uses top-level duration_ms column when data.duration_ms is missing", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        duration_ms: 90,
      }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(1);
    expect(result.totalMs).toBe(90);
  });

  it("treats a paired tool_result with missing duration as 0 contribution", () => {
    const events = [
      // Unmeasurable Read → 0 contribution
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({ seq: 2, event_type: "tool_result", tool_name: "Read" }),
      // Measurable Edit → drives the total
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Edit" }),
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { duration_ms: 400 },
      }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(0);
    expect(result.implement).toBe(1);
    expect(result.totalMs).toBe(400);
  });

  it("ignores skill_use, subagent_stop, and pre_compact for duration", () => {
    const events = [
      mkEvent({ seq: 1, event_type: "skill_use", data: { duration_ms: 999 } }),
      mkEvent({ seq: 2, event_type: "subagent_stop" }),
      mkEvent({ seq: 3, event_type: "pre_compact" }),
      mkEvent({ seq: 4, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 5,
        event_type: "tool_result",
        tool_name: "Read",
        data: { duration_ms: 100 },
      }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBe(1);
    expect(result.totalMs).toBe(100);
  });

  it("defensively sorts unsorted input by seq before pairing", () => {
    const events = [
      mkEvent({
        seq: 4,
        event_type: "tool_result",
        tool_name: "Edit",
        data: { duration_ms: 200 },
      }),
      mkEvent({ seq: 1, event_type: "tool_use", tool_name: "Read" }),
      mkEvent({
        seq: 2,
        event_type: "tool_result",
        tool_name: "Read",
        data: { duration_ms: 100 },
      }),
      mkEvent({ seq: 3, event_type: "tool_use", tool_name: "Edit" }),
    ];
    const result = computeTurnPhaseProportions(events);
    expect(result.explore).toBeCloseTo(100 / 300, 10);
    expect(result.implement).toBeCloseTo(200 / 300, 10);
    expect(result.totalMs).toBe(300);
  });
});
