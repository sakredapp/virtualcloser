-- Meetings inbound (Zapier / any webhook): one secret URL per member.
create table if not exists public.meeting_inbound_tokens (
  token text primary key,
  rep_id text not null,
  member_id uuid not null,
  created_at timestamptz not null default now(),
  unique (rep_id, member_id)
);
alter table public.meeting_inbound_tokens enable row level security;
grant select, insert, update, delete on public.meeting_inbound_tokens to service_role;

alter table public.plaud_notes add column if not exists source text;
alter table public.plaud_notes add column if not exists calendar_event_id text;
alter table public.plaud_notes add column if not exists attendees jsonb;
