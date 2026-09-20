-- ── Unified lead activity model ───────────────────────────────────────────────
-- One canonical store for manually-logged prospect activities (note, email,
-- visit, and anything future). Calls stay in call_logs (commission/reporting
-- pipeline reads that table); the read layer in lib/crmLeads.ts normalizes
-- call_logs + voice_calls + sms_messages + lead_events + lead_activities into a
-- single Activity[] feed. This table is the open-ended extension point so a new
-- activity type is config, not a new table.
--
-- Apply order: after schema.sql. Idempotent.

create table if not exists lead_activities (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  lead_id           uuid not null references leads(id) on delete cascade,
  type              text not null check (type in ('note','email','visit','meeting','task','other')),
  body              text,
  occurred_at       timestamptz not null default now(),
  author_member_id  uuid references members(id) on delete set null,
  payload           jsonb not null default '{}'::jsonb,  -- type-specific: subject, direction, outcome, address, etc.
  source            text not null default 'manual' check (source in ('manual','ai','sync')),
  created_at        timestamptz default now()
);

create index if not exists lead_activities_lead_idx on lead_activities(lead_id, occurred_at desc);
create index if not exists lead_activities_rep_idx  on lead_activities(rep_id, occurred_at desc);
create index if not exists lead_activities_type_idx on lead_activities(rep_id, type);

-- RLS: service-role only (matches lead_notes/lead_events pattern in
-- enable_rls_advisory_tables.sql). App access is via service-role client.
alter table lead_activities enable row level security;

-- ── Address fields on leads ───────────────────────────────────────────────────
-- For field-sales / in-person pipelines (house visits).
alter table leads add column if not exists street text;
alter table leads add column if not exists city   text;
alter table leads add column if not exists state  text;
alter table leads add column if not exists zip    text;
