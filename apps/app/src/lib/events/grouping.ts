import type { TelemetryEvent } from "@/types/events";

// ---------------------------------------------------------------------------
// Turn grouping
// ---------------------------------------------------------------------------

export interface TurnGroup {
  /** 0-based turn index. Index 0 is the "Session start" pseudo-turn (events
   *  before the first prompt_submit). The first real user turn is index 1. */
  index: number;
  /** True only for the pre-first-prompt group. */
  isPreFirstPrompt: boolean;
  /** The prompt_submit event that starts this turn, or null for pre-first-prompt. */
  promptEvent: TelemetryEvent | null;
  /** All events belonging to this turn, in seq order. Includes the closing
   *  assistant_stop if present. */
  events: TelemetryEvent[];
  /** Count of tool_use events in this turn. */
  toolCount: number;
  /** Wall-clock duration from prompt timestamp to the closing assistant_stop
   *  (or last event if no stop yet). Null if not computable. */
  durationMs: number | null;
  /** Token totals from the closing assistant_stop event, if any. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** From data.reason on the closing assistant_stop. */
  stopReason: string | null;
  /** ISO timestamp of the first event in this turn. */
  startedAt: string;
}

/** Best-effort parse of a numeric value from an unknown source. */
function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Best-effort parse of a string value from an unknown source. */
function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  return null;
}

/** Compute the wall-clock duration in ms between two ISO timestamps. */
function diffMs(start: string | undefined, end: string | undefined): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return e - s;
}

/** Build a TurnGroup from a contiguous slice of events. */
function buildTurnGroup(
  index: number,
  isPreFirstPrompt: boolean,
  promptEvent: TelemetryEvent | null,
  events: TelemetryEvent[]
): TurnGroup {
  const toolCount = events.filter((e) => e.event_type === "tool_use").length;

  // Closing assistant_stop: use the last one in this group, if any.
  let stopEvent: TelemetryEvent | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].event_type === "assistant_stop") {
      stopEvent = events[i];
      break;
    }
  }

  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let stopReason: string | null = null;
  if (stopEvent && stopEvent.data && typeof stopEvent.data === "object") {
    const data = stopEvent.data as Record<string, unknown>;
    inputTokens = toNumberOrNull(data.input_tokens);
    outputTokens = toNumberOrNull(data.output_tokens);
    stopReason = toStringOrNull(data.reason);
  }

  // Duration: prefer prompt -> assistant_stop. Otherwise first -> last event.
  let durationMs: number | null = null;
  if (promptEvent && stopEvent) {
    durationMs = diffMs(promptEvent.timestamp, stopEvent.timestamp);
  } else if (events.length > 0) {
    const firstTs = events[0]?.timestamp;
    const lastTs = events[events.length - 1]?.timestamp;
    if (firstTs && lastTs && firstTs !== lastTs) {
      durationMs = diffMs(firstTs, lastTs);
    }
  }

  const startedAt =
    promptEvent?.timestamp ??
    events[0]?.timestamp ??
    "";

  return {
    index,
    isPreFirstPrompt,
    promptEvent,
    events,
    toolCount,
    durationMs,
    inputTokens,
    outputTokens,
    stopReason,
    startedAt,
  };
}

/**
 * Group events into turn groups. A new turn begins at each prompt_submit event.
 * Events with seq < first prompt_submit go into a pre-first-prompt group
 * (index 0), unless there are no such events in which case the result starts
 * at index 1.
 *
 * Events are expected to be sorted by seq ascending. Sort defensively.
 */
