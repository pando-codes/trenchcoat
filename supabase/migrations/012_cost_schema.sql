-- 012: Cost transparency schema
-- Adds token columns to sessions and daily_aggregates, model_pricing table,
-- and rewrites update_daily_aggregate to include token aggregation.

-- Sessions: token columns (model column already exists)
alter table public.sessions
  add column if not exists input_tokens integer,
  add column if not exists output_tokens integer;

-- Daily aggregates: token columns
alter table public.daily_aggregates
  add column if not exists input_tokens bigint default 0,
  add column if not exists output_tokens bigint default 0;

-- Model pricing table
create table if not exists public.model_pricing (
  model_id              text primary key,
  input_cost_per_1m     numeric(10, 6) not null,
  output_cost_per_1m    numeric(10, 6) not null,
  updated_at            timestamptz default now()
);

alter table public.model_pricing enable row level security;

create policy "Authenticated users can read model pricing"
  on public.model_pricing for select
  using (auth.role() = 'authenticated');

create policy "Service role full access model pricing"
  on public.model_pricing for all
  using (auth.role() = 'service_role');

-- Seed initial rates (overwritten by daily cron sync)
insert into public.model_pricing (model_id, input_cost_per_1m, output_cost_per_1m) values
  ('claude-opus-4-7',           15.000000,  75.000000),
  ('claude-sonnet-4-6',          3.000000,  15.000000),
  ('claude-haiku-4-5-20251001',  0.800000,   4.000000),
  ('claude-opus-4-5',           15.000000,  75.000000),
  ('claude-sonnet-4-5',          3.000000,  15.000000),
  ('claude-haiku-4-5',           0.800000,   4.000000)
on conflict (model_id) do nothing;

-- Rewrite update_daily_aggregate to include token aggregation
create or replace function public.update_daily_aggregate(
  p_user_id uuid,
  p_date date
) returns void as $$
declare
  v_sessions integer;
  v_events integer;
  v_tool_uses integer;
  v_agent_calls integer;
  v_total_duration bigint;
  v_tool_breakdown jsonb;
  v_hourly jsonb;
  v_stop_reasons jsonb;
  v_input_tokens bigint;
  v_output_tokens bigint;
begin
  select count(distinct session_id) into v_sessions
  from public.events
  where user_id = p_user_id and timestamp::date = p_date;

  select count(*) into v_events
  from public.events
  where user_id = p_user_id and timestamp::date = p_date;

  select count(*) into v_tool_uses
  from public.events
  where user_id = p_user_id
    and timestamp::date = p_date
    and event_type in ('tool_use', 'tool_result');

  select count(*) into v_agent_calls
  from public.events
  where user_id = p_user_id
    and timestamp::date = p_date
    and event_type = 'subagent_stop';

  select coalesce(sum(duration_ms), 0) into v_total_duration
  from public.events
  where user_id = p_user_id
    and timestamp::date = p_date
    and duration_ms is not null;

  select coalesce(jsonb_object_agg(tool_name, cnt), '{}')
  into v_tool_breakdown
  from (
    select tool_name, count(*) as cnt
    from public.events
    where user_id = p_user_id
      and timestamp::date = p_date
      and tool_name is not null
    group by tool_name
  ) t;

  select coalesce(jsonb_agg(coalesce(hour_count, 0) order by h), '[]')
  into v_hourly
  from generate_series(0, 23) as h
  left join (
    select extract(hour from timestamp)::integer as hour, count(*) as hour_count
    from public.events
    where user_id = p_user_id and timestamp::date = p_date
    group by extract(hour from timestamp)
  ) ec on ec.hour = h;

  select coalesce(jsonb_object_agg(reason, cnt), '{}')
  into v_stop_reasons
  from (
    select data->>'stop_reason' as reason, count(*) as cnt
    from public.events
    where user_id = p_user_id
      and timestamp::date = p_date
      and event_type in ('assistant_stop', 'session_end')
      and data->>'stop_reason' is not null
    group by data->>'stop_reason'
  ) sr;

  -- Token totals from sessions (populated when stop events are ingested)
  select
    coalesce(sum(input_tokens), 0),
    coalesce(sum(output_tokens), 0)
  into v_input_tokens, v_output_tokens
  from public.sessions
  where user_id = p_user_id
    and started_at::date = p_date;

  insert into public.daily_aggregates (
    user_id, date, sessions, events, tool_uses, agent_calls,
    total_duration_ms, tool_breakdown, hourly_distribution, stop_reasons,
    input_tokens, output_tokens
  ) values (
    p_user_id, p_date, v_sessions, v_events, v_tool_uses, v_agent_calls,
    v_total_duration, v_tool_breakdown, v_hourly, v_stop_reasons,
    v_input_tokens, v_output_tokens
  )
  on conflict (user_id, date) do update set
    sessions      = excluded.sessions,
    events        = excluded.events,
    tool_uses     = excluded.tool_uses,
    agent_calls   = excluded.agent_calls,
    total_duration_ms   = excluded.total_duration_ms,
    tool_breakdown      = excluded.tool_breakdown,
    hourly_distribution = excluded.hourly_distribution,
    stop_reasons        = excluded.stop_reasons,
    input_tokens        = excluded.input_tokens,
    output_tokens       = excluded.output_tokens,
    updated_at          = now();
end;
$$ language plpgsql security definer;
