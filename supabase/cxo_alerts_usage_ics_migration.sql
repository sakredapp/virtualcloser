-- Suite CXO (owner 10-09, Pinnacle ask): board due-date reminders, usage
-- tracking and Apple / iCloud (ICS) calendars. Service-role only: RLS on with
-- no policies, grants to service_role only. Idempotent.

-- 1) Due-date reminders. One row per card + member + kind, ever (never sent twice).
--    The row is also the in-app reminder (read_at = "Got it").
create table if not exists public.cxo_due_reminders (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  card_id uuid not null references public.cxo_board_cards(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('d7', 'd3', 'd1', 'd0', 'overdue')),
  due_date date not null,
  days_left integer not null,
  in_app boolean not null default true,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (card_id, member_id, kind)
);
create index if not exists cxo_due_reminders_member_unread on public.cxo_due_reminders (member_id, read_at);

-- One "Due soon" email per member per day.
create table if not exists public.cxo_due_digests (
  member_id uuid not null references public.members(id) on delete cascade,
  day date not null,
  rep_id text not null,
  cards integer not null default 0,
  status text not null default 'sent',
  sent_at timestamptz not null default now(),
  primary key (member_id, day)
);

-- 2) Usage: one row per member per page per day. Logins are path '/login'
--    and count every sign-in; pages count once a day.
create table if not exists public.cxo_activity (
  rep_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  day date not null,
  path text not null,
  count integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (member_id, day, path)
);
create index if not exists cxo_activity_rep_day on public.cxo_activity (rep_id, day);

create or replace function public.cxo_activity_hit(p_rep text, p_member uuid, p_day date, p_path text, p_bump boolean)
returns void language sql security definer set search_path = public as $$
  insert into public.cxo_activity (rep_id, member_id, day, path, count)
  values (p_rep, p_member, p_day, left(p_path, 120), 1)
  on conflict (member_id, day, path) do update
    set count = public.cxo_activity.count + 1, updated_at = now()
    where p_bump;
$$;

-- 3) Apple / iCloud / any ICS link, per member, with a 15-minute event cache.
create table if not exists public.cxo_ics_feeds (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  url text not null,
  label text not null default 'Apple calendar',
  events jsonb not null default '[]'::jsonb,
  fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (member_id, url)
);

alter table public.cxo_due_reminders enable row level security;
alter table public.cxo_due_digests enable row level security;
alter table public.cxo_activity enable row level security;
alter table public.cxo_ics_feeds enable row level security;

revoke all on public.cxo_due_reminders, public.cxo_due_digests, public.cxo_activity, public.cxo_ics_feeds from anon, authenticated, public;
grant select, insert, update, delete on public.cxo_due_reminders, public.cxo_due_digests, public.cxo_activity, public.cxo_ics_feeds to service_role;

revoke all on function public.cxo_activity_hit(text, uuid, date, text, boolean) from public, anon, authenticated;
grant execute on function public.cxo_activity_hit(text, uuid, date, text, boolean) to service_role;

notify pgrst, 'reload schema';
