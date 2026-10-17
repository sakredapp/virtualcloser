-- Suite CXO day one with Ciao (lib/onboarding/dayOne.ts). One row per new
-- login: when Ciao started their first-day checklist, when they saw what
-- Ciao can do for their role, when every step was done, and when their
-- manager heard about it (once). The steps themselves are never stored:
-- they are read from real state (calendar connected, manager on record,
-- 1:1 dated, a first to-do) each time.
--
-- Only people who joined in the last 14 days get a row; long-time logins are
-- never onboarded. backfilled = the row was made more than a day after they
-- joined (the feature arrived after them): their manager is not told about
-- their first day, only when they finish.
--
-- Service-role only, like the sibling cxo tables: RLS on, no policies, anon
-- and authenticated revoked. The app reads and writes it scoped by rep_id and
-- the signed-in member's own id. Idempotent: safe to run again.

create table if not exists public.cxo_onboarding (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null,
  joined_at timestamptz,
  started_at timestamptz not null default now(),
  backfilled boolean not null default false,
  welcomed_at timestamptz,
  abilities_seen_at timestamptz,
  completed_at timestamptz,
  manager_notified_at timestamptz,
  manager_member_id uuid,
  updated_at timestamptz not null default now()
);
create unique index if not exists cxo_onboarding_member_uq on public.cxo_onboarding (rep_id, member_id);
alter table public.cxo_onboarding enable row level security;
revoke all on public.cxo_onboarding from anon, authenticated;
grant select, insert, update, delete on public.cxo_onboarding to service_role;

notify pgrst, 'reload schema';
