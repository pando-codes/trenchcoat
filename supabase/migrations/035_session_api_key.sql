-- 035: Per-machine (per-API-key) attribution + filtering.
--
-- A user runs Claude Code from several machines, each with its own Trenchcoat
-- API key. We attribute every session to the key that ingested it (stamped in
-- events.service.ts on session insert) and let the dashboard filter every
-- analytics surface by that key = machine.
--
-- Grain: api_key_id lives on `sessions` only. events/agents carry session_id,
-- so they inherit attribution via a join to sessions.
--
-- All RPC overrides below add an optional `p_api_key_id uuid default null`.
-- When null the query is byte-for-byte equivalent to its prior definition
-- (the added predicate is `p_api_key_id is null or ...`). When set, rows are
-- restricted to sessions whose api_key_id matches, via an EXISTS against
-- `sessions` (no row multiplication).

-- ---------------------------------------------------------------------------
-- Schema: attribution column on sessions
-- ---------------------------------------------------------------------------
alter table public.sessions
  add column if not exists api_key_id uuid references public.api_keys(id) on delete set null;

create index if not exists idx_sessions_user_api_key
  on public.sessions(user_id, api_key_id, started_at desc);

-- ---------------------------------------------------------------------------
-- Drop the prior function signatures. Adding p_api_key_id changes the arity,
-- so `create or replace` would OVERLOAD rather than replace — leaving the old
-- definitions live and making calls with the old arg count ambiguous. Drop the
-- exact prior signatures first, then recreate below with the new parameter.
-- ---------------------------------------------------------------------------
drop function if exists public.get_overview_stats(uuid, date, date);
drop function if exists public.get_top_tools(uuid, date, date, integer);
drop function if exists public.get_top_agents(uuid, date, date, integer);
drop function if exists public.get_agent_timeseries(uuid, text, date, date);
drop function if exists public.get_skill_stats(uuid, date, date);
drop function if exists public.get_daily_cost(uuid, date, date);
drop function if exists public.get_cost_by_model(uuid, date, date);
drop function if exists public.get_eval_list(uuid, date, date);

-- ===========================================================================
-- Raw-table RPCs: add optional p_api_key_id, filter via EXISTS on sessions.
-- ===========================================================================

-- --- get_top_tools (reads events) ------------------------------------------
create or replace function public.get_top_tools(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_limit integer default 20,
  p_api_key_id uuid default null
) returns json as $$
declare
  result json;
  v_period_days integer;
  v_prev_from date;
  v_prev_to date;
begin
  v_period_days := p_to - p_from;
  v_prev_to     := p_from - interval '1 day';
  v_prev_from   := v_prev_to - (v_period_days * interval '1 day');

  select coalesce(json_agg(t), '[]') into result
  from (
    select
      cur.tool_name,
      cur.count,
      round(cur.avg_duration_ms) as avg_duration_ms,
      cur.p50_duration_ms,
      cur.p99_duration_ms,
      case
        when prev.count > 0 then
          round(((cur.count::numeric - prev.count::numeric) / prev.count::numeric * 100), 1)
        else null
      end as trend
    from (
      select
        tool_name,
        count(*) as count,
        avg(duration_ms) as avg_duration_ms,
        percentile_cont(0.5) within group (order by duration_ms) as p50_duration_ms,
        percentile_cont(0.99) within group (order by duration_ms) as p99_duration_ms
      from public.events e
      where e.user_id = p_user_id
        and e.timestamp::date between p_from and p_to
        and e.tool_name is not null
        and e.event_type = 'tool_result'
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = e.session_id and ak.user_id = e.user_id
            and ak.api_key_id = p_api_key_id))
      group by tool_name
    ) cur
    left join (
      select tool_name, count(*) as count
      from public.events e
      where e.user_id = p_user_id
        and e.timestamp::date between v_prev_from and v_prev_to
        and e.tool_name is not null
        and e.event_type = 'tool_result'
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = e.session_id and ak.user_id = e.user_id
            and ak.api_key_id = p_api_key_id))
      group by tool_name
    ) prev on prev.tool_name = cur.tool_name
    order by cur.count desc
    limit p_limit
  ) t;

  return result;