export function groupEventsByTurn(events: TelemetryEvent[]): TurnGroup[] {
  if (!events || events.length === 0) return [];

  // Defensive sort by seq ascending. Avoid mutating the input.
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  const groups: TurnGroup[] = [];

  // Collect events before the first prompt_submit.
  let cursor = 0;
  const preEvents: TelemetryEvent[] = [];
  while (cursor < sorted.length && sorted[cursor].event_type !== "prompt_submit") {
    preEvents.push(sorted[cursor]);
    cursor++;
  }

  if (preEvents.length > 0) {
    groups.push(buildTurnGroup(0, true, null, preEvents));
  }

  // Now cursor either points to the first prompt_submit, or is at end.
  let turnIndex = 1;
  while (cursor < sorted.length) {
    // sorted[cursor] is a prompt_submit at this point.
    const prompt = sorted[cursor];
    const turnEvents: TelemetryEvent[] = [prompt];
    cursor++;
    while (
      cursor < sorted.length &&
      sorted[cursor].event_type !== "prompt_submit"
    ) {
      turnEvents.push(sorted[cursor]);
      cursor++;
    }
    groups.push(buildTurnGroup(turnIndex, false, prompt, turnEvents));
    turnIndex++;
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Timeline rows
// ---------------------------------------------------------------------------

/** Renderable row in the timeline. tool_use+tool_result pairs are merged
 *  into a single 'tool' row; consecutive identical tools collapse into
 *  'tool_run'; pre_compact becomes a 'divider'. session_start / session_end
 *  events are filtered out (shown elsewhere). */
export type TimelineRow =
  | {
      kind: "tool";
      key: string;
      toolName: string;
      /** The tool_use event (always) and the paired tool_result if present. */
      useEvent: TelemetryEvent;
      resultEvent: TelemetryEvent | null;
      durationMs: number | null;
      /**
       * Whether the paired tool_result reported an error.
       * - `true`  → resultEvent.data.is_error === true.
       * - `false` → resultEvent.data.is_error === false (explicitly succeeded).
       * - `null`  → no result yet, or the plugin did not report is_error.
       */
      isError: boolean | null;
    }
  | {
      kind: "tool_run";
      key: string;
      toolName: string;
      count: number;
      /** All tool_use events in the run, in order. */
      useEvents: TelemetryEvent[];
      /** Paired tool_result events, one per useEvents entry (null when missing). */
      resultEvents: (TelemetryEvent | null)[];
      /** Sum of paired tool_result.data.duration_ms, when available. */
      totalDurationMs: number | null;
      /** Count of useEvents whose paired result has data.is_error === true. */
      errorCount: number;
    }
  | {
      kind: "skill";
      key: string;
      skillName: string;
      event: TelemetryEvent;
    }
  | {
      kind: "subagent_stop";
      key: string;
      event: TelemetryEvent;
    }
  | {
      kind: "divider";
      key: string;
      label: string;
      event: TelemetryEvent;
    }
  | {
      kind: "other";
      key: string;
      event: TelemetryEvent;
    };

/** Internal: a single un-collapsed row (tool / skill / subagent_stop / divider / other). */
type SingleRow = Exclude<TimelineRow, { kind: "tool_run" }>;

/** Extract correlation_id from an event's data, if present. */
function correlationId(event: TelemetryEvent): string | null {
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const cid = (data as Record<string, unknown>).correlation_id;
  return typeof cid === "string" && cid.length > 0 ? cid : null;
}

/**
 * Read `data.is_error` from a tool_result event. Returns `true`/`false` only
 * when the field is explicitly a boolean; `null` otherwise (i.e. unknown — the
 * plugin did not report it). Callers MUST treat `null` as "unknown", NOT as
 * "no error".
 */
function isErrorFromResult(event: TelemetryEvent | null): boolean | null {
  if (!event) return null;
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>).is_error;
  if (typeof raw === "boolean") return raw;
  return null;
}

/**
 * Read `data.error_preview` from a tool_result event, trim whitespace, and
 * clamp to ~200 chars (suitable for a tooltip). Returns `null` when there is
 * no usable preview.
 */
export function getResultErrorPreview(
  resultEvent: TelemetryEvent | null
): string | null {
  if (!resultEvent) return null;
  const data = resultEvent.data;
  if (!data || typeof data !== "object") return null;
  const raw = (data as Record<string, unknown>).error_preview;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const MAX = 200;
  if (trimmed.length <= MAX) return trimmed;
  return trimmed.slice(0, MAX - 1) + "…";
}

/** Extract duration_ms from a tool_result event — prefer top-level column,
 *  fall back to data.duration_ms. */
function resultDurationMs(event: TelemetryEvent | null): number | null {
  if (!event) return null;
  if (event.duration_ms !== null && event.duration_ms !== undefined) {
    return toNumberOrNull(event.duration_ms);
  }
  if (event.data && typeof event.data === "object") {
    return toNumberOrNull(
      (event.data as Record<string, unknown>).duration_ms
    );
  }
  return null;
}

/**
 * Convert a turn's raw events into renderable timeline rows.
 *
 * Pairing strategy for tool_use → tool_result:
 *   - Prefer matching on data.correlation_id when both events have one.
 *   - Fall back to matching the next tool_result with the same tool_name in
 *     seq order (LIFO if multiple in flight).
 *
 * Run collapsing:
 *   - Consecutive 'tool' rows with the same toolName collapse into a single
 *     'tool_run' row when count >= 3. (1 or 2 in a row stay as separate rows
 *     so the previews remain visible.)
 *
 * Filtered out: session_start, session_end, prompt_submit, assistant_stop
 * (these are reflected in the surrounding TurnGroup metadata, not the row list).
 */
export function buildTimelineRows(events: TelemetryEvent[]): TimelineRow[] {
  if (!events || events.length === 0) return [];

  // Defensive sort.
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  // Filter to the events we care about for row generation. We still keep
  // tool_result entries because we need to pair them with tool_use events.
  const FILTERED_TYPES = new Set([
    "session_start",
    "session_end",
    "prompt_submit",
    "assistant_stop",
  ]);

  const relevant = sorted.filter((e) => !FILTERED_TYPES.has(e.event_type));

  // Index of tool_result events available for pairing. We will mark used ones.
  const used = new Set<string>();

  /** Pair a given tool_use with a tool_result event. Returns the result event
   *  or null. Mutates `used` by inserting the result event id. */
  const pairResult = (useEvent: TelemetryEvent): TelemetryEvent | null => {
    const cid = correlationId(useEvent);
    const useName = useEvent.tool_name;

    // First pass: correlation_id match anywhere after the use event.
    if (cid) {
      for (const r of relevant) {
        if (used.has(r.id)) continue;
        if (r.event_type !== "tool_result") continue;
        if (r.seq < useEvent.seq) continue;
        if (correlationId(r) === cid) {
          used.add(r.id);
          return r;
        }
      }
    }

    // Fallback: nearest tool_result with the same tool_name after the use event.
    for (const r of relevant) {
      if (used.has(r.id)) continue;
      if (r.event_type !== "tool_result") continue;
      if (r.seq < useEvent.seq) continue;
      if (useName && r.tool_name && r.tool_name === useName) {
        used.add(r.id);
        return r;
      }
      // Allow matching when names are missing on both sides (best-effort).
      if (!useName && !r.tool_name) {
        used.add(r.id);
        return r;
      }
    }

    return null;
  };

  // First pass: build single rows in seq order, skipping tool_result events
  // (they're consumed by tool_use pairing).
  const singleRows: SingleRow[] = [];
  for (const event of relevant) {
    if (event.event_type === "tool_result") {
      // Consumed via pairing only.
      continue;
    }
    if (event.event_type === "tool_use") {
      const resultEvent = pairResult(event);
      const dur = resultDurationMs(resultEvent);
      const isError = isErrorFromResult(resultEvent);
      singleRows.push({
        kind: "tool",
        key: event.id,
        toolName: event.tool_name ?? "unknown",
        useEvent: event,
        resultEvent,
        durationMs: dur,
        isError,
      });
      continue;
    }
    if (event.event_type === "pre_compact") {
      singleRows.push({
        kind: "divider",
        key: event.id,
        label: "Context compacted",
        event,
      });
      continue;
    }
    if (event.event_type === "skill_use") {
      const data = (event.data as Record<string, unknown> | null) ?? {};
      const skillName =
        toStringOrNull(data.skill_name) ?? event.tool_name ?? "skill";
      singleRows.push({
        kind: "skill",
        key: event.id,
        skillName,
        event,
      });
      continue;
    }
    if (event.event_type === "subagent_stop") {
      singleRows.push({
        kind: "subagent_stop",
        key: event.id,
        event,
      });
      continue;
    }
    // Anything else (e.g. "stop", "error", or unrecognized types).
    singleRows.push({
      kind: "other",
      key: event.id,
      event,
    });
  }

  // Second pass: collapse runs of 3+ consecutive 'tool' rows with the same tool name.
  const rows: TimelineRow[] = [];
  let i = 0;
  while (i < singleRows.length) {
    const row = singleRows[i];
    if (row.kind === "tool") {
      // Look ahead while next row is also a tool with the same name.
      let j = i + 1;
      while (
        j < singleRows.length &&
        singleRows[j].kind === "tool" &&
        (singleRows[j] as Extract<SingleRow, { kind: "tool" }>).toolName ===
          row.toolName
      ) {
        j++;
      }
      const runLength = j - i;
      if (runLength >= 3) {
        const runRows = singleRows.slice(i, j) as Array<
          Extract<SingleRow, { kind: "tool" }>
        >;
        const useEvents = runRows.map((r) => r.useEvent);
        const resultEvents = runRows.map((r) => r.resultEvent);
        let totalDuration: number | null = null;
        let errorCount = 0;
        for (const r of runRows) {
          if (r.durationMs !== null && r.durationMs !== undefined) {
            totalDuration = (totalDuration ?? 0) + r.durationMs;
          }
          if (r.isError === true) errorCount++;
        }
        rows.push({
          kind: "tool_run",
          key: useEvents[0].id,
          toolName: row.toolName,
          count: runLength,
          useEvents,
          resultEvents,
          totalDurationMs: totalDuration,
          errorCount,
        });
        i = j;
        continue;
      }
    }
    rows.push(row);
    i++;
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Session-level helpers
// ---------------------------------------------------------------------------

/** Count pre_compact events in the session. */
export function countCompactions(events: TelemetryEvent[]): number {
  if (!events) return 0;
  let n = 0;
  for (const e of events) {
    if (e.event_type === "pre_compact") n++;
  }
  return n;
}

/** Count prompt_submit events in the session (i.e. user turn count). */
export function countUserTurns(events: TelemetryEvent[]): number {
  if (!events) return 0;
  let n = 0;
  for (const e of events) {
    if (e.event_type === "prompt_submit") n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Tool error stats
// ---------------------------------------------------------------------------

export interface ToolErrorStats {
  /** Number of tool_result events with data.is_error === true. */
  errored: number;
  /** Total tool_result events where data.is_error is a boolean (i.e. known). */
  total: number;
  /** False when no tool_result event has data.is_error defined as a boolean. */
  hasData: boolean;
}

/**
 * Compute tool error statistics from a session's events.
 *
 * Only `tool_result` events whose `data.is_error` is explicitly a boolean
 * (true OR false) contribute to `total`. Older sessions (plugins that did
 * not yet emit `is_error`) will return `hasData: false` — callers MUST
 * treat that as "unknown", not as "no errors".
 */
export function countToolErrors(events: TelemetryEvent[]): ToolErrorStats {
  if (!events || events.length === 0) {
    return { errored: 0, total: 0, hasData: false };
  }
  let errored = 0;
  let total = 0;
  for (const e of events) {
    if (e.event_type !== "tool_result") continue;
    const data = e.data;
    if (!data || typeof data !== "object") continue;
    const raw = (data as Record<string, unknown>).is_error;
    if (typeof raw !== "boolean") continue;
    total++;
    if (raw === true) errored++;
  }
  return { errored, total, hasData: total > 0 };
}
