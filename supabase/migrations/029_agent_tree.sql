-- 029: Recursive agent tree for a session. Roots at true roots AND orphans
-- (parent not present in this session's agent set) so no node disappears.
-- Depth is computed here, never stored. Depth is capped to survive a cycle.

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
  estimated_cost_usd numeric
) language sql stable as $$
  with recursive scoped as (
    select a.agent_id, a.parent_agent_id, a.agent_type, a.edge_label,
           a.started_at, a.ended_at, a.duration_ms,
           a.input_tokens, a.output_tokens, a.model
    from public.agents a
    where a.user_id = p_user_id
      and a.session_id = p_session_id
  ),
  tree as (
    select s.agent_id, s.parent_agent_id, s.agent_type, s.edge_label,
           s.started_at, s.ended_at, s.duration_ms,
           s.input_tokens, s.output_tokens, s.model,
           0 as depth
    from scoped s
    where s.parent_agent_id is null
       or not exists (
            select 1 from scoped p where p.agent_id = s.parent_agent_id
          )

    union all

    select c.agent_id, c.parent_agent_id, c.agent_type, c.edge_label,
           c.started_at, c.ended_at, c.duration_ms,
           c.input_tokens, c.output_tokens, c.model,
           t.depth + 1
    from scoped c
    join tree t on c.parent_agent_id = t.agent_id
    where t.depth < 50
  )
  select
    t.agent_id,
    t.parent_agent_id,
    t.agent_type,
    t.edge_label,
    t.depth,
    t.started_at,
    t.ended_at,
    coalesce(t.duration_ms, 0)::bigint   as duration_ms,
    coalesce(t.input_tokens, 0)::bigint  as input_tokens,
    coalesce(t.output_tokens, 0)::bigint as output_tokens,
    round((
      coalesce(t.input_tokens,  0) * coalesce(mp.input_cost_per_1m,  0) / 1000000.0 +
      coalesce(t.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
    )::numeric, 6) as estimated_cost_usd
  from tree t
  left join public.model_pricing mp on mp.model_id = t.model
  order by t.depth, t.started_at nulls last;
$$;