end;
$$ language plpgsql security definer;

-- --- get_top_agents (reads events) -----------------------------------------
create or replace function public.get_top_agents(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_limit integer default 20,
  p_api_key_id uuid default null
) returns json as $$
declare
  result json;
  v_period_days integer;
  v_prev_from date;
  v_prev_to date;
begin
  v_period_days := p_to - p_from;
  v_prev_to     := p_from - interval '1 day';
  v_prev_from   := v_prev_to - (v_period_days * interval '1 day');

  select coalesce(json_agg(t), '[]') into result
  from (
    select
      cur.agent_type,
      cur.count,
      round(cur.avg_tool_count::numeric, 1) as avg_tool_count,
      round(cur.avg_turns::numeric, 1) as avg_turns,
      cur.total_input_tokens,
      cur.total_output_tokens,
      round(cur.total_cost_usd::numeric, 6) as total_cost_usd,
      lat.p50_latency_ms,
      lat.p99_latency_ms,
      coalesce(lat.latency_sample_count, 0) as latency_sample_count,
      case
        when prev.count > 0 then
          round(((cur.count::numeric - prev.count::numeric) / prev.count::numeric * 100), 1)
        else null
      end as trend
    from (
      select
        coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose') as agent_type,
        count(*) as count,
        avg((e.data->>'tool_count_total')::numeric) as avg_tool_count,
        avg((e.data->>'turns')::numeric) as avg_turns,
        sum(coalesce((e.data->>'input_tokens')::numeric, 0)) as total_input_tokens,
        sum(coalesce((e.data->>'output_tokens')::numeric, 0)) as total_output_tokens,
        sum(
          coalesce((e.data->>'input_tokens')::numeric, 0) * coalesce(mp.input_cost_per_1m, 0) / 1000000.0 +
          coalesce((e.data->>'output_tokens')::numeric, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
        ) as total_cost_usd
      from public.events e
      left join public.model_pricing mp on mp.model_id = (e.data->>'model')
      where e.user_id = p_user_id
        and e.timestamp::date between p_from and p_to
        and e.event_type = 'subagent_stop'
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = e.session_id and ak.user_id = e.user_id
            and ak.api_key_id = p_api_key_id))
      group by coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose')
    ) cur
    left join (
      select
        coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose') as agent_type,
        count(*) as count
      from public.events e
      where e.user_id = p_user_id
        and e.timestamp::date between v_prev_from and v_prev_to
        and e.event_type = 'subagent_stop'
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = e.session_id and ak.user_id = e.user_id
            and ak.api_key_id = p_api_key_id))
      group by coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose')
    ) prev on prev.agent_type = cur.agent_type
    left join (
      select
        coalesce(nullif(trim(ss.data->>'agent_type'), ''), 'general-purpose') as agent_type,
        round(percentile_cont(0.5)  within group (order by tr.duration_ms)::numeric, 0) as p50_latency_ms,
        round(percentile_cont(0.99) within group (order by tr.duration_ms)::numeric, 0) as p99_latency_ms,
        count(*) as latency_sample_count
      from public.events tr
      join public.events ss
        on  ss.user_id    = tr.user_id
        and ss.session_id = tr.session_id
        and ss.event_type = 'subagent_stop'
        and ss.data->>'agent_id' = tr.data->>'agent_id'
      where tr.user_id    = p_user_id
        and tr.event_type = 'tool_result'
        and tr.tool_name  = 'Agent'
        and tr.duration_ms is not null
        and tr.data->>'agent_id' is not null
        and tr.timestamp::date between p_from and p_to
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = tr.session_id and ak.user_id = tr.user_id
            and ak.api_key_id = p_api_key_id))
      group by coalesce(nullif(trim(ss.data->>'agent_type'), ''), 'general-purpose')
    ) lat on lat.agent_type = cur.agent_type
    order by cur.count desc
    limit p_limit
  ) t;

  return result;
end;
$$ language plpgsql security definer;

