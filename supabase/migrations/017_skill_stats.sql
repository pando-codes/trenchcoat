-- 017: get_skill_stats RPC
-- Queries skill_use events and correlates them with tool_use events via
-- active_skill_id to produce per-skill invocation counts and tool attribution.

create or replace function public.get_skill_stats(
  p_user_id uuid,
  p_from date,
  p_to date
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
        e.data->>'skill_name'   as skill_name,
        e.data->>'activation_id' as activation_id,
        (
          select count(*)
          from public.events te
          where te.user_id     = p_user_id
            and te.event_type  = 'tool_use'
            and te.data->>'active_skill_id' = e.data->>'activation_id'
            and te.timestamp::date between p_from and p_to
        )                       as tool_calls_triggered
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
