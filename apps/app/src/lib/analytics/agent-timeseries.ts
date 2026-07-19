import type { AgentTimeseriesPoint } from "@/types/analytics";

export interface AgentTimeseriesSummary {
  totalInvocations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgCostPerCall: number | null;
  /**
   * Sample-weighted mean of the per-bucket p50 latencies. This is an
   * approximation of the overall median (not a true recomputed median across
   * all individual samples), weighted by each bucket's sample count so that
   * buckets with more samples contribute proportionally more.
   */
  medianLatencyMs: number | null;
  latencySampleCount: number;
}

export function summariseAgentTimeseries(points: AgentTimeseriesPoint[]): AgentTimeseriesSummary {
  const totals = points.reduce(
    (acc, p) => ({
      inv: acc.inv + p.invocations,
      inTok: acc.inTok + p.input_tokens,
      outTok: acc.outTok + p.output_tokens,
      cost: acc.cost + p.cost_usd,
    }),
    { inv: 0, inTok: 0, outTok: 0, cost: 0 }
  );

  let latencyWeighted = 0;
  let latencySamples = 0;
  for (const p of points) {
    if (p.p50_latency_ms !== null && p.latency_sample_count > 0) {
      latencyWeighted += p.p50_latency_ms * p.latency_sample_count;
      latencySamples += p.latency_sample_count;
    }
  }

  return {
    totalInvocations: totals.inv,
    totalInputTokens: totals.inTok,
    totalOutputTokens: totals.outTok,
    totalCostUsd: totals.cost,
    avgCostPerCall: totals.inv > 0 ? totals.cost / totals.inv : null,
    medianLatencyMs: latencySamples > 0 ? latencyWeighted / latencySamples : null,
    latencySampleCount: latencySamples,
  };
}
