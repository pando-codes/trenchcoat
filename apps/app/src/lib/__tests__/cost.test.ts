import { describe, it, expect } from "bun:test";
import { formatCost } from "../cost";

// --- formatCost ---

describe("formatCost", () => {
  it("returns '--' for null", () => {
    expect(formatCost(null)).toBe("--");
  });

  it("returns '--' for undefined", () => {
    expect(formatCost(undefined)).toBe("--");
  });

  it("returns '$0.00' for zero", () => {
    expect(formatCost(0)).toBe("$0.00");
  });

  it("returns '<$0.0001' for values below threshold", () => {
    expect(formatCost(0.000001)).toBe("<$0.0001");
    expect(formatCost(0.00009)).toBe("<$0.0001");
  });

  it("returns 4-decimal format for values in [0.0001, 0.01)", () => {
    expect(formatCost(0.0001)).toBe("$0.0001");
    expect(formatCost(0.005)).toBe("$0.0050");
  });

  it("returns 2-decimal format for values >= 0.01", () => {
    expect(formatCost(0.01)).toBe("$0.01");
    expect(formatCost(1.5)).toBe("$1.50");
    expect(formatCost(100)).toBe("$100.00");
  });
});
