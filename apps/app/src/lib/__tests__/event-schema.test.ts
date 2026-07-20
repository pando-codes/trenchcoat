import { describe, it, expect } from "bun:test";
import { bodySchema } from "../../app/api/v1/events/route";

const VALID_EVENT = {
  ts: "2025-05-01T10:00:00.000Z",
  event: "tool_use" as const,
  session_id: "sess-1",
  seq: 0,
};

function parseBody(body: unknown) {
  return bodySchema.safeParse(body);
}

// ============================================================================
// events array constraints
// ============================================================================

describe("bodySchema — events array", () => {
  it("accepts an array with a single valid event", () => {
    expect(parseBody({ events: [VALID_EVENT] }).success).toBe(true);
  });

  it("accepts an array with exactly 1000 events", () => {
    const events = Array.from({ length: 1000 }, (_, i) => ({ ...VALID_EVENT, seq: i }));
    expect(parseBody({ events }).success).toBe(true);
  });

  it("rejects an empty events array", () => {
    expect(parseBody({ events: [] }).success).toBe(false);
  });

  it("rejects an array with 1001 events", () => {
    const events = Array.from({ length: 1001 }, (_, i) => ({ ...VALID_EVENT, seq: i }));
    expect(parseBody({ events }).success).toBe(false);
  });

  it("rejects when events key is missing entirely", () => {
    expect(parseBody({}).success).toBe(false);
  });
});

// ============================================================================
// event type enum
// ============================================================================

describe("bodySchema — event.event enum", () => {
  const VALID_TYPES = [
    "session_start",
    "session_end",
    "tool_use",
    "tool_result",
    "prompt_submit",
    "assistant_stop",
    "subagent_start",
    "subagent_stop",
    "pre_compact",
    "error",
  ] as const;

  for (const type of VALID_TYPES) {
    it(`accepts event type "${type}"`, () => {
      expect(parseBody({ events: [{ ...VALID_EVENT, event: type }] }).success).toBe(true);
    });
  }

  it("rejects an unknown event type", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, event: "stop" }] }).success).toBe(false);
  });

  it("rejects an empty string event type", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, event: "" }] }).success).toBe(false);
  });
});

// ============================================================================
// timestamp format
// ============================================================================

describe("bodySchema — event.ts datetime", () => {
  it("accepts an ISO 8601 UTC timestamp", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, ts: "2025-05-01T10:00:00.000Z" }] }).success).toBe(true);
  });

  it("accepts a timestamp with timezone offset", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, ts: "2025-05-01T10:00:00+05:30" }] }).success).toBe(true);
  });

  it("rejects a plain date string without time", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, ts: "2025-05-01" }] }).success).toBe(false);
  });

  it("rejects a non-date string", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, ts: "not-a-date" }] }).success).toBe(false);
  });
});

// ============================================================================
// session_id
// ============================================================================

describe("bodySchema — event.session_id", () => {
  it("accepts a non-empty session_id", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, session_id: "abc" }] }).success).toBe(true);
  });

  it("rejects an empty session_id", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, session_id: "" }] }).success).toBe(false);
  });
});

// ============================================================================
// seq
// ============================================================================

describe("bodySchema — event.seq", () => {
  it("accepts seq = 0", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, seq: 0 }] }).success).toBe(true);
  });

  it("accepts positive integers", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, seq: 100 }] }).success).toBe(true);
  });

  it("rejects negative seq", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, seq: -1 }] }).success).toBe(false);
  });

  it("rejects non-integer seq", () => {
    expect(parseBody({ events: [{ ...VALID_EVENT, seq: 1.5 }] }).success).toBe(false);
  });
});

// ============================================================================
// data field
// ============================================================================

describe("bodySchema — event.data", () => {
  it("defaults to {} when data is omitted", () => {
    const result = parseBody({ events: [VALID_EVENT] });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.events[0].data).toEqual({});
  });

  it("accepts arbitrary key-value pairs in data", () => {
    const event = { ...VALID_EVENT, data: { tool_name: "Read", duration_ms: 42 } };
    expect(parseBody({ events: [event] }).success).toBe(true);
  });
});
