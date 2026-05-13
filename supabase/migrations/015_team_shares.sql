-- supabase/migrations/015_team_shares.sql

create table public.team_shares (
  id          uuid        primary key default gen_random_uuid(),
  team_id     uuid        not null references public.teams(id) on delete cascade,
  token       text        unique not null default encode(gen_random_bytes(16), 'hex'),
  created_by  uuid        not null references auth.users(id),
  date_from   date        not null,
  date_to     date        not null,
  snapshot    jsonb       not null,
  created_at  timestamptz not null default now()
);

alter table public.team_shares enable row level security;

-- Anyone with a token can read the snapshot (no auth required).
create policy "Public read by token"
  on public.team_shares for select
  using (true);

-- Only authenticated team members may create shares.
create policy "Team members can create shares"
  on public.team_shares for insert
  with check (
    auth.uid() is not null
    and auth.uid() in (
      select user_id from public.team_members where team_id = team_shares.team_id
    )
  );
