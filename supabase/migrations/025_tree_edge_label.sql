-- 025: expose the spawn edge_label on each session-tree node.
drop function if exists public.get_session_tree(uuid, text);
create or replace function public.get_session_tree(
  p_user_id    uuid,
  p_session_id text
) returns table (
  session_id         text,
  parent_session_id  text,
  spawner_id         text,
  spawner_type       text,
  depth              int,
  started_at         timestamptz,
  ended_at           timestamptz,
  duration_ms        bigint,
  tool_count         bigint,
  skill_count        bigint,
  subagent_count     bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  estimated_cost_usd numeric,
  edge_label         text
) language sql stable as $$
  with recursive tree as (
    select s.session_id, s.parent_session_id, s.spawner_id, s.spawner_type,
           0 as depth, s.started_at, s.ended_at
    from public.sessions s
    where s.session_id = p_session_id and s.user_id = p_user_id
    union all
    select s.session_id, s.parent_session_id, s.spawner_id, s.spawner_type,
           t.depth + 1, s.started_at, s.ended_at
    from public.sessions s
    join tree t on s.parent_session_id = t.session_id
    where s.user_id = p_user_id
  )
  select
    t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type, t.depth,
    t.started_at, t.ended_at,
    coalesce(max(s2.duration_ms), 0)::bigint                   as duration_ms,
    count(e.id) filter (where e.event_type = 'tool_use')       as tool_count,
    count(e.id) filter (where e.event_type = 'skill_use')      as skill_count,
    count(e.id) filter (where e.event_type = 'subagent_stop')  as subagent_count,
    coalesce(max(s2.input_tokens),  0)::bigint                 as input_tokens,
    coalesce(max(s2.output_tokens), 0)::bigint                 as output_tokens,
    round((
      coalesce(max(s2.input_tokens),  0) * coalesce(max(mp.input_cost_per_1m),  0) / 1000000.0 +
      coalesce(max(s2.output_tokens), 0) * coalesce(max(mp.output_cost_per_1m), 0) / 1000000.0
    )::numeric, 6) as estimated_cost_usd,
    max(el.edge_label) as edge_label
  from tree t
  left join public.events e   on e.session_id  = t.session_id and e.user_id = p_user_id
  left join public.sessions s2 on s2.session_id = t.session_id and s2.user_id = p_user_id
  left join public.model_pricing mp on mp.model_id = s2.model
  left join lateral (
    select ev.data->>'edge_label' as edge_label
    from public.events ev
    where ev.user_id = p_user_id
      and ev.event_type in ('tool_use', 'tool_result')
      and ev.data->>'agent_id' = t.spawner_id
      and ev.data->>'edge_label' is not null
    limit 1
  ) el on true
  group by t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type,
           t.depth, t.started_at, t.ended_at
  order by t.depth, t.started_at;
$$;
