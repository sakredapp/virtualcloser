-- Suite CXO monthly board update (Ciao). One row per company per month
-- covered (the month that just closed): Ciao's deterministic draft of the
-- investor / board update (headline numbers vs plan and last year from the
-- book, the sales plan and QuickBooks; wins; misses; decisions from meetings;
-- asks), plus the exec's own edited text. Ciao never sends it: the owner or an
-- admin edits it in the app, copies it and sends it themselves.
-- (lib/boardUpdate/data.ts; drafted by the Hetzner worker on the first
-- business day of the month, or on demand through Ciao.)
--
-- Service-role only, like the sibling cxo tables: RLS on, no policies, anon
-- and authenticated revoked. The app reads and writes it scoped by rep_id,
-- for owners and admins only.
-- (rep_id, month) is unique, so a second check never makes a second draft.
-- Idempotent: safe to run again.

create table if not exists public.cxo_board_updates (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  sections jsonb not null default '{}'::jsonb,
  draft_text text not null default '' check (char_length(draft_text) <= 20000),
  body text not null default '' check (char_length(body) <= 20000),
  status text not null default 'draft' check (status in ('draft', 'edited', 'sent')),
  edited boolean not null default false,
  generated_at timestamptz not null default now(),
  generated_by uuid,
  edited_at timestamptz,
  edited_by uuid,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cxo_board_updates_rep_month_uq on public.cxo_board_updates (rep_id, month);
alter table public.cxo_board_updates enable row level security;
revoke all on public.cxo_board_updates from anon, authenticated;
grant select, insert, update, delete on public.cxo_board_updates to service_role;

notify pgrst, 'reload schema';
