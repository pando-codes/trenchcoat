import { describe, it, expect } from "bun:test";
import { isLowSample, metricNames, deltaVsBaseline } from "../eval-comparison";
import type { EvalVariantStat } from "@/types/analytics";

function variant(p: Partial<EvalVariantStat> & { eval_variant: string }): EvalVariantStat {
  return {
    eval_variant: p.eval_variant,
    session_count: p.session_count ?? 5,
    total_input_tokens: p.total_input_tokens ?? 0,
    total_output_tokens: p.total_output_tokens ?? 0,
    total_cost_usd: p.total_cost_usd ?? 0,
    avg_duration_ms: p.avg_duration_ms ?? null,
    scores: p.scores ?? {},
  };
}

describe("isLowSample", () => {
  it("flags fewer than 3 sessions", () => {
    expect(isLowSample(1)).toBe(true);
    expect(isLowSample(2)).toBe(true);
    expect(isLowSample(3)).toBe(false);
  });
});

describe("metricNames", () => {
  it("returns the sorted union of metrics across variants", () => {
    const vs = [
      variant({ eval_variant: "v2", scores: { accuracy: { avg: 0.6, count: 3 } } }),
      variant({ eval_variant: "v3", scores: { accuracy: { avg: 0.8, count: 3 }, cost_score: { avg: 1, count: 3 } } }),
    ];
    expect(metricNames(vs)).toEqual(["accuracy", "cost_score"]);
  });

  it("returns an empty array when no variant has scores", () => {
    expect(metricNames([variant({ eval_variant: "v1" })])).toEqual([]);
  });
});

describe("deltaVsBaseline", () => {
  it("computes the second variant's delta against the first for a metric", () => {
    const vs = [
      variant({ eval_variant: "v2", scores: { accuracy: { avg: 0.60, count: 5 } } }),
      variant({ eval_variant: "v3", scores: { accuracy: { avg: 0.75, count: 5 } } }),
    ];
    expect(deltaVsBaseline(vs, "accuracy")).toBeCloseTo(0.15);
  });

  it("returns null unless there are exactly two variants", () => {
    const one = [variant({ eval_variant: "v2", scores: { accuracy: { avg: 0.6, count: 5 } } })];
    expect(deltaVsBaseline(one, "accuracy")).toBeNull();
  });

  it("returns null when either variant lacks the metric", () => {
    const vs = [
      variant({ eval_variant: "v2" }),
      variant({ eval_variant: "v3", scores: { accuracy: { avg: 0.75, count: 5 } } }),
    ];
    expect(deltaVsBaseline(vs, "accuracy")).toBeNull();
  });
});
