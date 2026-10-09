-- Today: the exec's to-do list. Items come from the exec (manual), from
-- meeting notes/recordings (extracted once per note), from partner messages,
-- or from Mira. Deleting an extracted item is soft (deleted_at) so the next
-- scan never brings it back.
create table if not exists public.cxo_todos (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  body text not null,
  source text not null default 'manual' check (source in ('manual','meeting','partner','mira')),
  note_id uuid references public.plaud_notes(id) on delete set null,
  meeting_title text,
  meeting_at timestamptz,
  partner_id uuid references public.cxo_partners(id) on delete set null,
  partner_name text,
  thread_id text,
  source_key text,
  position integer not null default 0,
  done_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cxo_todos_member_idx on public.cxo_todos (rep_id, member_id) where deleted_at is null;
create unique index if not exists cxo_todos_source_key_uq on public.cxo_todos (rep_id, member_id, source_key) where source_key is not null;

create table if not exists public.cxo_todo_note_scans (
  note_id uuid primary key references public.plaud_notes(id) on delete cascade,
  rep_id text not null,
  scanned_at timestamptz not null default now(),
  items integer not null default 0
);

create or replace function public.cxo_todos_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists cxo_todos_touch on public.cxo_todos;
create trigger cxo_todos_touch before update on public.cxo_todos for each row execute function public.cxo_todos_touch();

alter table public.cxo_todos enable row level security;
alter table public.cxo_todo_note_scans enable row level security;
grant all on public.cxo_todos, public.cxo_todo_note_scans to service_role;
