/**
 * Minimal Supabase client mock for unit-testing services.
 *
 * Services accept an injected SupabaseClient, so we pass a mock that returns
 * pre-configured results without making network calls.
 *
 * createMockSupabase() accepts:
 *   tableQueues — per-table result(s). A single object is used for every call;
 *                 an array is consumed in order (last entry stays for extra calls).
 *   rpcQueues   — same shape, keyed by RPC function name.
 *
 * The mock chain is fully chainable (select/insert/update/delete/eq/etc. all
 * return `this`). `.single()` resolves with { data, error }; awaiting the chain
 * directly resolves with { data, error, count }.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MockResult = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
  count?: number | null;
};

function makeChain(result: MockResult) {
  const resolved = {
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  };

  const chain: Record<string, unknown> = {};
  const noop = () => chain;

  Object.assign(chain, {
    select: noop,
    insert: noop,
    update: noop,
    delete: noop,
    upsert: noop,
    eq: noop,
    neq: noop,
    gte: noop,
    lte: noop,
    in: noop,
    order: noop,
    range: noop,
    single: () => Promise.resolve({ data: resolved.data, error: resolved.error }),
    then: (
      resolve: (v: typeof resolved) => unknown,
      reject: (r: unknown) => unknown
    ) => Promise.resolve(resolved).then(resolve, reject),
  });

  return chain;
}

function dequeue(
  queues: Record<string, MockResult[]>,
  key: string
): MockResult {
  const q = queues[key];
  if (!q || q.length === 0) return {};
  return q.length === 1 ? q[0] : q.shift()!;
}

export function createMockSupabase(
  tableQueues: Record<string, MockResult | MockResult[]> = {},
  rpcQueues: Record<string, MockResult | MockResult[]> = {}
): SupabaseClient {
  const tables: Record<string, MockResult[]> = {};
  for (const [k, v] of Object.entries(tableQueues)) {
    tables[k] = Array.isArray(v) ? [...v] : [v];
  }

  const rpcs: Record<string, MockResult[]> = {};
  for (const [k, v] of Object.entries(rpcQueues)) {
    rpcs[k] = Array.isArray(v) ? [...v] : [v];
  }

  return {
    from: (table: string) => makeChain(dequeue(tables, table)),
    rpc: (name: string) => {
      const r = dequeue(rpcs, name);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  } as unknown as SupabaseClient;
}
