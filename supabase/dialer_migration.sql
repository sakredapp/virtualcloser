-- ============================================================================
-- AI Dialer + meetings + WAVV KPIs migration
-- Self-bootstrapping. Safe to re-run.
--
-- WHY: The "true virtual closer" build adds three things on top of the
-- existing pipelines/agent stack:
--
--   1. leads.phone           — first-class phone number on every lead
--                              (today phone lives in notes which is useless
--                              for outbound).
--   2. meetings              — normalized appointments hydrated from Google
--                              Calendar (and optionally Cal.com / GHL). One
--                              row per scheduled call. Source of truth for
--                              the AI confirmation dialer.
--   3. voice_calls           — every outbound (or inbound) call our system
--                              places via Vapi / Retell / WAVV / Twilio.
--                              Full transcript + recording + DTMF + cost.
--   4. dialer_kpis           — daily rollup keyed off voice_calls + WAVV
--                              ingest. Powers dashboard widgets.
-- ============================================================================

-- Helper trigger function (created by other migrations too — keep idempotent)
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── leads.phone ──────────────────────────────────────────────────────────
-- Phone is now first class. Backfill happens lazily: the next CRM sync from
-- GHL/HubSpot will populate it (`crm-sync.ts` upserts contact.phone) and
-- bulk-import already captures phone strings — we just had nowhere to land
-- them.
alter table leads add column if not exists phone text;
create index if not exists leads_rep_phone_idx
  on leads(rep_id, phone) where phone is not null;

-- ── meetings ─────────────────────────────────────────────────────────────
-- Normalized appointment record. Hydrated from Google Calendar (primary v1)
-- and Cal.com webhooks (optional). Each row is one scheduled call/meeting.
-- The dialer cron scans this table for `scheduled_at` 30–90 min out and
-- places confirmation calls.
--
-- A meeting may or may not be linked to a `lead`. Walk-up calendar events
-- without a matching lead still get confirmation calls if a phone number
-- is on the row (e.g. parsed from event description) — but the typical
-- path is `lead_id` set, phone lifted from leads.phone.
create table if not exists meetings (
  id                   uuid primary key default gen_random_uuid(),
  rep_id               text not null references reps(id) on delete cascade,
  lead_id              uuid references leads(id) on delete set null,
  prospect_id          uuid,                                    -- references prospects(id) (no FK to avoid cross-schema dep)
  source               text not null check (source in ('google','cal','ghl','manual')),
  source_event_id      text,                                    -- google event id / cal uid / ghl appointment id
  attendee_name        text,
  attendee_email       text,
  phone                text,                                    -- snapshot at hydrate time (lead.phone may move)
  scheduled_at         timestamptz not null,
  duration_min         int default 30,
  timezone             text,
  title                text,
  description          text,
  meeting_url          text,                                    -- zoom / meet / etc
  status               text not null default 'scheduled'
                       check (status in (
                         'scheduled','confirmed','reschedule_requested',
                         'rescheduled','cancelled','no_response',
                         'completed','noshow'
                       )),
  confirmation_attempts int not null default 0,
  last_call_id         uuid,                                    -- references voice_calls(id) — set after first call
  metadata             jsonb default '{}'::jsonb,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now(),
  unique (rep_id, source, source_event_id)
);

create index if not exists meetings_rep_scheduled_idx
  on meetings(rep_id, scheduled_at);
create index if not exists meetings_rep_status_idx
  on meetings(rep_id, status);
create index if not exists meetings_lead_idx
  on meetings(lead_id) where lead_id is not null;
-- Hot path for the confirm-appointments cron: find meetings 30–90 min out,
-- still in 'scheduled' state, that haven't been called yet.
create index if not exists meetings_dialer_window_idx
  on meetings(rep_id, scheduled_at)
  where status = 'scheduled' and confirmation_attempts = 0;

drop trigger if exists meetings_set_updated_at on meetings;
create trigger meetings_set_updated_at
  before update on meetings
  for each row execute function set_updated_at();

alter table meetings enable row level security;

-- ── voice_calls ──────────────────────────────────────────────────────────
-- Every outbound or inbound call our system places. Provider-agnostic shape
-- so Vapi, Retell, Bland, Twilio, WAVV all land here.
create table if not exists voice_calls (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  meeting_id        uuid references meetings(id) on delete set null,
  lead_id           uuid references leads(id) on delete set null,
  provider          text not null check (provider in ('vapi','retell','bland','twilio','wavv','manual')),
  provider_call_id  text,                                       -- vapi call id, twilio sid, etc.
  direction         text not null default 'outbound_confirm'
                    check (direction in (
                      'outbound_confirm','outbound_reschedule',
                      'outbound_followup','outbound_dial','inbound'
                    )),
  to_number         text,
  from_number       text,
  status            text not null default 'queued'
                    check (status in (
                      'queued','ringing','in_progress','completed',
                      'failed','no_answer','voicemail','busy','cancelled'
                    )),
  outcome           text check (outcome in (
                      'confirmed','reschedule_requested','rescheduled',
                      'cancelled','voicemail','no_answer','failed',
                      'connected','noshow_acknowledged'
                    )),
  dtmf_input        text,                                       -- "1" / "2" — what the lead pressed
  recording_url     text,
  transcript        text,
  duration_sec      int,
  cost_cents        int,
  started_at        timestamptz,
  ended_at          timestamptz,
  raw               jsonb default '{}'::jsonb,                  -- raw provider payload for debugging
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (provider, provider_call_id)
);

create index if not exists voice_calls_rep_created_idx
  on voice_calls(rep_id, created_at desc);
create index if not exists voice_calls_meeting_idx
  on voice_calls(meeting_id) where meeting_id is not null;
create index if not exists voice_calls_lead_idx
  on voice_calls(lead_id) where lead_id is not null;
create index if not exists voice_calls_outcome_idx
  on voice_calls(rep_id, outcome) where outcome is not null;

drop trigger if exists voice_calls_set_updated_at on voice_calls;
create trigger voice_calls_set_updated_at
  before update on voice_calls
  for each row execute function set_updated_at();

alter table voice_calls enable row level security;

-- ── dialer_kpis ──────────────────────────────────────────────────────────
-- Daily rollup of dialer activity per rep. WAVV webhook ingests dispositions
-- straight into voice_calls; a nightly job (or on-demand recompute) folds
-- them into this table for fast dashboard reads.
create table if not exists dialer_kpis (
  rep_id              text not null references reps(id) on delete cascade,
  day                 date not null,
  dials               int not null default 0,
  connects            int not null default 0,
  conversations       int not null default 0,                   -- connect with > 30s talk time
  appointments_set    int not null default 0,
  voicemails          int not null default 0,
  no_answers          int not null default 0,
  dial_time_seconds   int not null default 0,
  cost_cents          int not null default 0,
  updated_at          timestamptz default now(),
  primary key (rep_id, day)
);

create index if not exists dialer_kpis_rep_day_idx
  on dialer_kpis(rep_id, day desc);

drop trigger if exists dialer_kpis_set_updated_at on dialer_kpis;
create trigger dialer_kpis_set_updated_at
  before update on dialer_kpis
  for each row execute function set_updated_at();

alter table dialer_kpis enable row level security;
