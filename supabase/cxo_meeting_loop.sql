-- Meetings -> to-dos -> boards, one loop (owner 10-09).
-- Each meeting note is read once into: to-dos (action items), board cards
-- (projects, assigned to a named partner), decisions + notes on the meeting,
-- and follow-up email suggestions (drafted only when the exec taps). The same
-- item raised again updates the existing to-do/card (mentions + latest
-- meeting). Corrections the exec makes are kept and shown to Mira next time.
alter table public.plaud_notes add column if not exists mira_digest jsonb;

alter table public.cxo_todos add column if not exists mentions integer not null default 1;
alter table public.cxo_todos add column if not exists source_label text;

create table if not exists public.cxo_mira_corrections (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid,
  kind text not null,
  item text not null,
  detail text,
  created_at timestamptz not null default now()
);
create index if not exists cxo_mira_corrections_rep_idx on public.cxo_mira_corrections (rep_id, created_at desc);
alter table public.cxo_mira_corrections enable row level security;
grant all on public.cxo_mira_corrections to service_role;

-- Typed tasks (owner 10-09): each to-do has a type with a one-tap action
-- (email -> Draft email, call -> Call, prep -> open the event, team -> open
-- Team), a priority, an optional due date, an optional partner assignee and
-- an optional link (partner, agent, meeting or board card).
alter table public.cxo_todos add column if not exists kind text not null default 'task';
alter table public.cxo_todos add column if not exists priority text not null default 'normal';
alter table public.cxo_todos add column if not exists due_date date;
alter table public.cxo_todos add column if not exists assignee_partner_id uuid references public.cxo_partners(id) on delete set null;
alter table public.cxo_todos add column if not exists assignee_name text;
alter table public.cxo_todos add column if not exists link_kind text;
alter table public.cxo_todos add column if not exists link_id text;
alter table public.cxo_todos add column if not exists link_label text;
alter table public.cxo_todos add column if not exists link_url text;
alter table public.cxo_todos add column if not exists link_phone text;
alter table public.cxo_todos add column if not exists link_email text;
do $$ begin
  alter table public.cxo_todos add constraint cxo_todos_kind_check check (kind in ('task','email','call','prep','team','personal'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cxo_todos add constraint cxo_todos_priority_check check (priority in ('high','normal','low'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.cxo_todos add constraint cxo_todos_link_kind_check check (link_kind is null or link_kind in ('partner','agent','meeting','card'));
exception when duplicate_object then null; end $$;

-- Team signals for "Have Mira build today's list": agents whose writing fell
-- by more than half against the 30 days before (from the dim rollup, fast),
-- and agents who joined 30-75 days ago with no policy yet (from the people
-- stats rollup).
create or replace function public.pinnacle_team_signals() returns jsonb
language sql stable security definer set search_path = public as $$
  with a as (
    select label, max(nullif(team, '')) team,
           coalesce(sum(policies) filter (where d > current_date - 30), 0) now30,
           coalesce(sum(policies) filter (where d <= current_date - 30 and d > current_date - 60), 0) prev30
    from pinnacle_dim_rollup
    where dim = 'agent' and d > current_date - 60 and d <= current_date
    group by label
  ), s as (
    select * from a where prev30 >= 6 and now30 <= prev30 * 0.4
    order by prev30 - now30 desc limit 5
  )
  select jsonb_build_object(
    'slipping', coalesce((select jsonb_agg(jsonb_build_object('agent', label, 'team', team, 'now30', now30, 'prev30', prev30)) from s), '[]'::jsonb),
    'slipping_total', (select count(*) from a where prev30 >= 6 and now30 <= prev30 * 0.4),
    'new_no_policy', (
      select coalesce(sum((j->>'joined')::int - (j->>'wrote')::int), 0)
      from pinnacle_people_rollup p, jsonb_array_elements(p.data->'joins_by_month') j
      where (j->>'m') between to_char(current_date - 75, 'YYYY-MM') and to_char(current_date - 30, 'YYYY-MM')
    )
  )
$$;
grant execute on function public.pinnacle_team_signals() to service_role;

-- Agent contact for a to-do's Call / Draft email action (Directory rows,
-- whitelisted contact fields only).
create or replace function public.pinnacle_agent_contacts(p_names text[])
returns table(name text, phone text, email text)
language sql stable security definer set search_path = public as $$
  select distinct on ((fields->>'Pinnacle Team Member'))
    (fields->>'Pinnacle Team Member'),
    coalesce(fields->>'Phone', fields->>'Phone Number', fields->>'Mobile', fields->>'Mobile Phone', fields->>'Cell', fields->>'Cell Phone'),
    coalesce(fields->>'Email', fields->>'Email Address')
  from pinnacle_airtable_records
  where table_name = 'Pinnacle Directory'
    and (fields->>'Pinnacle Team Member') = any(p_names)
$$;
grant execute on function public.pinnacle_agent_contacts(text[]) to service_role;
