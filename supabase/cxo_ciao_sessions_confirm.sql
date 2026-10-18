-- Ciao: confirm before write + chat sessions (owner 10-18, Pinnacle release blocker).
-- Applied to the Suite CXO project (ndschjbuyjmxtzqyjgyi). Server-only tables:
-- RLS on, nothing for anon/authenticated, explicit service_role grants.

-- One pending proposal per person: what Ciao will do once they say yes.
create table if not exists public.cxo_ciao_pending (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null,
  conversation_id uuid,
  actions jsonb not null,
  proposal text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists cxo_ciao_pending_member_idx on public.cxo_ciao_pending (rep_id, member_id, created_at desc);
alter table public.cxo_ciao_pending enable row level security;
revoke all on public.cxo_ciao_pending from anon, authenticated;
grant select, insert, update, delete on public.cxo_ciao_pending to service_role;

-- Chat sessions: a "New chat" or 2h idle starts a fresh conversation.
create table if not exists public.ciao_conversations (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null,
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now()
);
create index if not exists ciao_conversations_member_idx on public.ciao_conversations (member_id, last_at desc);
alter table public.ciao_conversations enable row level security;
revoke all on public.ciao_conversations from anon, authenticated;
grant select, insert, update, delete on public.ciao_conversations to service_role;

alter table public.agent_history add column if not exists conversation_id uuid;
create index if not exists agent_history_conversation_idx on public.agent_history (conversation_id, created_at);

notify pgrst, 'reload schema';
