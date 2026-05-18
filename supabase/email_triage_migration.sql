-- Email triage migration.
--
-- Adds inbound email sync + AI triage + reply-drafting for connected Gmail
-- accounts. Pairs with the new gmail.readonly / gmail.modify OAuth scopes in
-- lib/google.ts. Flow:
--
--   gmail_sync_state    → per-rep/member cursor for incremental sync
--   email_threads       → one row per Gmail thread, holds triage output + workflow status
--   email_messages      → individual messages within a thread (inbound + outbound)
--   email_drafts        → AI-generated reply drafts awaiting approval
--
-- Multi-tenant: every row carries rep_id, with optional owner_member_id for
-- enterprise teams (same pattern as agent_actions / leads). Tenant-level
-- (member_id NULL) tokens fall back through the existing lib/google.ts lookup
-- order.

create table if not exists email_threads (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null references reps(id) on delete cascade,
  owner_member_id uuid references members(id) on delete set null,
  gmail_thread_id text not null,
  gmail_history_id text,
  subject text,
  from_address text,
  from_name text,
  snippet text,
  last_message_at timestamptz,
  message_count int default 1,
  -- triage output
  priority text check (priority in ('urgent','high','normal','low','noise')),
  category text,
  needs_reply boolean default false,
  reasoning text,
  -- workflow
  status text not null default 'new'
    check (status in ('new','triaged','drafted','approved','sent','snoozed','archived','dismissed')),
  snoozed_until timestamptz,
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (rep_id, gmail_thread_id)
);

create index if not exists email_threads_rep_status_idx
  on email_threads (rep_id, status, last_message_at desc);

create index if not exists email_threads_owner_idx
  on email_threads (owner_member_id) where owner_member_id is not null;

create index if not exists email_threads_snoozed_idx
  on email_threads (snoozed_until) where snoozed_until is not null;

create table if not exists email_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references email_threads(id) on delete cascade,
  gmail_message_id text not null,
  direction text check (direction in ('inbound','outbound')),
  from_address text,
  to_addresses text[],
  cc_addresses text[],
  subject text,
  body_text text,
  body_html text,
  sent_at timestamptz,
  created_at timestamptz default now(),
  unique (gmail_message_id)
);

create index if not exists email_messages_thread_idx
  on email_messages (thread_id, sent_at desc);

create table if not exists email_drafts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references email_threads(id) on delete cascade,
  rep_id text not null references reps(id) on delete cascade,
  owner_member_id uuid references members(id) on delete set null,
  subject text,
  body text not null,
  model_used text,
  status text not null default 'pending'
    check (status in ('pending','approved','sent','dismissed','superseded')),
  edited_by_human boolean default false,
  feedback text,
  created_at timestamptz default now(),
  sent_at timestamptz,
  gmail_message_id text
);

create index if not exists email_drafts_thread_idx
  on email_drafts (thread_id, status);

create index if not exists email_drafts_rep_pending_idx
  on email_drafts (rep_id, status) where status = 'pending';

-- Note: a composite PK over (rep_id, member_id) was rejected because Postgres
-- forces every PK column to be NOT NULL, which broke tenant-level
-- (member_id NULL) sync state. We use a surrogate id PK + partial unique
-- indexes — same pattern as google_tokens.
create table if not exists gmail_sync_state (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null references reps(id) on delete cascade,
  member_id uuid references members(id) on delete cascade,
  last_history_id text,
  last_synced_at timestamptz,
  last_error text,
  consecutive_errors int default 0
);

create unique index if not exists gmail_sync_state_tenant_unique
  on gmail_sync_state (rep_id) where member_id is null;
create unique index if not exists gmail_sync_state_member_unique
  on gmail_sync_state (rep_id, member_id) where member_id is not null;

-- Enable RLS on every email-triage table. All writes go through the service
-- role (worker / server actions), which bypasses RLS. Enabling without
-- policies blocks anon-key access by default, which is what we want for
-- email bodies + sync state.
alter table email_threads enable row level security;
alter table email_messages enable row level security;
alter table email_drafts enable row level security;
alter table gmail_sync_state enable row level security;
