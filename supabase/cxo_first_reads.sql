-- Suite CXO "first read" (lib/firstRead). After a person connects a Google
-- account, the assistant reads it once (calendar past 14 days + next 14 days;
-- the inbox's last 14 days of headers only where the inbox is offered and the
-- grant has Gmail) and keeps what it learned here: the people they meet and
-- write to most, recurring meetings, upcoming double-bookings, emails waiting
-- on their reply, and a few things it can do this week.
--
-- Only the derived summary is stored (names, subjects, counts, times). Never
-- an email body, a snippet or a token. One row per connected Google account
-- (google_tokens.id); disconnecting the account deletes its row (cascade).
--
-- Service-role only, like the sibling cxo tables: RLS on, no policies, anon
-- and authenticated revoked. The app reads and writes it scoped by rep_id and
-- the accounts the signed-in member may use. Idempotent: safe to run again.

create table if not exists public.cxo_first_reads (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid,
  account_id uuid not null references public.google_tokens(id) on delete cascade,
  google_email text,
  status text not null default 'pending' check (status in ('pending', 'done', 'error')),
  summary jsonb not null default '{}'::jsonb,
  error text,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cxo_first_reads_account_uq on public.cxo_first_reads (rep_id, account_id);
create index if not exists cxo_first_reads_member_idx on public.cxo_first_reads (rep_id, member_id);
alter table public.cxo_first_reads enable row level security;
revoke all on public.cxo_first_reads from anon, authenticated;
grant select, insert, update, delete on public.cxo_first_reads to service_role;

notify pgrst, 'reload schema';
