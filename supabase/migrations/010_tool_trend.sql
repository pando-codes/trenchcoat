-- 010: Rewrite get_top_tools with previous-period trend calculation

create or replace function public.get_top_tools(
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
      cur.tool_name,
      cur.count,
      round(cur.avg_duration_ms) as avg_duration_ms,
      cur.p50_duration_ms,
      cur.p99_duration_ms,
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
        tool_name,
        count(*) as count,
        avg(duration_ms) as avg_duration_ms,
        percentile_cont(0.5) within group (order by duration_ms) as p50_duration_ms,
        percentile_cont(0.99) within group (order by duration_ms) as p99_duration_ms
      from public.events
      where user_id = p_user_id
        and timestamp::date between p_from and p_to
        and tool_name is not null
        and event_type = 'tool_result'
      group by tool_name
    ) cur
    left join (
      select tool_name, count(*) as count
      from public.events
      where user_id = p_user_id
        and timestamp::date between v_prev_from and v_prev_to
        and tool_name is not null
        and event_type = 'tool_result'
      group by tool_name
    ) prev on prev.tool_name = cur.tool_name
    order by cur.count desc
    limit p_limit
  ) t;

  return result;
end;
$$ language plpgsql security definer;
