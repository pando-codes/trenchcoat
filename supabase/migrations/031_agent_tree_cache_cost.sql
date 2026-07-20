-- 031: Cache-aware agent cost.
-- Prefers subagent_stop tokens; falls back to the Agent tool_response usage
-- breakdown when they are absent OR zero (nullif) — a stop-derived 0 means
-- "transcript parse failed", not "genuinely zero", which was the $0-cost bug.
-- Cache tokens dominate real usage and are priced with synced rates, falling
-- back to Anthropic's documented ratios (1.25x / 0.10x of input) when unknown.

drop function if exists public.get_agent_tree(uuid, text);
create or replace function public.get_agent_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  agent_id           text,
  parent_agent_id    text,
  agent_type         text,
  edge_label         text,
  depth              int,
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_ms        bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  cache_creation_tokens bigint,
  cache_read_tokens     bigint,
  estimated_cost_usd numeric
) language sql stable as $$
  with recursive scoped as (
    select a.agent_id, a.parent_agent_id, a.agent_type, a.edge_label,
           a.started_at, a.ended_at, a.duration_ms,
           a.input_tokens, a.output_tokens, a.model,
           a.result_input_tokens, a.result_output_tokens,
           a.result_cache_creation_tokens, a.result_cache_read_tokens
    from public.agents a
    where a.user_id = p_user_id
      and a.session_id = p_session_id
  ),
  tree as (
    select s.*, 0 as depth
    from scoped s
    where s.parent_agent_id is null
       or not exists (select 1 from scoped p where p.agent_id = s.parent_agent_id)

    union all

    select c.*, t.depth + 1
    from scoped c
    join tree t on c.parent_agent_id = t.agent_id
    where t.depth < 50
  ),
  eff as (
    select
      t.*,
      coalesce(nullif(t.input_tokens,  0), t.result_input_tokens,  0) as e_input,
      coalesce(nullif(t.output_tokens, 0), t.result_output_tokens, 0) as e_output,
      coalesce(t.result_cache_creation_tokens, 0) as e_cache_creation,
      coalesce(t.result_cache_read_tokens,     0) as e_cache_read
    from tree t
  )
  select
    e.agent_id,
    e.parent_agent_id,
    e.agent_type,
    e.edge_label,
    e.depth,
    e.started_at,
    e.ended_at,
    coalesce(e.duration_ms, 0)::bigint as duration_ms,
    e.e_input::bigint                  as input_tokens,
    e.e_output::bigint                 as output_tokens,
    e.e_cache_creation::bigint         as cache_creation_tokens,
    e.e_cache_read::bigint             as cache_read_tokens,
    round((
      e.e_input  * coalesce(mp.input_cost_per_1m,  0) / 1000000.0 +
      e.e_output * coalesce(mp.output_cost_per_1m, 0) / 1000000.0 +
      -- Cache rates: synced when available, else Anthropic's documented
      -- ratios (creation 1.25x input, read 0.10x input). Approximation.
      e.e_cache_creation *
        coalesce(mp.cache_creation_cost_per_1m, mp.input_cost_per_1m * 1.25, 0) / 1000000.0 +
      e.e_cache_read *
        coalesce(mp.cache_read_cost_per_1m,     mp.input_cost_per_1m * 0.10, 0) / 1000000.0
    )::numeric, 6) as estimated_cost_usd
  from eff e
  left join public.model_pricing mp on mp.model_id = e.model
  order by e.depth, e.started_at nulls last;
$$;
