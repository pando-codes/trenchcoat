// ---------------------------------------------------------------------------
// Input preview parsing
//
// data.input_preview is a truncated JSON-stringified dict of the original tool
// input, capped at ~100 chars (see claude-plugin/lib/telemetry.py
// sanitize_tool_input). It may end in "..." and may be invalid JSON. Parsers
// must be tolerant of truncation and fall back to regex extraction when
// JSON.parse fails.
// ---------------------------------------------------------------------------

export interface PreviewParts {
  /** Primary label to show in the row (file path, command, pattern, etc.).
   *  Null when no useful primary can be extracted. */
  primary: string | null;
  /** Optional secondary detail (e.g. grep path, edit line range). */
  secondary?: string | null;
  /** Indicates how the preview was extracted, for styling decisions. */
  kind: "file" | "bash" | "grep" | "glob" | "raw";
}

/** Tools whose inputs contain a `file_path` we want to surface. */
const FILE_TOOLS = new Set([
  "Read",
  "Edit",
  "Write",
  "MultiEdit",
  "NotebookEdit",
]);

/** Strip trailing truncation artifacts like `"...` or trailing partial quotes. */
function stripTruncation(value: string): string {
  let v = value;
  // Common truncation: ends with backslash followed by garbage, or with "...
  // Remove a trailing run of `.` (the "..." suffix from sanitize_tool_input).
  v = v.replace(/\.+$/, "");
  // Remove a dangling backslash if present.
  v = v.replace(/\\+$/, "");
  return v;
}

/** Attempt to JSON.parse a possibly-truncated preview. Returns null on failure. */
function tryParse(raw: string): Record<string, unknown> | null {
  // Remove the "..." marker we know the plugin appends, so a clean JSON
  // string still parses cleanly.
  let candidate = raw;
  if (candidate.endsWith("...")) {
    candidate = candidate.slice(0, -3);
  }
  try {
    const parsed = JSON.parse(candidate);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return null;
}

/** Extract a quoted string value for a given JSON key from a possibly-truncated
 *  JSON-ish blob. Returns null when not found. */
function extractStringField(raw: string, field: string): string | null {
  // Match `"field"<ws>:<ws>"...value..."` where the closing quote is either
  // a real closing quote OR end-of-string (truncation). We capture content
  // up to either an unescaped quote or end of input.
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `"${escaped}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`,
    "u"
  );
  const m = raw.match(re);
  if (!m) return null;
  let value = m[1];
  // Un-escape minimal JSON escapes we care about.
  value = value
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t");
  return stripTruncation(value);
}

/** Shorten a file path by keeping the last two path segments when the full
 *  path exceeds 40 characters. */
function shortenPath(path: string): string {
  if (!path) return path;
  if (path.length <= 40) return path;
  const parts = path.split("/").filter((p) => p.length > 0);
  if (parts.length <= 2) return path;
  const tail = parts.slice(-2).join("/");
  return `.../${tail}`;
}

/** Trim a string for raw fallback rendering. */
function trimRaw(raw: string): string {
  let v = raw.trim();
  // Strip a single pair of wrapping braces or brackets.
  if (v.startsWith("{") && v.endsWith("}")) {
    v = v.slice(1, -1);
  } else if (v.startsWith("{")) {
    v = v.slice(1);
  } else if (v.endsWith("}")) {
    v = v.slice(0, -1);
  }
  // Strip wrapping quotes.
  if (v.startsWith('"') && v.endsWith('"')) {
    v = v.slice(1, -1);
  }
  v = v.trim();
  if (v.length > 60) v = v.slice(0, 60);
  return v;
}

/**
 * Extract a human-readable preview from a raw input_preview string.
 *
 * Tool-specific rules:
 *   - Read / Edit / Write / MultiEdit / NotebookEdit → primary = file_path
 *     (basename + parent dir for long paths), kind = "file"
 *   - Bash → primary = command (truncated), kind = "bash"
 *   - Grep → primary = pattern, secondary = path, kind = "grep"
 *   - Glob → primary = pattern, secondary = path, kind = "glob"
 *   - Anything else → kind = "raw", primary = first 60 chars of preview
 *
 * Returns null only when toolName is null and preview is empty.
 */
export function parseInputPreview(
  toolName: string | null,
  rawPreview: string | null | undefined
): PreviewParts | null {
  const hasPreview =
    rawPreview !== null && rawPreview !== undefined && rawPreview.length > 0;

  if (!toolName && !hasPreview) {
    return null;
  }

  const raw = hasPreview ? (rawPreview as string) : "";
  const parsed = hasPreview ? tryParse(raw) : null;

  /** Helper: extract a field, preferring JSON parse, falling back to regex. */
  const getField = (field: string): string | null => {
    if (parsed && typeof parsed[field] === "string") {
      return stripTruncation(parsed[field] as string);
    }
    if (raw) return extractStringField(raw, field);
    return null;
  };

  if (toolName && FILE_TOOLS.has(toolName)) {
    const filePath = getField("file_path") ?? getField("path");
    if (filePath) {
      return {
        primary: shortenPath(filePath),
        kind: "file",
      };
    }
  }

  if (toolName === "Bash") {
    const command = getField("command");
    if (command) {
      const truncated = command.length > 80 ? command.slice(0, 80) : command;
      return {
        primary: truncated,
        kind: "bash",
      };
    }
  }

  if (toolName === "Grep") {
    const pattern = getField("pattern");
    const path = getField("path");
    if (pattern || path) {
      return {
        primary: pattern,
        secondary: path,
        kind: "grep",
      };
    }
  }

  if (toolName === "Glob") {
    const pattern = getField("pattern");
    const path = getField("path");
    if (pattern || path) {
      return {
        primary: pattern,
        secondary: path,
        kind: "glob",
      };
    }
  }

  // Fallback: surface the raw preview, minimally cleaned up.
  if (raw) {
    return {
      primary: trimRaw(raw) || null,
      kind: "raw",
    };
  }

  // Tool name was set but no preview available.
  return {
    primary: null,
    kind: "raw",
  };
}
