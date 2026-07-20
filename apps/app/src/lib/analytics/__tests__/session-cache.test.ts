import { describe, it, expect } from "bun:test";
import { summariseSessionCache } from "../session-cache";
import type { SessionCost } from "@/types/analytics";

function cost(p: Partial<SessionCost>): SessionCost {
  return {
    session_id: p.session_id ?? "s1",
    input_tokens: p.input_tokens ?? 0,
    output_tokens: p.output_tokens ?? 0,
    cache_creation_tokens: p.cache_creation_tokens ?? null,
    cache_read_tokens: p.cache_read_tokens ?? null,
    cost_usd: p.cost_usd ?? null,
  };
}

describe("summariseSessionCache", () => {
  it("reports not captured when both cache columns are null", () => {
    const s = summariseSessionCache(cost({ cache_creation_tokens: null, cache_read_tokens: null }));
    expect(s.captured).toBe(false);
    expect(s.hitRatio).toBeNull();
  });

  it("reports captured when the columns are zero", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 0, cache_read_tokens: 0, input_tokens: 100 })
    );
    expect(s.captured).toBe(true);
    expect(s.creationTokens).toBe(0);
    expect(s.readTokens).toBe(0);
    expect(s.hitRatio).toBe(0);
  });

  it("computes hit ratio as read / (read + input)", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 500, cache_read_tokens: 900, input_tokens: 100 })
    );
    expect(s.hitRatio).toBeCloseTo(0.9, 6);
  });

  it("returns a null ratio when read and input are both zero", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 42, cache_read_tokens: 0, input_tokens: 0 })
    );
    expect(s.captured).toBe(true);
    expect(s.hitRatio).toBeNull();
  });

  it("treats a single populated column as captured", () => {
    const s = summariseSessionCache(
      cost({ cache_creation_tokens: 10, cache_read_tokens: null, input_tokens: 90 })
    );
    expect(s.captured).toBe(true);
    expect(s.readTokens).toBe(0);
  });

  it("reports not captured for a missing cost row", () => {
    const s = summariseSessionCache(undefined);
    expect(s.captured).toBe(false);
    expect(s.creationTokens).toBe(0);
    expect(s.hitRatio).toBeNull();
  });
});