-- --- get_agent_timeseries (reads events) -----------------------------------
create or replace function public.get_agent_timeseries(
  p_user_id    uuid,
  p_agent_type text,
  p_from       date,
  p_to         date,
  p_api_key_id uuid default null
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.bucket), '[]') into result
  from (
    select
      b.bucket,
      b.invocations,
      b.input_tokens,
      b.output_tokens,
      b.cost_usd,
      lat.p50_latency_ms,
      coalesce(lat.latency_sample_count, 0) as latency_sample_count
    from (
      select
        e.timestamp::date as bucket,
        count(*) as invocations,
        sum(coalesce((e.data->>'input_tokens')::numeric, 0))::bigint  as input_tokens,
        sum(coalesce((e.data->>'output_tokens')::numeric, 0))::bigint as output_tokens,
        round(sum(
          coalesce((e.data->>'input_tokens')::numeric, 0)  * coalesce(mp.input_cost_per_1m, 0)  / 1000000.0 +
          coalesce((e.data->>'output_tokens')::numeric, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
        )::numeric, 6) as cost_usd
      from public.events e
      left join public.model_pricing mp on mp.model_id = (e.data->>'model')
      where e.user_id    = p_user_id
        and e.event_type = 'subagent_stop'
        and coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose') = p_agent_type
        and e.timestamp::date between p_from and p_to
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = e.session_id and ak.user_id = e.user_id
            and ak.api_key_id = p_api_key_id))
      group by e.timestamp::date
    ) b
    left join (
      select
        tr.timestamp::date as bucket,
        round(percentile_cont(0.5) within group (order by tr.duration_ms)::numeric, 0) as p50_latency_ms,
        count(*) as latency_sample_count
      from public.events tr
      join public.events ss
        on  ss.user_id    = tr.user_id
        and ss.session_id = tr.session_id
        and ss.event_type = 'subagent_stop'
        and ss.data->>'agent_id' = tr.data->>'agent_id'
      where tr.user_id    = p_user_id
        and tr.event_type = 'tool_result'
        and tr.tool_name  = 'Agent'
        and tr.duration_ms is not null
        and tr.data->>'agent_id' is not null
        and coalesce(nullif(trim(ss.data->>'agent_type'), ''), 'general-purpose') = p_agent_type
        and tr.timestamp::date between p_from and p_to
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = tr.session_id and ak.user_id = tr.user_id
            and ak.api_key_id = p_api_key_id))
      group by tr.timestamp::date
    ) lat on lat.bucket = b.bucket
  ) t;
  return result;
end;
$$ language plpgsql security definer;

-- --- get_skill_stats (reads events; filter the driving skill_use rows) ------
create or replace function public.get_skill_stats(
  p_user_id uuid,
  p_from    date,
  p_to      date,
  p_api_key_id uuid default null
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
      count(*)                                       as invocation_count,
      coalesce(sum(sk.tool_calls_triggered), 0)      as tool_calls_triggered,
      coalesce(sum(sk.cross_session_tool_calls), 0)  as cross_session_tool_calls,
      case
        when count(*) > 0
        then round(coalesce(sum(sk.tool_calls_triggered), 0)::numeric / count(*), 1)
        else 0
      end                                            as avg_tools_per_invocation
    from (
      select
        e.data->>'skill_name'    as skill_name,
        e.data->>'activation_id' as activation_id,
        (
          select count(*)
          from public.events te
          where te.user_id              = p_user_id
            and te.event_type           = 'tool_use'
            and te.data->>'spawner_id'  = e.data->>'activation_id'
            and te.data->>'spawner_type' = 'skill'
            and te.timestamp::date between p_from and p_to
        ) as tool_calls_triggered,
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
        and (p_api_key_id is null or exists (
          select 1 from public.sessions ak
          where ak.session_id = e.session_id and ak.user_id = e.user_id
            and ak.api_key_id = p_api_key_id))
    ) sk
    group by sk.skill_name
  ) s;

  return result;
end;
$$;

-- ===========================================================================
-- Session-backed RPCs: single predicate on the sessions row.
-- ===========================================================================

