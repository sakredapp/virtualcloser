-- Prep the Leadership Meeting Agenda (Suite CXO, Ciao). lib/meetings/agenda.ts.
--
-- cxo_meeting_agendas: one row per instance of the recurring leadership
-- meeting (rep_id, series_id, starts_at unique). Ciao drafts it about 24h
-- before; execs edit `body`; it goes on the invite only after their yes
-- (added_at). Items people asked to raise collect in `raised` before the draft.
--
-- cxo_meeting_series: which recurring series an exec marked as the leadership
-- meeting ('leadership'), or told Ciao is not one ('not').
--
-- Idempotent. RLS on, no anon/authenticated access; the app uses service_role.

create table if not exists public.cxo_meeting_agendas (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  series_id text not null,
  event_id text not null,
  title text not null default '',
  starts_at timestamptz not null,
  organizer_email text,
  attendee_emails text[] not null default '{}',
  sections jsonb not null default '{}'::jsonb,
  body text not null default '',
  raised jsonb not null default '[]'::jsonb,
  prior_note_id uuid,
  drafted_at timestamptz,
  edited_at timestamptz,
  edited_by uuid,
  added_at timestamptz,
  added_by uuid,
  held_note_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cxo_meeting_agendas_instance_uidx on public.cxo_meeting_agendas (rep_id, series_id, starts_at);
create index if not exists cxo_meeting_agendas_rep_start_idx on public.cxo_meeting_agendas (rep_id, starts_at desc);

create table if not exists public.cxo_meeting_series (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  series_id text not null,
  title text not null default '',
  choice text not null default 'leadership' check (choice in ('leadership', 'not')),
  marked_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cxo_meeting_series_uidx on public.cxo_meeting_series (rep_id, series_id);

alter table public.cxo_meeting_agendas enable row level security;
alter table public.cxo_meeting_series enable row level security;

revoke all on public.cxo_meeting_agendas from anon, authenticated;
revoke all on public.cxo_meeting_series from anon, authenticated;
grant select, insert, update, delete on public.cxo_meeting_agendas to service_role;
grant select, insert, update, delete on public.cxo_meeting_series to service_role;

notify pgrst, 'reload schema';
