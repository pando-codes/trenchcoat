import { describe, it, expect } from "bun:test";
import { summariseAgentTimeseries } from "../agent-timeseries";

describe("summariseAgentTimeseries", () => {
  it("totals invocations, tokens, cost and derives avg cost/call", () => {
    const s = summariseAgentTimeseries([
      { bucket: "2025-04-01", invocations: 2, input_tokens: 100, output_tokens: 20, cost_usd: 0.10, p50_latency_ms: null, latency_sample_count: 0 },
      { bucket: "2025-04-02", invocations: 3, input_tokens: 200, output_tokens: 30, cost_usd: 0.20, p50_latency_ms: null, latency_sample_count: 0 },
    ]);
    expect(s.totalInvocations).toBe(5);
    expect(s.totalInputTokens).toBe(300);
    expect(s.totalOutputTokens).toBe(50);
    expect(s.totalCostUsd).toBeCloseTo(0.30);
    expect(s.avgCostPerCall).toBeCloseTo(0.06);
  });

  it("handles empty input", () => {
    const s = summariseAgentTimeseries([]);
    expect(s.totalInvocations).toBe(0);
    expect(s.avgCostPerCall).toBeNull();
  });

  it("summarises latency across buckets with samples", () => {
    const s = summariseAgentTimeseries([
      { bucket: "d1", invocations: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0,
        p50_latency_ms: 1000, latency_sample_count: 2 },
      { bucket: "d2", invocations: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0,
        p50_latency_ms: 2000, latency_sample_count: 2 },
    ]);
    expect(s.latencySampleCount).toBe(4);
    expect(s.medianLatencyMs).toBeCloseTo(1500); // sample-weighted mean of bucket medians
  });

  it("returns null latency when no samples exist", () => {
    const s = summariseAgentTimeseries([
      { bucket: "d1", invocations: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0,
        p50_latency_ms: null, latency_sample_count: 0 },
    ]);
    expect(s.medianLatencyMs).toBeNull();
    expect(s.latencySampleCount).toBe(0);
  });
});