-- --- get_daily_cost ---------------------------------------------------------
create or replace function public.get_daily_cost(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_api_key_id uuid default null
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.date), '[]') into result
  from (
    select
      s.started_at::date as date,
      sum(
        coalesce(s.input_tokens, 0) * coalesce(mp.input_cost_per_1m, 0) / 1000000.0 +
        coalesce(s.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
      ) as total_cost_usd,
      sum(coalesce(s.input_tokens, 0)) as input_tokens,
      sum(coalesce(s.output_tokens, 0)) as output_tokens
    from public.sessions s
    left join public.model_pricing mp on mp.model_id = s.model
    where s.user_id = p_user_id
      and s.started_at::date between p_from and p_to
      and (p_api_key_id is null or s.api_key_id = p_api_key_id)
    group by s.started_at::date
  ) t;
  return result;
end;
$$ language plpgsql security definer;

-- --- get_cost_by_model ------------------------------------------------------
create or replace function public.get_cost_by_model(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_api_key_id uuid default null
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t), '[]') into result
  from (
    select
      coalesce(s.model, 'unknown') as model,
      count(*) as session_count,
      sum(coalesce(s.input_tokens, 0)) as input_tokens,
      sum(coalesce(s.output_tokens, 0)) as output_tokens,
      sum(
        coalesce(s.input_tokens, 0) * coalesce(mp.input_cost_per_1m, 0) / 1000000.0 +
        coalesce(s.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
      ) as total_cost_usd
    from public.sessions s
    left join public.model_pricing mp on mp.model_id = s.model
    where s.user_id = p_user_id
      and s.started_at::date between p_from and p_to
      and (s.input_tokens is not null or s.output_tokens is not null)
      and (p_api_key_id is null or s.api_key_id = p_api_key_id)
    group by s.model
    order by total_cost_usd desc
  ) t;
  return result;
end;
$$ language plpgsql security definer;

-- --- get_eval_list ----------------------------------------------------------
create or replace function public.get_eval_list(
  p_user_id uuid,
  p_from    date,
  p_to      date,
  p_api_key_id uuid default null
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.last_run desc), '[]') into result
  from (
    select
      s.eval_id,
      count(distinct coalesce(s.eval_variant, 'untagged')) as variant_count,
      count(*)                       as session_count,
      max(s.started_at)              as last_run
    from public.sessions s
    where s.user_id = p_user_id
      and s.eval_id is not null
      and s.started_at::date between p_from and p_to
      and (p_api_key_id is null or s.api_key_id = p_api_key_id)
    group by s.eval_id
  ) t;
  return result;
end;
$$ language plpgsql security definer;

-- ===========================================================================
-- daily_aggregates-bound reads: bypass-when-filtered.
-- daily_aggregates has no key dimension, so when a machine filter is active we
-- recompute from raw events/sessions. When p_api_key_id is null these RPCs are
-- NOT used — the services keep reading the pre-aggregated table (fast path).
--
-- Divergence note: the unfiltered overview sums per-day metrics out of
-- daily_aggregates (e.g. total_sessions = sum of per-day distinct session
-- counts). The filtered recompute below uses whole-range semantics
-- (distinct sessions across the range), which is arguably more correct for a
-- single-machine view but may differ slightly from the all-machines totals.
-- ===========================================================================

-- --- get_overview_stats: add p_api_key_id; branch to raw when set -----------
create or replace function public.get_overview_stats(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_api_key_id uuid default null
) returns json as $$
declare
  result json;
