-- 011: Add get_top_agents for agent analytics

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
        coalesce(data->>'agent_type', 'unknown') as agent_type,
        count(*) as count,
        avg((data->>'tool_count_total')::numeric) as avg_tool_count,
        avg((data->>'turns')::numeric) as avg_turns
      from public.events
      where user_id = p_user_id
        and timestamp::date between p_from and p_to
        and event_type = 'subagent_stop'
      group by data->>'agent_type'
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
