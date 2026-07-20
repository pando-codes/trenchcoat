-- 033: Single pricing authority.
--
-- The cache-rate fallback (creation = 1.25x input, read = 0.10x input) was
-- inlined in 031. get_session_cost (034) needs the identical ladder, so it is
-- extracted here and 031's copy is removed by recreating get_agent_tree
-- against it. After this migration the 1.25/0.10 ratios exist in exactly one
-- place in the repo.
--
-- Behaviour change: a model with no model_pricing row now prices as NULL, not
-- 0. The `select ... from model_pricing where model_id = p_model` returns no
-- row for an unknown model, so the function returns null. 031 coalesced every
-- rate to 0, which rendered unpriced models as a confident $0.00 -- the exact
-- failure mode that made Spec E's $0.000000 read as a rendering bug.

create or replace function public.price_tokens(
  p_model          text,
  p_input          bigint,
  p_output         bigint,
  p_cache_creation bigint,
  p_cache_read     bigint
) returns numeric
language sql
stable
as $$
  select round((
    coalesce(p_input,  0) * coalesce(mp.input_cost_per_1m,  0) / 1000000.0 +
    coalesce(p_output, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0 +
    coalesce(p_cache_creation, 0) *
      coalesce(mp.cache_creation_cost_per_1m, mp.input_cost_per_1m * 1.25, 0) / 1000000.0 +
    coalesce(p_cache_read, 0) *
      coalesce(mp.cache_read_cost_per_1m,     mp.input_cost_per_1m * 0.10, 0) / 1000000.0
  )::numeric, 6)
  from public.model_pricing mp
  where mp.model_id = p_model;
$$;

drop function if exists public.get_agent_tree(uuid, text);
create or replace function public.get_agent_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  agent_id              text,
  parent_agent_id       text,
  agent_type            text,
  edge_label            text,
  depth                 int,
  started_at            timestamptz,
  ended_at              timestamptz,
  duration_ms           bigint,
  input_tokens          bigint,
  output_tokens         bigint,
  cache_creation_tokens bigint,
  cache_read_tokens     bigint,
  estimated_cost_usd    numeric,
  status                text,
  model                 text,
  tool_count            integer
) language sql stable as $$
  with recursive scoped as (
    select a.agent_id, a.parent_agent_id, a.agent_type, a.edge_label,
           a.started_at, a.ended_at, a.duration_ms,
           a.input_tokens, a.output_tokens, a.model,
           a.status, a.tool_count,
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
    public.price_tokens(e.model, e.e_input::bigint, e.e_output::bigint,
                        e.e_cache_creation::bigint, e.e_cache_read::bigint)
                                       as estimated_cost_usd,
    e.status,
    e.model,
    e.tool_count
  from eff e
  order by e.depth, e.started_at nulls last;
$$;