begin
  if p_api_key_id is null then
    -- Unchanged fast path: pre-aggregated table.
    select json_build_object(
      'total_sessions', coalesce(sum(sessions), 0),
      'total_events', coalesce(sum(events), 0),
      'total_tool_uses', coalesce(sum(tool_uses), 0),
      'total_agent_calls', coalesce(sum(agent_calls), 0),
      'active_days', count(*) filter (where sessions > 0),
      'avg_session_duration_min', coalesce(
        round(avg(case when sessions > 0 then total_duration_ms::numeric / sessions / 60000 end), 1), 0),
      'avg_tools_per_session', coalesce(
        round(avg(case when sessions > 0 then tool_uses::numeric / sessions end), 1), 0)
    ) into result
    from public.daily_aggregates
    where user_id = p_user_id
      and date between p_from and p_to;
    return result;
  end if;

  -- Filtered path: recompute from raw, restricted to the chosen key.
  with keyed_events as (
    select e.*
    from public.events e
    where e.user_id = p_user_id
      and e.timestamp::date between p_from and p_to
      and exists (
        select 1 from public.sessions ak
        where ak.session_id = e.session_id and ak.user_id = e.user_id
          and ak.api_key_id = p_api_key_id)
  ),
  agg as (
    select
      count(distinct session_id)                                         as total_sessions,
      count(*)                                                           as total_events,
      count(*) filter (where event_type in ('tool_use','tool_result'))   as total_tool_uses,
      count(*) filter (where event_type = 'subagent_stop')               as total_agent_calls,
      count(distinct timestamp::date)                                    as active_days
    from keyed_events
  ),
  dur as (
    select
      coalesce(avg(nullif(s.duration_ms, 0)), 0) / 60000.0 as avg_session_duration_min
    from public.sessions s
    where s.user_id = p_user_id
      and s.api_key_id = p_api_key_id
      and s.started_at::date between p_from and p_to
  )
  select json_build_object(
    'total_sessions', agg.total_sessions,
    'total_events', agg.total_events,
    'total_tool_uses', agg.total_tool_uses,
    'total_agent_calls', agg.total_agent_calls,
    'active_days', agg.active_days,
    'avg_session_duration_min', round(dur.avg_session_duration_min::numeric, 1),
    'avg_tools_per_session', case
      when agg.total_sessions > 0
      then round(agg.total_tool_uses::numeric / agg.total_sessions, 1)
      else 0 end
  ) into result
  from agg, dur;

  return result;
end;
$$ language plpgsql security definer;

-- --- get_daily_activity_for_key: raw replacement for the daily_aggregates
--     read in getDailyActivity (sessions/events/tool_uses per day) -----------
create or replace function public.get_daily_activity_for_key(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_api_key_id uuid
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.date), '[]') into result
  from (
    select
      e.timestamp::date as date,
      count(distinct e.session_id)                                     as sessions,
      count(*)                                                         as events,
      count(*) filter (where e.event_type in ('tool_use','tool_result')) as tool_uses,
      count(*) filter (where e.event_type = 'subagent_stop')           as agent_calls
    from public.events e
    where e.user_id = p_user_id
      and e.timestamp::date between p_from and p_to
      and exists (
        select 1 from public.sessions ak
        where ak.session_id = e.session_id and ak.user_id = e.user_id
          and ak.api_key_id = p_api_key_id)
    group by e.timestamp::date
  ) t;
  return result;
end;
$$ language plpgsql security definer;

-- --- get_stop_reasons_for_key: raw replacement for daily_aggregates.stop_reasons
--     Returns a { reason: count } json object. -------------------------------
create or replace function public.get_stop_reasons_for_key(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_api_key_id uuid
) returns json as $$
declare
  result json;
begin
  select coalesce(json_object_agg(reason, cnt), '{}') into result
  from (
    select e.data->>'stop_reason' as reason, count(*) as cnt
    from public.events e
    where e.user_id = p_user_id
      and e.timestamp::date between p_from and p_to
      and e.event_type in ('assistant_stop', 'session_end')
      and e.data->>'stop_reason' is not null
      and exists (
        select 1 from public.sessions ak
        where ak.session_id = e.session_id and ak.user_id = e.user_id
          and ak.api_key_id = p_api_key_id)
    group by e.data->>'stop_reason'
  ) t;
  return result;
end;
$$ language plpgsql security definer;

-- --- get_hourly_heatmap_for_key: raw replacement for the daily_aggregates
--     hourly_distribution read in getHourlyHeatmap. Returns rows of
--     (day_of_week 0-6, hour 0-23, count). ------------------------------------
create or replace function public.get_hourly_heatmap_for_key(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_api_key_id uuid
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t), '[]') into result
  from (
    select
      extract(dow  from e.timestamp)::int as day_of_week,
      extract(hour from e.timestamp)::int as hour,
      count(*)                            as count
    from public.events e
    where e.user_id = p_user_id
      and e.timestamp::date between p_from and p_to
      and exists (
        select 1 from public.sessions ak
        where ak.session_id = e.session_id and ak.user_id = e.user_id
          and ak.api_key_id = p_api_key_id)
    group by 1, 2
  ) t;
  return result;
end;
$$ language plpgsql security definer;
