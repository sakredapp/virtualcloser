-- Company search for Mira (Suite CXO, gap C2). Postgres full-text search, v1.
--
-- One stored, generated tsvector column per searchable table + a GIN index.
-- lib/knowledge/search.ts queries `search_tsv` with websearch_to_tsquery and
-- always pins rep_id first (existing rep_id indexes), then narrows by role
-- and re-checks every row on the server before Mira sees it. Until this runs
-- the code falls back to ILIKE, so applying it is a speed-up, not a gate.
--
-- Not indexed on purpose: payroll / commissions / comp tables (never
-- searched), Gmail and Calendar (searched live in the caller's own Google
-- account, nothing copied here).
--
-- RLS: every table below already has RLS on with no policies and grants to
-- service_role only. A generated column inherits that; no new grants or
-- policies are needed and no client role can read search_tsv.
--
-- Note: adding a STORED generated column rewrites the table (brief lock).
-- plaud_notes is the largest (transcripts); run off-peak. Idempotent.

-- Meetings: title > summary > transcript (transcript capped well under the 1MB tsvector limit).
alter table public.plaud_notes add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, left(coalesce(transcript, ''), 200000)), 'C')
  ) stored;
create index if not exists plaud_notes_search_idx on public.plaud_notes using gin (search_tsv);

-- Board cards: title > notes.
alter table public.cxo_board_cards add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(notes, '')), 'B')
  ) stored;
create index if not exists cxo_board_cards_search_idx on public.cxo_board_cards using gin (search_tsv);

-- To-dos: body > meeting title / partner.
alter table public.cxo_todos add column if not exists search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english'::regconfig, coalesce(body, '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce(meeting_title, '') || ' ' || coalesce(partner_name, '')), 'B')
  ) stored;
create index if not exists cxo_todos_search_idx on public.cxo_todos using gin (search_tsv);

-- In-app messages (only ever returned to the sender or recipient).
alter table public.member_messages add column if not exists search_tsv tsvector
  generated always as (to_tsvector('english'::regconfig, coalesce(body, ''))) stored;
create index if not exists member_messages_search_idx on public.member_messages using gin (search_tsv);

-- Brain items.
alter table public.brain_items add column if not exists search_tsv tsvector
  generated always as (to_tsvector('english'::regconfig, coalesce(content, ''))) stored;
create index if not exists brain_items_search_idx on public.brain_items using gin (search_tsv);
