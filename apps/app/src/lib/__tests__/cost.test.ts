import { describe, it, expect } from "bun:test";
import { computeCost, formatCost } from "../cost";

const rates = {
  "claude-3-5-sonnet": { input_cost_per_1m: 3.0, output_cost_per_1m: 15.0 },
  "claude-3-haiku": { input_cost_per_1m: 0.25, output_cost_per_1m: 1.25 },
};

// --- computeCost ---

describe("computeCost", () => {
  it("computes cost for both token counts", () => {
    const result = computeCost(1_000_000, 1_000_000, "claude-3-5-sonnet", rates);
    expect(result).toBe(18.0); // 3.0 + 15.0
  });

  it("returns null when both tokens are null", () => {
    expect(computeCost(null, null, "claude-3-5-sonnet", rates)).toBeNull();
  });

  it("returns null for unknown model", () => {
    expect(computeCost(1000, 500, "unknown-model", rates)).toBeNull();
  });

  it("returns null when model is null", () => {
    expect(computeCost(1000, 500, null, rates)).toBeNull();
  });

  it("treats null input_tokens as 0", () => {
    const result = computeCost(null, 1_000_000, "claude-3-5-sonnet", rates);
    expect(result).toBe(15.0);
  });

  it("treats null output_tokens as 0", () => {
    const result = computeCost(1_000_000, null, "claude-3-5-sonnet", rates);
    expect(result).toBe(3.0);
  });

  it("returns 0 for zero tokens", () => {
    expect(computeCost(0, 0, "claude-3-5-sonnet", rates)).toBe(0);
  });

  it("scales proportionally for partial token counts", () => {
    const result = computeCost(500_000, 500_000, "claude-3-5-sonnet", rates);
    expect(result).toBeCloseTo(9.0, 6);
  });

  it("uses per-model rates independently", () => {
    const haiku = computeCost(1_000_000, 1_000_000, "claude-3-haiku", rates);
    expect(haiku).toBeCloseTo(1.5, 6); // 0.25 + 1.25
  });
});

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
