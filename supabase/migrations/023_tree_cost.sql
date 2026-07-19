-- 023: add duration + cost to spawn-tree RPCs.

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
  estimated_cost_usd numeric
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
    round(coalesce(
      max(s2.input_tokens)  * max(mp.input_cost_per_1m)  / 1000000.0 +
      max(s2.output_tokens) * max(mp.output_cost_per_1m) / 1000000.0, 0)::numeric, 6) as estimated_cost_usd
  from tree t
  left join public.events e   on e.session_id  = t.session_id and e.user_id = p_user_id
  left join public.sessions s2 on s2.session_id = t.session_id and s2.user_id = p_user_id
  left join public.model_pricing mp on mp.model_id = s2.model
  group by t.session_id, t.parent_session_id, t.spawner_id, t.spawner_type,
           t.depth, t.started_at, t.ended_at
  order by t.depth, t.started_at;
$$;

drop function if exists public.get_entity_rollup(uuid, text, text, date, date);
create or replace function public.get_entity_rollup(
  p_user_id      uuid,
  p_spawner_id   text,
  p_spawner_type text,
  p_date_from    date,
  p_date_to      date
) returns table (
  total_tools        bigint,
  total_skills       bigint,
  total_subagents    bigint,
  input_tokens       bigint,
  output_tokens      bigint,
  estimated_cost_usd numeric
) language sql stable as $$
  with recursive descendant_sessions as (
    select session_id, input_tokens, output_tokens, model
    from public.sessions
    where spawner_id = p_spawner_id and spawner_type = p_spawner_type
      and user_id = p_user_id
      and started_at::date between p_date_from and p_date_to
    union all
    select s.session_id, s.input_tokens, s.output_tokens, s.model
    from public.sessions s
    join descendant_sessions ds on s.parent_session_id = ds.session_id
    where s.user_id = p_user_id
  )
  select
    coalesce((select count(*) from public.events
      where user_id = p_user_id and event_type = 'tool_use'
        and data->>'spawner_id' = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to), 0)
    + coalesce((select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'tool_use'), 0) as total_tools,

    coalesce((select count(*) from public.events
      where user_id = p_user_id and event_type = 'skill_use'
        and data->>'spawner_id' = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to), 0)
    + coalesce((select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'skill_use'), 0) as total_skills,

    coalesce((select count(*) from public.events
      where user_id = p_user_id and event_type = 'subagent_stop'
        and data->>'spawner_id' = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to), 0)
    + coalesce((select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'subagent_stop'), 0) as total_subagents,

    coalesce((select sum(input_tokens)  from descendant_sessions), 0)::bigint as input_tokens,
    coalesce((select sum(output_tokens) from descendant_sessions), 0)::bigint as output_tokens,
    coalesce((
      select round(sum(
        coalesce(ds.input_tokens, 0)  * coalesce(mp.input_cost_per_1m, 0)  / 1000000.0 +
        coalesce(ds.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
      )::numeric, 6)
      from descendant_sessions ds
      left join public.model_pricing mp on mp.model_id = ds.model
    ), 0) as estimated_cost_usd;
$$;
