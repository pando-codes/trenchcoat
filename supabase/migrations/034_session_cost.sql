-- 034: Cache-aware session cost.
--
-- Array-keyed so the sessions list resolves a full page in one round trip
-- instead of N calls. Cache columns pass through unmodified so the caller can
-- still distinguish null ("plugin older than 1.3.3") from 0 ("no cache").
-- cost_usd is null when the session's model has no model_pricing row.

create or replace function public.get_session_cost(
  p_user_id     uuid,
  p_session_ids text[]
) returns table (
  session_id            text,
  input_tokens          bigint,
  output_tokens         bigint,
  cache_creation_tokens bigint,
  cache_read_tokens     bigint,
  cost_usd              numeric
) language sql stable as $$
  select
    s.session_id,
    coalesce(s.input_tokens,  0)::bigint as input_tokens,
    coalesce(s.output_tokens, 0)::bigint as output_tokens,
    s.cache_creation_tokens,
    s.cache_read_tokens,
    public.price_tokens(
      s.model,
      coalesce(s.input_tokens,  0)::bigint,
      coalesce(s.output_tokens, 0)::bigint,
      coalesce(s.cache_creation_tokens, 0)::bigint,
      coalesce(s.cache_read_tokens,     0)::bigint
    ) as cost_usd
  from public.sessions s
  where s.user_id = p_user_id
    and s.session_id = any(p_session_ids);
$$;
