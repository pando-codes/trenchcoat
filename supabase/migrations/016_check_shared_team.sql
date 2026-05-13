-- supabase/migrations/016_check_shared_team.sql
-- Returns true if user_a and user_b share at least one team.
create or replace function public.check_shared_team(
  p_user_a uuid,
  p_user_b uuid
)
returns boolean
language sql
stable
security definer
as $$
  select exists (
    select 1
    from public.team_members a
    join public.team_members b on b.team_id = a.team_id
    where a.user_id = p_user_a
      and b.user_id = p_user_b
  );
$$;
