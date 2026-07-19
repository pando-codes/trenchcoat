import type { AgentTimeseriesPoint } from "@/types/analytics";

export interface AgentTimeseriesSummary {
  totalInvocations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgCostPerCall: number | null;
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
  return {
    totalInvocations: totals.inv,
    totalInputTokens: totals.inTok,
    totalOutputTokens: totals.outTok,
    totalCostUsd: totals.cost,
    avgCostPerCall: totals.inv > 0 ? totals.cost / totals.inv : null,
  };
}
