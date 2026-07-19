import { describe, it, expect } from "bun:test";
import { formatLatency } from "../agents";

describe("formatLatency", () => {
  it("renders seconds with one decimal at/above 1000ms", () => {
    expect(formatLatency(4300, 10)).toBe("4.3s");
  });
  it("renders milliseconds below 1000ms", () => {
    expect(formatLatency(850, 10)).toBe("850ms");
  });
  it("renders -- when null", () => {
    expect(formatLatency(null, 0)).toBe("--");
  });
  it("renders -- when there are no samples", () => {
    expect(formatLatency(1200, 0)).toBe("--");
  });
});
