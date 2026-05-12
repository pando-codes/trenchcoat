export interface RateLimitConfig {
  limit: number;
  windowMs: number;
  prefix?: string;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  limit: number;
  reset: number;
  retryAfter: number;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

class MemoryStore {
  private store = new Map<string, RateLimitEntry>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60000);
  }

  get(key: string): RateLimitEntry | undefined {
    const entry = this.store.get(key);
    if (entry && Date.now() >= entry.resetTime) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, entry: RateLimitEntry): void {
    this.store.set(key, entry);
  }

  increment(key: string, windowMs: number): RateLimitEntry {
    const now = Date.now();
    const existing = this.get(key);

    if (existing) {
      existing.count++;
      return existing;
    }

    const entry: RateLimitEntry = { count: 1, resetTime: now + windowMs };
    this.store.set(key, entry);
    return entry;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetTime) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}

const globalStore = new MemoryStore();

export function createRateLimiter(config: RateLimitConfig) {
  const { limit, windowMs, prefix = "rl" } = config;

  return {
    async check(identifier: string): Promise<RateLimitResult> {
      const key = `${prefix}:${identifier}`;
      const entry = globalStore.increment(key, windowMs);
      const now = Date.now();
      const remaining = Math.max(0, limit - entry.count);
      const success = entry.count <= limit;
      const retryAfter = success ? 0 : entry.resetTime - now;

      return { success, remaining, limit, reset: entry.resetTime, retryAfter };
    },
    async reset(identifier: string): Promise<void> {
      const key = `${prefix}:${identifier}`;
      globalStore.set(key, { count: 0, resetTime: Date.now() + windowMs });
    },
  };
}

export function getClientIdentifier(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;

  const userAgent = request.headers.get("user-agent") || "unknown";
  const acceptLang = request.headers.get("accept-language") || "unknown";
  let hash = 0;
  const str = userAgent + acceptLang;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `fingerprint:${Math.abs(hash).toString(36)}`;
}

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": result.limit.toString(),
    "X-RateLimit-Remaining": result.remaining.toString(),
    "X-RateLimit-Reset": result.reset.toString(),
    ...(result.retryAfter > 0 && {
      "Retry-After": Math.ceil(result.retryAfter / 1000).toString(),
    }),
  };
}
