-- Suite CXO "someone fell behind" (Ciao). One row per employee: are they
-- behind right now, and what their manager was last told (the quota/bonus
-- keys and the worst pace, plus the ISO week of that notice). The Hetzner
-- worker (lib/people/fallsBehind.ts) reads it so a manager hears once per
-- behind-episode, at most once a week, and again only when it gets worse or
-- after the person recovered and slipped again.
--
-- Service-role only, like the sibling cxo tables: RLS on, no policies, anon
-- and authenticated revoked. Holds no comp dollars, only keys and a pace %.
-- Idempotent: safe to run again.

create table if not exists public.cxo_behind_watch (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  employee_id uuid not null,
  behind boolean not null default false,
  notified_items text[] not null default '{}',
  notified_worst numeric,
  last_week text check (last_week is null or last_week ~ '^\d{4}-W\d{2}$'),
  updated_at timestamptz not null default now()
);
create unique index if not exists cxo_behind_watch_employee_uq on public.cxo_behind_watch (rep_id, employee_id);
alter table public.cxo_behind_watch enable row level security;
revoke all on public.cxo_behind_watch from anon, authenticated;
grant select, insert, update, delete on public.cxo_behind_watch to service_role;

notify pgrst, 'reload schema';
