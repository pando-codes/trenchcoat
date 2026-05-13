-- 014: Team Analytics RPCs — get_team_member_stats, get_team_trend

-- Per-member stats for a team over a date range.
-- Returns all team members including those with zero sessions.
create or replace function public.get_team_member_stats(
  p_team_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  user_id        uuid,
  display_name   text,
  avatar_url     text,
  sessions       bigint,
  total_cost_usd numeric,
  top_tool       text,
  last_active    date
)
language sql
stable
security definer
as $$
  with member_sessions as (
    select
      tm.user_id,
      count(s.id)                                                        as sessions,
      coalesce(sum(
        (coalesce(s.input_tokens,  0)::numeric * coalesce(mp.input_cost_per_1m,  0) +
         coalesce(s.output_tokens, 0)::numeric * coalesce(mp.output_cost_per_1m, 0))
        / 1000000
      ), 0)                                                              as total_cost_usd,
      max(s.started_at::date)                                            as last_active
    from public.team_members tm
    left join public.sessions s
      on  s.user_id     = tm.user_id
      and s.started_at::date >= p_from
      and s.started_at::date <= p_to
    left join public.model_pricing mp on mp.model_id = s.model
    where tm.team_id = p_team_id
    group by tm.user_id
  ),
  member_top_tools as (
    select
      tm.user_id,
      (e.data->>'tool_name')                                             as tool_name,
      row_number() over (
        partition by tm.user_id
        order by count(*) desc
      )                                                                  as rn
    from public.team_members tm
    join public.sessions s
      on  s.user_id     = tm.user_id
      and s.started_at::date >= p_from
      and s.started_at::date <= p_to
    join public.events e
      on  e.session_id  = s.session_id
      and e.event_type  = 'tool_use'
    where tm.team_id = p_team_id
    group by tm.user_id, e.data->>'tool_name'
  )
  select
    ms.user_id,
    up.display_name,
    up.avatar_url,
    ms.sessions,
    ms.total_cost_usd,
    mtt.tool_name  as top_tool,
    ms.last_active
  from member_sessions ms
  left join public.user_profiles up  on up.user_id  = ms.user_id
  left join member_top_tools     mtt on mtt.user_id = ms.user_id and mtt.rn = 1
  order by ms.sessions desc;
$$;

-- Daily session counts for all team members, with gap-filling.
create or replace function public.get_team_trend(
  p_team_id uuid,
  p_from    date,
  p_to      date
)
returns table (
  date     date,
  sessions bigint
)
language sql
stable
security definer
as $$
  select
    d.day::date                                     as date,
    count(s.id)                                     as sessions
  from generate_series(p_from::timestamp, p_to::timestamp, '1 day'::interval) as d(day)
  left join public.sessions s
    on  s.started_at::date = d.day::date
    and s.user_id in (
      select user_id from public.team_members where team_id = p_team_id
    )
  group by d.day::date
  order by d.day::date;
$$;
