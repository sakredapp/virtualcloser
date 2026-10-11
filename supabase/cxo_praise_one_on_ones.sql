-- Suite CXO people layer (owner 10-11): praise, 1:1s and per-person goals.
-- Day-to-day performance management, NOT an HR records system: no SSN, date
-- of birth, home address, bank or tax fields belong in any of these tables.
--
-- All four tables are service-role only: RLS on, no policies, anon and
-- authenticated revoked. The app reads and writes them with the service role,
-- always scoped by rep_id, and decides who may see what in lib/people.
-- Idempotent: safe to run again.

-- 1) Praise: anyone in the org praises a colleague. The feed is org-wide.
create table if not exists public.cxo_praise (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  from_member_id uuid references public.members(id) on delete set null,
  from_name text not null check (char_length(from_name) between 1 and 200),
  to_employee_id uuid not null references public.cxo_employees(id) on delete cascade,
  value text check (value is null or char_length(value) <= 60),
  body text not null check (char_length(body) between 1 and 600),
  created_at timestamptz not null default now()
);
create index if not exists cxo_praise_rep_idx on public.cxo_praise (rep_id, created_at desc);
create index if not exists cxo_praise_to_idx on public.cxo_praise (rep_id, to_employee_id, created_at desc);
alter table public.cxo_praise enable row level security;
revoke all on public.cxo_praise from anon, authenticated;
grant select, insert, update, delete on public.cxo_praise to service_role;

-- 2) One recurring 1:1 per employee, with whoever runs it.
create table if not exists public.cxo_one_on_ones (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  employee_id uuid not null references public.cxo_employees(id) on delete cascade,
  manager_member_id uuid references public.members(id) on delete set null,
  manager_name text check (manager_name is null or char_length(manager_name) <= 200),
  cadence text not null default 'biweekly' check (cadence in ('weekly', 'biweekly', 'monthly')),
  next_date date,
  last_date date,
  calendar_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cxo_one_on_ones_employee_uq on public.cxo_one_on_ones (rep_id, employee_id);
alter table public.cxo_one_on_ones enable row level security;
revoke all on public.cxo_one_on_ones from anon, authenticated;
grant select, insert, update, delete on public.cxo_one_on_ones to service_role;

-- 3) What is in a 1:1: talking points, notes, action items and private
--    feedback (kind 'feedback': only the two people and the org owner/admin).
create table if not exists public.cxo_one_on_one_items (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  one_on_one_id uuid not null references public.cxo_one_on_ones(id) on delete cascade,
  kind text not null check (kind in ('agenda', 'note', 'action', 'feedback')),
  body text not null check (char_length(body) between 1 and 2000),
  author_member_id uuid references public.members(id) on delete set null,
  author_name text check (author_name is null or char_length(author_name) <= 200),
  owner_member_id uuid references public.members(id) on delete set null,
  owner_name text check (owner_name is null or char_length(owner_name) <= 200),
  todo_id uuid,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cxo_one_on_one_items_idx on public.cxo_one_on_one_items (rep_id, one_on_one_id, created_at);
alter table public.cxo_one_on_one_items enable row level security;
revoke all on public.cxo_one_on_one_items from anon, authenticated;
grant select, insert, update, delete on public.cxo_one_on_one_items to service_role;

-- 4) A person's own goals, next to the quotas they already have.
create table if not exists public.cxo_goals (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  employee_id uuid not null references public.cxo_employees(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  unit text not null default 'count' check (unit in ('count', 'usd', 'pct')),
  target numeric not null check (target > 0),
  current numeric not null default 0,
  due_date date,
  status text not null default 'active' check (status in ('active', 'done')),
  created_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cxo_goals_employee_idx on public.cxo_goals (rep_id, employee_id);
alter table public.cxo_goals enable row level security;
revoke all on public.cxo_goals from anon, authenticated;
grant select, insert, update, delete on public.cxo_goals to service_role;

-- 5) "You were praised" rides the existing in-app notices rail.
do $$
begin
  if to_regclass('public.cxo_followup_notices') is not null then
    alter table public.cxo_followup_notices drop constraint if exists cxo_followup_notices_kind_check;
    alter table public.cxo_followup_notices add constraint cxo_followup_notices_kind_check
      check (kind in ('nudge', 'escalate', 'close', 'report', 'approval', 'approval_result', 'praise'));
    alter table public.cxo_followup_notices drop constraint if exists cxo_followup_notices_item_kind_check;
    alter table public.cxo_followup_notices add constraint cxo_followup_notices_item_kind_check
      check (item_kind is null or item_kind in ('request', 'card', 'meeting', 'report', 'approval', 'praise'));
  end if;
end $$;

notify pgrst, 'reload schema';
