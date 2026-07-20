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

export type MethodCall = { method: string; args: unknown[] };

function makeChain(result: MockResult, calls?: MethodCall[]) {
  const resolved = {
    data: result.data ?? null,
    error: result.error ?? null,
    count: result.count ?? null,
  };

  const chain: Record<string, unknown> = {};
  const noop = () => chain;
  const spy =
    (method: string) =>
    (...args: unknown[]) => {
      calls?.push({ method, args });
      return chain;
    };

  Object.assign(chain, {
    select: calls ? spy("select") : noop,
    insert: calls ? spy("insert") : noop,
    update: calls ? spy("update") : noop,
    delete: calls ? spy("delete") : noop,
    upsert: calls ? spy("upsert") : noop,
    eq: calls ? spy("eq") : noop,
    neq: calls ? spy("neq") : noop,
    gte: calls ? spy("gte") : noop,
    lte: calls ? spy("lte") : noop,
    in: calls ? spy("in") : noop,
    order: calls ? spy("order") : noop,
    range: calls ? spy("range") : noop,
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
    rpc: (name: string, params?: object) => {
      const r = dequeue(rpcs, name);
      return Promise.resolve({ data: r.data ?? null, error: r.error ?? null });
    },
  } as unknown as SupabaseClient;
}

/**
 * Variant that records every chainable method call so tests can assert
 * which methods were called and with which arguments.
 *
 * Usage:
 *   const { client, calls } = createSpySupabase({ user_profiles: { data: row } });
 *   await getProfile(client, userId);
 *   expect(calls.some(c => c.method === "eq" && c.args[0] === "id")).toBe(true);
 */
export function createSpySupabase(
  tableQueues: Record<string, MockResult | MockResult[]> = {}
): { client: SupabaseClient; calls: MethodCall[] } {
  const tables: Record<string, MockResult[]> = {};
  for (const [k, v] of Object.entries(tableQueues)) {
    tables[k] = Array.isArray(v) ? [...v] : [v];
  }

  const calls: MethodCall[] = [];

  const client = {
    from: (table: string) => makeChain(dequeue(tables, table), calls),
    rpc: () => Promise.resolve({ data: null, error: null }),
  } as unknown as SupabaseClient;

  return { client, calls };
}
