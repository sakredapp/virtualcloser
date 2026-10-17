-- Suite CXO weekly status update (Ciao). One row per person per ISO week:
-- what they moved, what is next and what is blocking them. Ciao prefills it
-- on Friday from their closed to-dos, board cards and meetings
-- (lib/status/weekly.ts); the person confirms it in one tap or edits it.
-- Monday morning the owner and admins get one rollup by team, blockers first.
--
-- Service-role only, like the sibling cxo tables: RLS on, no policies, anon
-- and authenticated revoked. The app reads and writes it scoped by rep_id
-- and the signed-in member's own id.
-- (rep_id, member_id, week) is unique, so a second Friday check never makes
-- a second ask. Idempotent: safe to run again.

create table if not exists public.cxo_weekly_status (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null,
  week text not null check (week ~ '^\d{4}-W\d{2}$'),
  moved text[] not null default '{}',
  next text[] not null default '{}',
  blockers text[] not null default '{}',
  prefill jsonb not null default '{}'::jsonb,
  asked_at timestamptz not null default now(),
  confirmed_at timestamptz,
  edited boolean not null default false,
  updated_at timestamptz not null default now()
);
create unique index if not exists cxo_weekly_status_member_week_uq on public.cxo_weekly_status (rep_id, member_id, week);
create index if not exists cxo_weekly_status_rep_week_idx on public.cxo_weekly_status (rep_id, week);
alter table public.cxo_weekly_status enable row level security;
revoke all on public.cxo_weekly_status from anon, authenticated;
grant select, insert, update, delete on public.cxo_weekly_status to service_role;

notify pgrst, 'reload schema';
