export function formatUsd(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "--";
  return `$${v.toFixed(v < 1 ? 4 : 2)}`;
}

export function formatTokens(v: number | null): string {
  if (v === null || Number.isNaN(v)) return "--";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
}

export function avgCostPerCall(total: number | null, count: number): number | null {
  if (total === null || count <= 0) return null;
  return total / count;
}
