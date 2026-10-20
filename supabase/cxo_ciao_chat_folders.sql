-- Ciao chat screen: folders, pin, rename, soft delete (owner 2026-10-20).
-- NOT YET APPLIED. Suite CXO project (ndschjbuyjmxtzqyjgyi) only.
-- Same shape as cxo_ciao_sessions_confirm.sql: server-only tables, RLS on,
-- nothing for anon/authenticated, explicit service_role grants. Every read
-- and write in lib/agent/chatOrganize.ts is scoped by member_id.
-- Until this runs the chat list still loads (no folders, no pins) and the
-- organise actions answer 503 "not_ready".

-- A person's own folders for their Ciao chats.
create table if not exists public.ciao_chat_folders (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  created_at timestamptz not null default now()
);
create index if not exists ciao_chat_folders_member_idx on public.ciao_chat_folders (member_id, created_at);
alter table public.ciao_chat_folders enable row level security;
revoke all on public.ciao_chat_folders from anon, authenticated;
grant select, insert, update, delete on public.ciao_chat_folders to service_role;

-- Per chat: a name the person gave it, pinned, its folder, and soft delete
-- (the turns stay in agent_history; the chat only leaves the list).
alter table public.ciao_conversations add column if not exists title text check (title is null or char_length(title) between 1 and 80);
alter table public.ciao_conversations add column if not exists pinned_at timestamptz;
alter table public.ciao_conversations add column if not exists folder_id uuid references public.ciao_chat_folders (id) on delete set null;
alter table public.ciao_conversations add column if not exists deleted_at timestamptz;
create index if not exists ciao_conversations_folder_idx on public.ciao_conversations (folder_id) where folder_id is not null;

notify pgrst, 'reload schema';
