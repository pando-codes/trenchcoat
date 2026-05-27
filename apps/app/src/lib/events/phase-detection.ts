import type { TelemetryEvent } from "@/types/events";

// ---------------------------------------------------------------------------
// Phase classification
//
// Each tool_use event is classified into a phase based on the tool name and
// (for Bash) the command shape. Non-tool events are classified as "other".
// ---------------------------------------------------------------------------

export type EventPhase = "explore" | "implement" | "verify" | "other";

const EXPLORE_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebSearch",
  "WebFetch",
]);

const IMPLEMENT_TOOLS = new Set([
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

/** Regex used to detect "verify-like" Bash commands. Case-insensitive. */
const VERIFY_COMMAND_RE = /test|lint|build|tsc|typecheck/i;

/**
 * Extract a Bash command string from a (possibly truncated) input_preview blob.
 *
 * input_preview is a JSON-stringified dict capped at ~100 chars; the closing
 * brace and final quote may be missing. We tolerate that by:
 *   1. Trying JSON.parse on the raw string (and on a candidate stripped of a
 *      trailing "..." marker).
 *   2. Falling back to a regex that captures the value of the "command" key
 *      up to either an unescaped closing quote or end of input.
 *
 * Returns null when no command value can be extracted.
 */
function extractBashCommand(raw: string): string | null {
  if (!raw) return null;

  // Attempt JSON.parse first (cheap to try, robust when the preview wasn't
  // actually truncated).
  const candidates = [raw];
  if (raw.endsWith("...")) candidates.push(raw.slice(0, -3));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as Record<string, unknown>).command === "string"
      ) {
        return (parsed as Record<string, unknown>).command as string;
      }
    } catch {
      // ignore — try next candidate or fall through to regex.
    }
  }

  // Regex fallback: match `"command"<ws>:<ws>"...value..."` where the closing
  // quote may be absent (truncation). Capture content up to an unescaped quote
  // or end of input.
  const re = /"command"\s*:\s*"((?:\\.|[^"\\])*)/u;
  const m = raw.match(re);
  if (!m) return null;
  let value = m[1];
  // Strip the trailing "..." truncation marker the plugin appends.
  if (value.endsWith("...")) value = value.slice(0, -3);
  // Un-escape minimal JSON escapes that show up in commands.
  value = value
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
  return value;
}

/**
 * Classify a single event by phase.
 *
 * Rules:
 *   - tool_use with name in {Read, Grep, Glob, LS, WebSearch, WebFetch} → "explore"
 *   - tool_use with name in {Edit, Write, MultiEdit, NotebookEdit} → "implement"
 *   - tool_use with name "Bash" AND command matches /test|lint|build|tsc|typecheck/i → "verify"
 *     (read data.input_preview to inspect the command — tolerate truncated JSON)
 *   - tool_use with name "Bash" (any other command) → "other"
 *   - Everything else (skill_use, subagent_stop, pre_compact, etc.) → "other"
 */
export function classifyEventPhase(event: TelemetryEvent): EventPhase {
  if (!event || event.event_type !== "tool_use") return "other";

  const toolName = event.tool_name;
  if (!toolName) return "other";

  if (EXPLORE_TOOLS.has(toolName)) return "explore";
  if (IMPLEMENT_TOOLS.has(toolName)) return "implement";

  if (toolName === "Bash") {
    const data = event.data;
    if (data && typeof data === "object") {
      const rawPreview = (data as Record<string, unknown>).input_preview;
      if (typeof rawPreview === "string" && rawPreview.length > 0) {
        const command = extractBashCommand(rawPreview);
        if (command && VERIFY_COMMAND_RE.test(command)) return "verify";
      }
    }
    return "other";
  }

  return "other";
}

// ---------------------------------------------------------------------------
// Phase proportions for a turn
// ---------------------------------------------------------------------------

export interface PhaseProportions {
  /** Fraction of measurable time in each phase. Sums to 1 when totalMs > 0. */
  explore: number;
  implement: number;
  verify: number;
  other: number;
  /** Sum of measurable durations across all classified events, in ms. */
  totalMs: number;
}

