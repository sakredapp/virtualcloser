-- Suite CXO company decision log (Ciao). One row per decision Ciao read out
-- of a meeting (plaud_notes.mira_digest.decisions), so "what did we decide
-- about X" has one answer across every meeting, and a later decision that
-- reverses an earlier one is flagged.
--
-- Service-role only, like the sibling cxo tables: RLS on, no policies, anon
-- and authenticated revoked. The app reads it scoped by rep_id and by the
-- meeting's own visibility (lib/decisions/log.ts, canSeeHit).
-- (note_id, idx) is unique, so re-reading a meeting never makes a second copy.
-- Idempotent: safe to run again.

create table if not exists public.cxo_decisions (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  note_id uuid not null references public.plaud_notes(id) on delete cascade,
  idx integer not null check (idx >= 0),
  text text not null check (char_length(text) between 1 and 600),
  decided_by text check (decided_by is null or char_length(decided_by) <= 120),
  decided_at timestamptz not null,
  meeting_title text check (meeting_title is null or char_length(meeting_title) <= 300),
  topic text not null default '' check (char_length(topic) <= 600),
  reverses_id uuid references public.cxo_decisions(id) on delete set null,
  reversed_by_id uuid references public.cxo_decisions(id) on delete set null,
  reversal_reason text check (reversal_reason is null or char_length(reversal_reason) <= 300),
  created_at timestamptz not null default now()
);
create unique index if not exists cxo_decisions_note_idx_uq on public.cxo_decisions (note_id, idx);
create index if not exists cxo_decisions_rep_when_idx on public.cxo_decisions (rep_id, decided_at desc);
alter table public.cxo_decisions enable row level security;
revoke all on public.cxo_decisions from anon, authenticated;
grant select, insert, update, delete on public.cxo_decisions to service_role;

notify pgrst, 'reload schema';
