import { describe, it, expect } from "bun:test";
import { formatUsd, formatTokens, avgCostPerCall } from "../agents";

describe("formatUsd", () => {
  it("uses 4 decimals under $1 and 2 at/above $1", () => {
    expect(formatUsd(0.4234)).toBe("$0.4234");
    expect(formatUsd(12.5)).toBe("$12.50");
  });
  it("renders -- for null", () => { expect(formatUsd(null)).toBe("--"); });
});

describe("formatTokens", () => {
  it("abbreviates thousands", () => { expect(formatTokens(90000)).toBe("90.0k"); });
  it("keeps small counts", () => { expect(formatTokens(512)).toBe("512"); });
  it("renders -- for null", () => { expect(formatTokens(null)).toBe("--"); });
});

describe("avgCostPerCall", () => {
  it("divides total by count", () => { expect(avgCostPerCall(1.2, 4)).toBeCloseTo(0.3); });
  it("returns null on zero count or null total", () => {
    expect(avgCostPerCall(1.2, 0)).toBeNull();
    expect(avgCostPerCall(null, 4)).toBeNull();
  });
});
