import type { SessionCost } from "@/types/analytics";

export interface SessionCacheSummary {
  /** False when the plugin predates 1.3.3 — render "Not captured", not "0". */
  captured: boolean;
  creationTokens: number;
  readTokens: number;
  /** read / (read + input). Null when the denominator is zero. */
  hitRatio: number | null;
}

const NOT_CAPTURED: SessionCacheSummary = {
  captured: false,
  creationTokens: 0,
  readTokens: 0,
  hitRatio: null,
};

export function summariseSessionCache(cost: SessionCost | undefined): SessionCacheSummary {
  if (!cost) return NOT_CAPTURED;

  const captured = cost.cache_creation_tokens !== null || cost.cache_read_tokens !== null;
  if (!captured) return NOT_CAPTURED;

  const creationTokens = cost.cache_creation_tokens ?? 0;
  const readTokens = cost.cache_read_tokens ?? 0;
  const denominator = readTokens + cost.input_tokens;

  return {
    captured: true,
    creationTokens,
    readTokens,
    hitRatio: denominator > 0 ? readTokens / denominator : null,
  };
}
