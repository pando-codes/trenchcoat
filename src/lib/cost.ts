export type RateMap = Record<string, { input_cost_per_1m: number; output_cost_per_1m: number }>;

export function computeCost(
  inputTokens: number | null,
  outputTokens: number | null,
  model: string | null,
  rates: RateMap
): number | null {
  if (inputTokens == null && outputTokens == null) return null;
  if (!model || !rates[model]) return null;
  const rate = rates[model];
  return (
    ((inputTokens ?? 0) * rate.input_cost_per_1m +
      (outputTokens ?? 0) * rate.output_cost_per_1m) /
    1_000_000
  );
}

export function formatCost(usd: number | null | undefined): string {
  if (usd == null) return "--";
  if (usd === 0) return "$0.00";
  if (usd < 0.0001) return "<$0.0001";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}
