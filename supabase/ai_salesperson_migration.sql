-- ============================================================================
-- AI Salesperson migration.
--
-- Adds the multi-setter ("AI Salesperson") data model on top of the existing
-- single-config Appointment Setter. Each rep_id can now own N salespeople;
-- the legacy `client_integrations.appointment_setter_config` JSON row is
-- migrated lazily into the first ai_salespeople row on demand by
-- lib/ai-salesperson.ts → getOrCreateDefaultSalesperson(repId).
--
-- Idempotent: every statement is `if not exists` / `add column if not exists`,
-- safe to re-run.
-- ============================================================================

-- ── ai_salespeople ────────────────────────────────────────────────────────
create table if not exists ai_salespeople (
  id                       uuid primary key default gen_random_uuid(),
  rep_id                   text not null references reps(id) on delete cascade,
  name                     text not null,
  status                   text not null default 'draft'
                             check (status in ('draft','active','paused','archived')),
  -- Basic setup (spec §4)
  product_category         text,
  assigned_member_id       uuid references members(id) on delete set null,
  appointment_type         text default 'phone',
  appointment_duration_min int default 30,
  -- Persona + scripts (spec §5–9). All JSONB blobs to keep migration additive.
  product_intent           jsonb default '{}'::jsonb,    -- {name, explanation, audience, opt_in_reason, talking_points, avoid, compliance_notes}
  voice_persona            jsonb default '{}'::jsonb,    -- {ai_name, role_title, tone, voice_id, opener}
  call_script              jsonb default '{}'::jsonb,    -- {opening, confirmation, reason, qualifying[], pitch, close, compliance, escalation_rules}
  sms_scripts              jsonb default '{}'::jsonb,    -- {first, second, followup, confirm, missed, reschedule, no_response, stop_text}
  email_templates          jsonb default '{}'::jsonb,    -- {initial, followup, confirmation, missed, reschedule, longterm}
  objection_responses      jsonb default '[]'::jsonb,    -- [{trigger, response}]
  -- Schedule + calendar (spec §10–11)
  schedule                 jsonb default '{}'::jsonb,    -- {active_days[], start_hour, end_hour, timezone, max_calls_per_day, max_attempts_per_lead, retry_delay_min, leads_per_hour, leads_per_day, quiet_hours}
  calendar                 jsonb default '{}'::jsonb,    -- {provider, calendar_id, calendar_url, buffer_min, max_appts_per_day, confirmation_sms, confirmation_email, reminder_sms, reminder_email}
  -- CRM push (spec §17). Always-on per locked decision; this stores the resolved target.
  crm_push                 jsonb default '{}'::jsonb,    -- {provider, target_pipeline_id, target_pipeline_name, target_stage_id, target_stage_name, assigned_user, last_resolved_at}
  -- SMS/voice identity (locked decision #2). Optional override; falls back to rep number.
  phone_number             text,
  phone_provider           text check (phone_provider in ('revring','twilio')),
  -- Audit
  created_by_member_id     uuid references members(id) on delete set null,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now(),
  archived_at              timestamptz
);

create index if not exists ai_salespeople_rep_idx          on ai_salespeople(rep_id);
create index if not exists ai_salespeople_rep_status_idx   on ai_salespeople(rep_id, status) where archived_at is null;
create index if not exists ai_salespeople_assigned_idx     on ai_salespeople(assigned_member_id) where assigned_member_id is not null;

drop trigger if exists ai_salespeople_set_updated_at on ai_salespeople;
create trigger ai_salespeople_set_updated_at
  before update on ai_salespeople
  for each row execute function set_updated_at();

-- ── Foreign keys onto existing tables ─────────────────────────────────────
-- All nullable for back-compat; legacy rows untouched.
alter table dialer_queue
  add column if not exists ai_salesperson_id uuid references ai_salespeople(id) on delete set null;
create index if not exists dialer_queue_setter_idx
  on dialer_queue(ai_salesperson_id, status)
  where ai_salesperson_id is not null;

alter table voice_calls
  add column if not exists ai_salesperson_id uuid references ai_salespeople(id) on delete set null;
create index if not exists voice_calls_setter_idx
  on voice_calls(ai_salesperson_id, started_at desc)
  where ai_salesperson_id is not null;

alter table leads
  add column if not exists ai_salesperson_id uuid references ai_salespeople(id) on delete set null;
-- Dedup support (spec locked decision #3): query path for "is this phone already
-- claimed by another setter under the same rep_id?"
create index if not exists leads_rep_phone_setter_idx
  on leads(rep_id, ai_salesperson_id)
  where ai_salesperson_id is not null;

-- Knowledge base reuse: roleplay_training_docs already powers AI dialer + roleplay.
-- Optional FK so a doc can be scoped to a specific salesperson; null means "shared
-- across all setters under this rep_id" (current behavior).
alter table if exists roleplay_training_docs
  add column if not exists ai_salesperson_id uuid references ai_salespeople(id) on delete set null;

-- ── ai_salesperson_followups ──────────────────────────────────────────────
-- Future tasks created from call outcomes ("call me in two weeks").
create table if not exists ai_salesperson_followups (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  ai_salesperson_id   uuid not null references ai_salespeople(id) on delete cascade,
  lead_id             uuid references leads(id) on delete set null,
  queue_id            uuid references dialer_queue(id) on delete set null,
  source_call_id      uuid references voice_calls(id) on delete set null,
  due_at              timestamptz not null,
  channel             text not null check (channel in ('call','sms','email')),
  reason              text,
  status              text not null default 'pending'
                        check (status in ('pending','queued','done','cancelled')),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists ai_salesperson_followups_due_idx
  on ai_salesperson_followups(rep_id, status, due_at)
  where status in ('pending','queued');
create index if not exists ai_salesperson_followups_setter_idx
  on ai_salesperson_followups(ai_salesperson_id, status, due_at);

drop trigger if exists ai_salesperson_followups_set_updated_at on ai_salesperson_followups;
create trigger ai_salesperson_followups_set_updated_at
  before update on ai_salesperson_followups
  for each row execute function set_updated_at();

-- ── ai_salesperson_campaigns ──────────────────────────────────────────────
-- Optional grouping for lead imports; analytics filters can group by campaign.
create table if not exists ai_salesperson_campaigns (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  ai_salesperson_id   uuid not null references ai_salespeople(id) on delete cascade,
  name                text not null,
  source              text,
  opt_in_confirmed    boolean default false,
  notes               text,
  created_by_member_id uuid references members(id) on delete set null,
  created_at          timestamptz default now()
);

create index if not exists ai_salesperson_campaigns_setter_idx
  on ai_salesperson_campaigns(ai_salesperson_id, created_at desc);

-- Audit: tag dialer_queue rows with their campaign for analytics
alter table dialer_queue
  add column if not exists campaign_id uuid references ai_salesperson_campaigns(id) on delete set null;

-- ── End ───────────────────────────────────────────────────────────────────
