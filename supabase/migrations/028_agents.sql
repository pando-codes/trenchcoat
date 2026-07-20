-- 028: Agent-native lineage. One row per subagent invocation, keyed on
-- Claude Code's native agent_id. Subagents are not sessions; session_id
-- here is the PARENT session they ran inside.

create table if not exists public.agents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  agent_id         text not null,
  session_id       text not null,
  parent_agent_id  text,
  agent_type       text,
  edge_label       text,
  status           text,
  model            text,
  started_at       timestamptz,
  ended_at         timestamptz,
  duration_ms      bigint,
  input_tokens     bigint,
  output_tokens    bigint,
  tool_count       integer,
  created_at       timestamptz not null default now(),
  unique (user_id, agent_id)
);

create index if not exists idx_agents_user_session
  on public.agents(user_id, session_id);

create index if not exists idx_agents_parent
  on public.agents(user_id, parent_agent_id)
  where parent_agent_id is not null;

alter table public.agents enable row level security;

create policy "Users can view own agents"
  on public.agents for select
  using (auth.uid() = user_id);

create policy "Service role can insert agents"
  on public.agents for insert
  with check (auth.role() = 'service_role');

create policy "Service role can read all agents"
  on public.agents for select
  using (auth.role() = 'service_role');

create policy "Service role can update agents"
  on public.agents for update
  using (auth.role() = 'service_role');
