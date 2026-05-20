-- 019: Universal spawner chain
-- Adds parent session linkage columns to sessions and replaces
-- active_skill_id with spawner_id/spawner_type in RPC queries.

-- -----------------------------------------------------------------------
-- Sessions table: parent linkage columns
-- -----------------------------------------------------------------------
alter table public.sessions
  add column if not exists parent_session_id text,
  add column if not exists spawner_id        text,
  add column if not exists spawner_type      text
    check (spawner_type in ('skill', 'agent'));

create index if not exists idx_sessions_parent_session_id
  on public.sessions(parent_session_id)
  where parent_session_id is not null;

-- -----------------------------------------------------------------------
-- Drop old active_skill_id index (replaced by spawner_id below)
-- -----------------------------------------------------------------------
drop index if exists public.idx_events_active_skill_id;

create index if not exists idx_events_spawner_id
  on public.events (user_id, event_type, (data->>'spawner_id'))
  where event_type = 'tool_use';

-- -----------------------------------------------------------------------
-- Update get_skill_stats: active_skill_id → spawner_id + spawner_type,
-- add cross_session_tool_calls field.
-- -----------------------------------------------------------------------
create or replace function public.get_skill_stats(
  p_user_id uuid,
  p_from    date,
  p_to      date
)
returns json
language plpgsql
security definer
as $$
declare
  result json;
begin
  select coalesce(json_agg(s order by s.invocation_count desc), '[]'::json)
  into result
  from (
    select
      sk.skill_name,
      count(*)                                                    as invocation_count,
      coalesce(sum(sk.tool_calls_triggered), 0)                  as tool_calls_triggered,
      coalesce(sum(sk.cross_session_tool_calls), 0)              as cross_session_tool_calls,
      case
        when count(*) > 0
        then round(
          coalesce(sum(sk.tool_calls_triggered), 0)::numeric / count(*),
          1
        )
        else 0
      end                                                         as avg_tools_per_invocation
    from (
      select
        e.data->>'skill_name'    as skill_name,
        e.data->>'activation_id' as activation_id,
        -- Same-session tool calls attributed to this skill invocation
        (
          select count(*)
          from public.events te
          where te.user_id              = p_user_id
            and te.event_type           = 'tool_use'
            and te.data->>'spawner_id'  = e.data->>'activation_id'
            and te.data->>'spawner_type' = 'skill'
            and te.timestamp::date between p_from and p_to
        ) as tool_calls_triggered,
        -- Tool calls in subagent sessions spawned by this skill invocation
        (
          select count(*)
          from public.sessions s
          join public.events te2
            on te2.session_id = s.session_id
           and te2.user_id    = p_user_id
           and te2.event_type = 'tool_use'
          where s.user_id      = p_user_id
            and s.spawner_id   = e.data->>'activation_id'
            and s.spawner_type = 'skill'
        ) as cross_session_tool_calls
      from public.events e
      where e.user_id    = p_user_id
        and e.event_type = 'skill_use'
        and e.timestamp::date between p_from and p_to
    ) sk
    group by sk.skill_name
  ) s;

  return result;
end;
$$;

-- -----------------------------------------------------------------------
-- get_session_tree: recursive subtree rooted at a given session
-- -----------------------------------------------------------------------
create or replace function public.get_session_tree(
  p_user_id    uuid,
  p_session_id text
)
returns table (
  session_id        text,
  parent_session_id text,
  spawner_id        text,
  spawner_type      text,
  depth             int,
  started_at        timestamptz,
  ended_at          timestamptz,
  tool_count        bigint,
  skill_count       bigint,
  subagent_count    bigint,
  input_tokens      bigint,
  output_tokens     bigint
)
language sql stable
as $$
  with recursive tree as (
    select
      s.session_id,
      s.parent_session_id,
      s.spawner_id,
      s.spawner_type,
      0 as depth,
      s.started_at,
      s.ended_at
    from public.sessions s
    where s.session_id = p_session_id
      and s.user_id    = p_user_id

    union all

    select
      s.session_id,
      s.parent_session_id,
      s.spawner_id,
      s.spawner_type,
      t.depth + 1,
      s.started_at,
      s.ended_at
    from public.sessions s
    join tree t on s.parent_session_id = t.session_id
    where s.user_id = p_user_id
  )
  select
    t.session_id,
    t.parent_session_id,
    t.spawner_id,
    t.spawner_type,
    t.depth,
    t.started_at,
    t.ended_at,
    count(e.id) filter (where e.event_type = 'tool_use')      as tool_count,
    count(e.id) filter (where e.event_type = 'skill_use')     as skill_count,
    count(e.id) filter (where e.event_type = 'subagent_stop') as subagent_count,
    coalesce(max(s2.input_tokens),  0)                        as input_tokens,
    coalesce(max(s2.output_tokens), 0)                        as output_tokens
  from tree t
  left join public.events e
    on e.session_id = t.session_id
   and e.user_id    = p_user_id
  left join public.sessions s2
    on s2.session_id = t.session_id
   and s2.user_id    = p_user_id
  group by
    t.session_id, t.parent_session_id, t.spawner_id,
    t.spawner_type, t.depth, t.started_at, t.ended_at
  order by t.depth, t.started_at;
$$;

-- -----------------------------------------------------------------------
-- get_entity_rollup: aggregate stats for a spawner across all descendants
-- -----------------------------------------------------------------------
create or replace function public.get_entity_rollup(
  p_user_id      uuid,
  p_spawner_id   text,
  p_spawner_type text,
  p_date_from    date,
  p_date_to      date
)
returns table (
  total_tools     bigint,
  total_skills    bigint,
  total_subagents bigint,
  input_tokens    bigint,
  output_tokens   bigint
)
language sql stable
as $$
  with recursive descendant_sessions as (
    select session_id, input_tokens, output_tokens
    from public.sessions
    where spawner_id   = p_spawner_id
      and spawner_type = p_spawner_type
      and user_id      = p_user_id
      and started_at::date between p_date_from and p_date_to

    union all

    select s.session_id, s.input_tokens, s.output_tokens
    from public.sessions s
    join descendant_sessions ds on s.parent_session_id = ds.session_id
    where s.user_id = p_user_id
  )
  select
    -- Direct tool calls with matching spawner_id
    coalesce((
      select count(*) from public.events
      where user_id              = p_user_id
        and event_type           = 'tool_use'
        and data->>'spawner_id'  = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to
    ), 0)
    +
    -- Tool calls in all descendant sessions
    coalesce((
      select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'tool_use'
    ), 0) as total_tools,

    coalesce((
      select count(*) from public.events
      where user_id              = p_user_id
        and event_type           = 'skill_use'
        and data->>'spawner_id'  = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to
    ), 0)
    +
    coalesce((
      select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'skill_use'
    ), 0) as total_skills,

    coalesce((
      select count(*) from public.events
      where user_id              = p_user_id
        and event_type           = 'subagent_stop'
        and data->>'spawner_id'  = p_spawner_id
        and "timestamp"::date between p_date_from and p_date_to
    ), 0)
    +
    coalesce((
      select count(*) from public.events e
      join descendant_sessions ds on e.session_id = ds.session_id
      where e.user_id = p_user_id and e.event_type = 'subagent_stop'
    ), 0) as total_subagents,

    coalesce((select sum(input_tokens)  from descendant_sessions), 0) as input_tokens,
    coalesce((select sum(output_tokens) from descendant_sessions), 0) as output_tokens;
$$;
