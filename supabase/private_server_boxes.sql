-- Private-server fleet (selfhost/): one row per client box, written by
-- app/api/ops/private-server/report when a box's health agent checks in
-- (selfhost/health/agent.mjs, every minute, signed with the box's licence).
-- Ours only: the report carries box status, never client data or secrets.
--   status          ok | failing, from the box's latest report
--   failing_checks  names of the checks that failed in that report
--   last_seen_at    when the box last checked in; the view below calls a box
--                   'offline' when that is more than 10 minutes ago
--
-- Suite CXO DB ndschjbuyjmxtzqyjgyi. Additive only. Safe to run more than once.

create table if not exists public.private_server_boxes (
  box_id text primary key,
  client_id text not null,
  client_name text not null,
  seats integer not null,
  licence_expires_at date not null,
  status text not null check (status in ('ok', 'failing')),
  failing_checks text[] not null default '{}',
  last_report jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ok_at timestamptz
);

alter table public.private_server_boxes enable row level security;
revoke all on public.private_server_boxes from anon, authenticated;
grant select, insert, update, delete on public.private_server_boxes to service_role;

create or replace view public.private_server_box_status
with (security_invoker = true) as
select
  box_id, client_id, client_name, seats, licence_expires_at,
  case when last_seen_at < now() - interval '10 minutes' then 'offline' else status end as health,
  failing_checks, last_seen_at, last_ok_at, first_seen_at,
  (licence_expires_at - current_date) as licence_days_left
from public.private_server_boxes;

revoke all on public.private_server_box_status from anon, authenticated;
grant select on public.private_server_box_status to service_role;

notify pgrst, 'reload schema';
