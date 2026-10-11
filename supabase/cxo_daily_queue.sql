-- Suite CXO "Run daily queue" (owner 10-11). One person presses send; Mira
-- works what is pending for THAT person and keeps a short report.
--
-- Two tables, both service-role only: RLS on, no policies, anon and
-- authenticated revoked. The app reads and writes them with the service role,
-- always scoped by rep_id AND member_id (lib/mira/dailyQueue.ts).
-- Idempotent: safe to run again.

-- 1) One row per run: who, when, what it did, what it cost.
create table if not exists public.cxo_daily_queue_runs (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  day date not null,
  via text not null default 'app' check (via in ('app', 'mcp')),
  counts jsonb not null default '{}'::jsonb,
  report jsonb not null default '{}'::jsonb,
  model_calls integer not null default 0,
  est_cost_usd numeric(10, 5) not null default 0,
  ran_at timestamptz not null default now()
);
create index if not exists cxo_daily_queue_runs_idx on public.cxo_daily_queue_runs (rep_id, member_id, day, ran_at desc);
alter table public.cxo_daily_queue_runs enable row level security;
revoke all on public.cxo_daily_queue_runs from anon, authenticated;
grant select, insert, update, delete on public.cxo_daily_queue_runs to service_role;

-- 2) What a run wrote and kept: drafts, proposed talking points, briefs.
--    source_key is unique per person, so a second run (or a connected Claude
--    saving the same thing) never makes a second copy. needs_tap rows wait
--    for the person: nothing is sent or put in front of anyone else until
--    status moves to 'approved' by their own tap.
create table if not exists public.cxo_daily_queue_items (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  source_key text not null check (char_length(source_key) between 1 and 200),
  kind text not null check (kind in ('reply_draft', 'email_draft', 'inbox_draft', 'talking_points', 'brief')),
  day date not null,
  title text not null check (char_length(title) between 1 and 300),
  body text not null default '' check (char_length(body) <= 6000),
  payload jsonb not null default '{}'::jsonb,
  needs_tap boolean not null default true,
  status text not null default 'open' check (status in ('open', 'approved', 'dismissed')),
  via text not null default 'app' check (via in ('app', 'mcp')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists cxo_daily_queue_items_uq on public.cxo_daily_queue_items (rep_id, member_id, source_key);
create index if not exists cxo_daily_queue_items_open_idx on public.cxo_daily_queue_items (rep_id, member_id, status, day);
alter table public.cxo_daily_queue_items enable row level security;
revoke all on public.cxo_daily_queue_items from anon, authenticated;
grant select, insert, update, delete on public.cxo_daily_queue_items to service_role;

notify pgrst, 'reload schema';
