-- 030: Cache-aware cost. Adds cache rates to pricing and result-sourced token
-- columns to agents. The result_* columns are written ONLY by the Agent
-- tool_result branch, preserving single-writer ownership; the read side
-- decides whether to use them.

alter table public.model_pricing
  add column if not exists cache_creation_cost_per_1m numeric(10, 6),
  add column if not exists cache_read_cost_per_1m     numeric(10, 6);

comment on column public.model_pricing.cache_creation_cost_per_1m is
  'Null means unknown, not free — readers fall back to input_cost_per_1m * 1.25.';
comment on column public.model_pricing.cache_read_cost_per_1m is
  'Null means unknown, not free — readers fall back to input_cost_per_1m * 0.10.';

alter table public.agents
  add column if not exists result_input_tokens          bigint,
  add column if not exists result_output_tokens         bigint,
  add column if not exists result_cache_creation_tokens bigint,
  add column if not exists result_cache_read_tokens     bigint;
