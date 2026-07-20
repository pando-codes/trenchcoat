-- 032: Session-level cache tokens.
-- Nullable, NOT defaulted to 0. null = "captured by a plugin older than 1.3.3";
-- 0 = "captured, genuinely no cache". The UI renders these differently ("--"
-- vs "$0.00"), and a default of 0 would erase the distinction for every
-- historic row permanently.

alter table public.sessions
  add column if not exists cache_creation_tokens bigint,
  add column if not exists cache_read_tokens     bigint;
