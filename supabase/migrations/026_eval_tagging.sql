-- 026: Eval tagging — session eval columns + outcome scores table.

alter table public.sessions
  add column if not exists eval_id      text,
  add column if not exists eval_variant text;

create index if not exists idx_sessions_user_eval
  on public.sessions(user_id, eval_id)
  where eval_id is not null;

create table if not exists public.eval_scores (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  metric     text not null,
  value      numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, session_id, metric)
);

create index if not exists idx_eval_scores_user_session
  on public.eval_scores(user_id, session_id);

alter table public.eval_scores enable row level security;

create policy "Users can view own eval scores"
  on public.eval_scores for select
  using (auth.uid() = user_id);

create policy "Service role can insert eval scores"
  on public.eval_scores for insert
  with check (auth.role() = 'service_role');

create policy "Service role can read all eval scores"
  on public.eval_scores for select
  using (auth.role() = 'service_role');

create policy "Service role can update eval scores"
  on public.eval_scores for update
  using (auth.role() = 'service_role');
