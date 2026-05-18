-- Plaud Agent migration.
--
-- Turns the existing plaud_notes ingestion into an agentic pipeline. After a
-- recording lands via the Zapier webhook, the Hetzner agent tick:
--   1. Triages the note (trash / action / training / executive / unclear).
--   2. Plans concrete actions with Claude tool-use (assign tasks to members,
--      generate Drive Docs, draft emails, propose calendar events, update CRM
--      sheets).
--   3. Auto-executes safe actions; queues people-touching actions for human
--      approval in the dashboard.
--
-- Tables / changes:
--   plaud_notes        +triage_class, +triage_reasoning, +triage_model,
--                      +triaged_at, +duration_seconds, +owner_member_id
--   plaud_actions      new — one row per proposed action with status/result
--   rep_contacts       new — directory the agent uses to resolve "Lauren" → email
--   plaud_settings     new — per-rep folder ids + autoapprove flags

-- ── plaud_notes: triage + ownership columns ──────────────────────────────
alter table plaud_notes add column if not exists triage_class text
  check (triage_class in ('trash','action','training','executive','unclear'));
alter table plaud_notes add column if not exists triage_reasoning text;
alter table plaud_notes add column if not exists triage_model text;
alter table plaud_notes add column if not exists triaged_at timestamptz;
alter table plaud_notes add column if not exists duration_seconds int;
alter table plaud_notes add column if not exists owner_member_id uuid references members(id) on delete set null;

-- Work-queue index: the agent tick reads "rep_ids in allow-list AND
-- triage_class is null" — keep that read cheap.
create index if not exists plaud_notes_triage_queue_idx
  on plaud_notes (rep_id, occurred_at)
  where triage_class is null;

create index if not exists plaud_notes_owner_idx
  on plaud_notes (owner_member_id) where owner_member_id is not null;

-- ── plaud_actions: the agent's proposed work + execution audit trail ─────
create table if not exists plaud_actions (
  id                    uuid primary key default gen_random_uuid(),
  note_id               uuid not null references plaud_notes(id) on delete cascade,
  rep_id                text not null references reps(id) on delete cascade,
  owner_member_id       uuid references members(id) on delete set null,
  kind                  text not null check (kind in (
    'create_task','create_doc','update_sheet',
    'send_email','create_calendar_event','notify_member'
  )),
  -- Full structured args from the agent. Shape varies by kind; see
  -- lib/plaud/agentTools.ts for the schema each tool emits.
  payload               jsonb not null default '{}'::jsonb,
  -- Resolved recipient/assignee. Exactly one of target_member_id /
  -- target_contact_id is set when resolution succeeded; both null + a
  -- recipient_unresolved string in payload means the agent named someone
  -- not in the directory.
  target_member_id      uuid references members(id) on delete set null,
  target_contact_id     uuid,
  target_email          text,
  status                text not null default 'pending'
    check (status in ('pending','approved','executed','failed','dismissed','superseded')),
  auto_executed         boolean default false,
  -- Result payload from the executor (drive_url, message_id, event_id, ...).
  result                jsonb,
  reasoning             text,
  error                 text,
  created_at            timestamptz default now(),
  approved_at           timestamptz,
  executed_at           timestamptz,
  updated_at            timestamptz default now()
);

create index if not exists plaud_actions_note_idx
  on plaud_actions (note_id);
create index if not exists plaud_actions_rep_status_idx
  on plaud_actions (rep_id, status, created_at desc);
create index if not exists plaud_actions_pending_queue_idx
  on plaud_actions (rep_id, kind, created_at)
  where status = 'pending';
create index if not exists plaud_actions_member_idx
  on plaud_actions (target_member_id) where target_member_id is not null;

-- ── rep_contacts: directory used by the agent for name resolution ────────
-- Doubles as a lightweight contact book usable elsewhere (email triage's
-- "send to Lauren" picker, etc). Seeded one-time from email_threads,
-- calendar attendees, and leads; updated as Spencer approves actions with
-- unresolved recipients.
create table if not exists rep_contacts (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  display_name          text not null,
  aliases               text[] default '{}',
  email                 text,
  phone                 text,
  role                  text,
  member_id             uuid references members(id) on delete set null,
  notes                 text,
  source                text,  -- 'email_seed' | 'calendar_seed' | 'lead_seed' | 'manual' | 'plaud_approval'
  last_used_at          timestamptz,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create unique index if not exists rep_contacts_rep_email_idx
  on rep_contacts (rep_id, lower(email)) where email is not null;
create index if not exists rep_contacts_rep_name_idx
  on rep_contacts (rep_id, lower(display_name));
create index if not exists rep_contacts_member_idx
  on rep_contacts (member_id) where member_id is not null;

-- GIN on aliases array so "find by mention" can do `aliases @> ARRAY['lauren']`.
-- Display name fuzzy match goes through the lower(display_name) btree above
-- (exact + ILIKE prefix is enough for v1).
create index if not exists rep_contacts_aliases_idx
  on rep_contacts using gin (aliases);

-- ── plaud_settings: per-rep agent configuration ──────────────────────────
-- Drive folder ids are auto-created on first agent run if null. Autoapprove
-- flags are intentionally locked off in v1 (the executor checks both the
-- column and a hard-coded server-side gate before honoring them).
create table if not exists plaud_settings (
  rep_id                text primary key references reps(id) on delete cascade,
  training_folder_id    text,
  exec_folder_id        text,
  action_folder_id      text,
  resource_folder_id    text,
  auto_send_email       boolean default false,
  auto_send_calendar    boolean default false,
  updated_at            timestamptz default now()
);
