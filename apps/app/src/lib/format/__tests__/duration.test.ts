import { describe, it, expect } from "bun:test";
import { formatDuration } from "../duration";

describe("formatDuration", () => {
  it("returns -- for null", () => {
    expect(formatDuration(null)).toBe("--");
  });

  it("renders sub-hour durations in minutes", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(90_000)).toBe("1m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("renders hour-plus durations as h m", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h 0m");
    expect(formatDuration(95 * 60_000)).toBe("1h 35m");
  });
});
