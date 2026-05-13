import { describe, it, expect, beforeAll, afterAll, setSystemTime } from "bun:test";
import { parseDateRange } from "../date-range";

// Pin time to a known date so the 30-day default is deterministic.
// 2025-05-15 minus 30 days = 2025-04-15.
const FIXED_NOW = new Date("2025-05-15T12:00:00.000Z");

describe("parseDateRange", () => {
  beforeAll(() => setSystemTime(FIXED_NOW));
  afterAll(() => setSystemTime());

  it("passes through explicit from and to unchanged", () => {
    expect(parseDateRange("2025-01-01", "2025-01-31")).toEqual({
      p_from: "2025-01-01",
      p_to: "2025-01-31",
    });
  });

  it("defaults p_to to today when omitted", () => {
    const { p_to } = parseDateRange("2025-01-01");
    expect(p_to).toBe("2025-05-15");
  });

  it("defaults p_from to 30 days ago when omitted", () => {
    const { p_from } = parseDateRange(undefined, "2025-05-15");
    expect(p_from).toBe("2025-04-15");
  });

  it("defaults both when called with no arguments", () => {
    expect(parseDateRange()).toEqual({
      p_from: "2025-04-15",
      p_to: "2025-05-15",
    });
  });

  it("returns date strings in YYYY-MM-DD format", () => {
    const { p_from, p_to } = parseDateRange();
    expect(p_from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p_to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
