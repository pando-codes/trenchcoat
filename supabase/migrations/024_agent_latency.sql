-- 024: Per-agent latency, attributed via agent_id (Agent tool_result ⋈ subagent_stop).
-- Requires trenchcoat plugin >= 1.2.0, which stamps agent_id onto tool_end.

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
      group by coalesce(nullif(trim(e.data->>'agent_type'), ''), 'general-purpose')
    ) cur
    left join (
      select
        coalesce(nullif(trim(data->>'agent_type'), ''), 'general-purpose') as agent_type,
        count(*) as count
      from public.events
      where user_id = p_user_id
        and timestamp::date between v_prev_from and v_prev_to
        and event_type = 'subagent_stop'
      group by coalesce(nullif(trim(data->>'agent_type'), ''), 'general-purpose')
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
      group by coalesce(nullif(trim(ss.data->>'agent_type'), ''), 'general-purpose')
    ) lat on lat.agent_type = cur.agent_type
    order by cur.count desc
    limit p_limit
  ) t;

  return result;
end;
$$ language plpgsql security definer;


create or replace function public.get_agent_timeseries(
  p_user_id    uuid,
  p_agent_type text,
  p_from       date,
  p_to         date
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
      group by tr.timestamp::date
    ) lat on lat.bucket = b.bucket
  ) t;
  return result;
end;
$$ language plpgsql security definer;
