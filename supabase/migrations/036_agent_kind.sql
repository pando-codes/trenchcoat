-- 036: Agent kind — delineate plugin / built-in / project / user / ad-hoc agents
--
-- The plugin now classifies each spawn at hook time and stores the result in
-- data->>'agent_kind' (see claude-plugin: classify_agent_kind). That resolution
-- has the full session context, so it is authoritative — it alone can tell a
-- project/user-defined agent apart from an ad-hoc label.
--
-- Historical events (and any from a pre-classification plugin) carry no stored
-- kind. classify_agent_kind() below is a SQL fallback: a pure string heuristic
-- that recovers plugin (namespaced), built-in (known set), and ad-hoc, but can
-- never infer project/user because it lacks that context. get_top_agents prefers
-- the stored kind and falls back to the heuristic only when it is absent.

-- --- SQL fallback classifier (string heuristic only) -----------------------
create or replace function public.classify_agent_kind(p_agent_type text)
returns text language sql immutable as $$
  select case
    when p_agent_type is null or btrim(p_agent_type) = '' then 'builtin'
    when position(':' in p_agent_type) > 0 then 'plugin'
    when lower(btrim(p_agent_type)) in (
      'general-purpose', 'general', 'explore', 'plan', 'fork',
      'claude', 'output-style-setup', 'statusline-setup'
    ) then 'builtin'
    else 'ad_hoc'
  end
$$;

-- --- get_top_agents — now returns agent_kind -------------------------------
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
      -- Stored (authoritative) kind wins; fall back to the string heuristic for
      -- events that predate hook-time classification.
      coalesce(cur.stored_kind, public.classify_agent_kind(cur.agent_type)) as agent_kind,
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
        mode() within group (order by nullif(trim(e.data->>'agent_kind'), '')) as stored_kind,
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
