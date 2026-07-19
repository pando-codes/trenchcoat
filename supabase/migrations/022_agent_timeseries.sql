-- 022: Per-agent daily time-series (invocations, tokens, cost). On-read.
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
  ) t;
  return result;
end;
$$ language plpgsql security definer;
