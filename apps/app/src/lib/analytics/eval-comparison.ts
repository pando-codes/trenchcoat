import type { EvalVariantStat } from "@/types/analytics";

/** Below this many sessions, an average is annotated rather than presented as comparable. */
export const LOW_SAMPLE_THRESHOLD = 3;

export function isLowSample(sessionCount: number): boolean {
  return sessionCount < LOW_SAMPLE_THRESHOLD;
}

export function metricNames(variants: EvalVariantStat[]): string[] {
  const names = new Set<string>();
  for (const v of variants) {
    for (const name of Object.keys(v.scores ?? {})) names.add(name);
  }
  return [...names].sort();
}

/**
 * Delta of the second variant's metric against the first (the baseline).
 * Only defined for an exactly-two-variant comparison where both carry the metric.
 */
export function deltaVsBaseline(variants: EvalVariantStat[], metric: string): number | null {
  if (variants.length !== 2) return null;
  const [baseline, candidate] = variants;
  const b = baseline.scores?.[metric];
  const c = candidate.scores?.[metric];
  if (!b || !c) return null;
  return c.avg - b.avg;
}