/** Extract correlation_id from an event's data, if present. */
function correlationId(event: TelemetryEvent): string | null {
  const data = event.data;
  if (!data || typeof data !== "object") return null;
  const cid = (data as Record<string, unknown>).correlation_id;
  return typeof cid === "string" && cid.length > 0 ? cid : null;
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

/** Extract duration_ms from a tool_result event — prefer top-level column,
 *  fall back to data.duration_ms. Returns null when neither is available. */
function resultDurationMs(event: TelemetryEvent | null): number | null {
  if (!event) return null;
  if (event.duration_ms !== null && event.duration_ms !== undefined) {
    const n = toNumberOrNull(event.duration_ms);
    if (n !== null) return n;
  }
  if (event.data && typeof event.data === "object") {
    return toNumberOrNull(
      (event.data as Record<string, unknown>).duration_ms
    );
  }
  return null;
}

/**
 * Compute per-phase time proportions for a turn's events.
 *
 * Duration for a tool_use is read from the *paired* tool_result's
 * `data.duration_ms` (or top-level `duration_ms` on the tool_result event).
 * Pairing strategy:
 *   - Prefer matching on data.correlation_id between tool_use and tool_result.
 *   - Fall back to nearest matching tool_name in seq order.
 *
 * Non-tool events contribute 0 duration (so skill_use, subagent_stop, etc.
 * don't skew the bar unless they have a known duration; in practice they
 * don't, so they show as 0).
 *
 * Returns all zeros and totalMs=0 when no measurable duration is found.
 */
export function computeTurnPhaseProportions(
  events: TelemetryEvent[]
): PhaseProportions {
  const zero: PhaseProportions = {
    explore: 0,
    implement: 0,
    verify: 0,
    other: 0,
    totalMs: 0,
  };

  if (!events || events.length === 0) return zero;

  // Defensive sort by seq ascending. Avoid mutating the input.
  const sorted = [...events].sort((a, b) => a.seq - b.seq);

  // Track which tool_result events have already been consumed by a pairing.
  const used = new Set<string>();

  const pairResult = (useEvent: TelemetryEvent): TelemetryEvent | null => {
    const cid = correlationId(useEvent);
    const useName = useEvent.tool_name;

    // Pass 1: correlation_id match anywhere after the use event.
    if (cid) {
      for (const r of sorted) {
        if (used.has(r.id)) continue;
        if (r.event_type !== "tool_result") continue;
        if (r.seq < useEvent.seq) continue;
        if (correlationId(r) === cid) {
          used.add(r.id);
          return r;
        }
      }
    }

    // Pass 2: nearest tool_result with the same tool_name after the use event.
    for (const r of sorted) {
      if (used.has(r.id)) continue;
      if (r.event_type !== "tool_result") continue;
      if (r.seq < useEvent.seq) continue;
      if (useName && r.tool_name && r.tool_name === useName) {
        used.add(r.id);
        return r;
      }
      if (!useName && !r.tool_name) {
        used.add(r.id);
        return r;
      }
    }

    return null;
  };

  const buckets: Record<EventPhase, number> = {
    explore: 0,
    implement: 0,
    verify: 0,
    other: 0,
  };

  for (const event of sorted) {
    if (event.event_type !== "tool_use") continue;
    const result = pairResult(event);
    if (!result) continue; // un-paired tool_use contributes 0.
    const dur = resultDurationMs(result);
    if (dur === null || dur <= 0) continue;
    const phase = classifyEventPhase(event);
    buckets[phase] += dur;
  }

  const totalMs =
    buckets.explore + buckets.implement + buckets.verify + buckets.other;
  if (totalMs <= 0) return zero;

  return {
    explore: buckets.explore / totalMs,
    implement: buckets.implement / totalMs,
    verify: buckets.verify / totalMs,
    other: buckets.other / totalMs,
    totalMs,
  };
}
