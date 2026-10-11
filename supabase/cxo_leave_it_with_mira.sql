-- Leave it with Mira (owner 10-11). Anyone in the org leaves a message for
-- anyone else (member_messages, unchanged). On receipt Mira sorts it for the
-- recipient: what it needs, a one-line reason, one suggested next step, and
-- later what the recipient did with it. One row per message, read only by
-- the server. The sender is shown the outcome and nothing else from here.
-- Idempotent.
create table if not exists member_message_triage (
  message_id uuid primary key references member_messages(id) on delete cascade,
  rep_id text not null,
  to_member_id uuid not null references members(id) on delete cascade,
  category text not null check (category in ('decision', 'answer', 'fyi', 'time')),
  reason text not null default '',
  rank integer not null default 0,
  suggestion text not null default 'reply' check (suggestion in ('reply', 'agenda', 'todo', 'card', 'time', 'none')),
  draft text,
  outcome text check (outcome in ('answered', 'agenda', 'todo', 'card', 'time_booked')),
  outcome_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists member_message_triage_to_idx on member_message_triage (rep_id, to_member_id);
alter table member_message_triage enable row level security;
revoke all on member_message_triage from anon, authenticated;
grant select, insert, update, delete on member_message_triage to service_role;
notify pgrst, 'reload schema';
