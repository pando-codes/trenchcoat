-- 013: Cost RPCs — get_daily_cost, get_cost_by_model, extend get_top_agents

create or replace function public.get_daily_cost(
  p_user_id uuid,
  p_from date,
  p_to date
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
    group by s.started_at::date
  ) t;
  return result;
end;
$$ language plpgsql security definer;

create or replace function public.get_cost_by_model(
  p_user_id uuid,
  p_from date,
  p_to date
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
    group by s.model
    order by total_cost_usd desc
  ) t;
  return result;
end;
$$ language plpgsql security definer;

-- Extend get_top_agents with token + cost data
create or replace function public.get_top_agents(
  p_user_id uuid,
  p_from date,
  p_to date,
  p_limit integer default 20
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
      case
        when prev.count > 0 then
          round(
            ((cur.count::numeric - prev.count::numeric) / prev.count::numeric * 100),
            1
          )
        else null
      end as trend
    from (
      select
        coalesce(e.data->>'agent_type', 'unknown') as agent_type,
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
      group by e.data->>'agent_type'
    ) cur
    left join (
      select
        coalesce(data->>'agent_type', 'unknown') as agent_type,
        count(*) as count
      from public.events
      where user_id = p_user_id
        and timestamp::date between v_prev_from and v_prev_to
        and event_type = 'subagent_stop'
      group by data->>'agent_type'
    ) prev on prev.agent_type = cur.agent_type
    order by cur.count desc
    limit p_limit
  ) t;

  return result;
end;
$$ language plpgsql security definer;
