-- 027: Eval list + per-variant comparison. Both return json (no drop needed).

create or replace function public.get_eval_list(
  p_user_id uuid,
  p_from    date,
  p_to      date
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.last_run desc), '[]') into result
  from (
    select
      s.eval_id,
      count(distinct s.eval_variant) as variant_count,
      count(*)                       as session_count,
      max(s.started_at)              as last_run
    from public.sessions s
    where s.user_id = p_user_id
      and s.eval_id is not null
      and s.started_at::date between p_from and p_to
    group by s.eval_id
  ) t;
  return result;
end;
$$ language plpgsql security definer;


create or replace function public.get_eval_comparison(
  p_user_id uuid,
  p_eval_id text
) returns json as $$
declare
  result json;
begin
  select coalesce(json_agg(t order by t.eval_variant), '[]') into result
  from (
    select
      coalesce(v.eval_variant, 'untagged') as eval_variant,
      v.session_count,
      v.total_input_tokens,
      v.total_output_tokens,
      round(v.total_cost_usd::numeric, 6) as total_cost_usd,
      round(v.avg_duration_ms::numeric, 0) as avg_duration_ms,
      coalesce(sc.scores, '{}'::jsonb)     as scores
    from (
      select
        s.eval_variant,
        count(*)                                        as session_count,
        sum(coalesce(s.input_tokens, 0))                as total_input_tokens,
        sum(coalesce(s.output_tokens, 0))               as total_output_tokens,
        sum(
          coalesce(s.input_tokens, 0)  * coalesce(mp.input_cost_per_1m, 0)  / 1000000.0 +
          coalesce(s.output_tokens, 0) * coalesce(mp.output_cost_per_1m, 0) / 1000000.0
        )                                               as total_cost_usd,
        avg(s.duration_ms)                              as avg_duration_ms
      from public.sessions s
      left join public.model_pricing mp on mp.model_id = s.model
      where s.user_id = p_user_id
        and s.eval_id = p_eval_id
      group by s.eval_variant
    ) v
    left join (
      select
        m.eval_variant,
        jsonb_object_agg(m.metric, jsonb_build_object('avg', m.avg_value, 'count', m.n)) as scores
      from (
        select s3.eval_variant, es.metric,
               avg(es.value) as avg_value,
               count(*)      as n
        from public.eval_scores es
        join public.sessions s3
          on  s3.session_id = es.session_id
          and s3.user_id    = es.user_id
        where es.user_id = p_user_id
          and s3.eval_id = p_eval_id
        group by s3.eval_variant, es.metric
      ) m
      group by m.eval_variant
    ) sc on sc.eval_variant is not distinct from v.eval_variant
  ) t;
  return result;
end;
$$ language plpgsql security definer;
