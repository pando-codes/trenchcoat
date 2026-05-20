-- 018: Indexes to support get_skill_stats RPC performance

create index if not exists idx_events_skill_use
  on public.events (user_id, event_type, timestamp)
  where event_type = 'skill_use';

create index if not exists idx_events_active_skill_id
  on public.events (user_id, event_type, (data->>'active_skill_id'))
  where event_type = 'tool_use';
