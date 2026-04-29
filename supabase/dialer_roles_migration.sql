-- ============================================================================
-- Multi-role dialer orchestration migration
-- Adds rule/queue/event tables to support:
--   concierge, appointment_setter, pipeline, live_transfer
-- Safe to re-run.
-- ============================================================================

-- members.phone — needed for live transfer bridge to reach reps by phone
alter table members add column if not exists phone text;
create index if not exists members_phone_idx on members(phone) where phone is not null;

create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create table if not exists dialer_workflow_rules (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  created_by_member_id  uuid references members(id) on delete set null,
  owner_member_id       uuid references members(id) on delete set null,
  scope                 text not null default 'personal'
                          check (scope in ('personal','team','account')),
  team_id               uuid references teams(id) on delete set null,
  name                  text not null,
  is_active             boolean not null default true,
  dialer_mode           text not null
                          check (dialer_mode in ('concierge','appointment_setter','pipeline','live_transfer')),
  trigger_kind          text not null
                          check (trigger_kind in (
                            'calendar_reminder',
                            'calendar_reschedule_request',
                            'crm_stage_changed',
                            'payment_event',
                            'csv_batch',
                            'telegram_command'
                          )),
  trigger_config        jsonb not null default '{}'::jsonb,
  script_profile        text,
  max_attempts          int not null default 2 check (max_attempts between 1 and 10),
  retry_delay_min       int not null default 30 check (retry_delay_min between 1 and 1440),
  max_daily_calls       int,
  business_hours_only   boolean not null default false,
  timezone              text,
  priority              int not null default 10,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists dialer_rules_rep_active_idx
  on dialer_workflow_rules(rep_id, is_active, priority desc, created_at desc);
create index if not exists dialer_rules_rep_mode_idx
  on dialer_workflow_rules(rep_id, dialer_mode, is_active);
create index if not exists dialer_rules_scope_idx
  on dialer_workflow_rules(rep_id, scope, is_active);
create index if not exists dialer_rules_team_idx
  on dialer_workflow_rules(rep_id, team_id, is_active)
  where team_id is not null;

alter table dialer_workflow_rules drop constraint if exists dialer_workflow_rules_scope_owner_check;
alter table dialer_workflow_rules add constraint dialer_workflow_rules_scope_owner_check
  check (
    (scope = 'personal' and owner_member_id is not null and team_id is null)
    or (scope = 'team' and team_id is not null)
    or (scope = 'account' and team_id is null)
  );

drop trigger if exists dialer_workflow_rules_set_updated_at on dialer_workflow_rules;
create trigger dialer_workflow_rules_set_updated_at
  before update on dialer_workflow_rules
  for each row execute function set_updated_at();

create table if not exists dialer_queue (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  owner_member_id       uuid references members(id) on delete set null,
  workflow_rule_id      uuid references dialer_workflow_rules(id) on delete set null,
  lead_id               uuid references leads(id) on delete set null,
  meeting_id            uuid,
  dialer_mode           text not null
                          check (dialer_mode in ('concierge','appointment_setter','pipeline','live_transfer')),
  status                text not null default 'pending'
                          check (status in ('pending','in_progress','completed','failed','cancelled','expired')),
  priority              int not null default 10,
  scheduled_for         timestamptz,
  attempt_count         int not null default 0,
  max_attempts          int not null default 2,
  next_retry_at         timestamptz,
  last_outcome          text,
  phone                 text,
  context               jsonb default '{}'::jsonb,
  source_kind           text not null default 'manual'
                          check (source_kind in ('calendar','crm','payment','csv','telegram','manual')),
  source_ref            text,
  provider              text,
  provider_call_id      text,
  live_transfer_status  text check (live_transfer_status in (
                          'pending','attempted','transferred','fallback_booked','fallback_callback','fallback_ended'
                        )),
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists dialer_queue_dispatch_idx
  on dialer_queue(rep_id, status, priority desc, scheduled_for)
  where status in ('pending','in_progress');
create index if not exists dialer_queue_retry_idx
  on dialer_queue(rep_id, status, next_retry_at)
  where status = 'pending' and next_retry_at is not null;
create index if not exists dialer_queue_mode_idx
  on dialer_queue(rep_id, dialer_mode, created_at desc);
create index if not exists dialer_queue_owner_idx
  on dialer_queue(rep_id, owner_member_id, status)
  where owner_member_id is not null;

drop trigger if exists dialer_queue_set_updated_at on dialer_queue;
create trigger dialer_queue_set_updated_at
  before update on dialer_queue
  for each row execute function set_updated_at();

create table if not exists dialer_queue_events (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  queue_id              uuid references dialer_queue(id) on delete cascade,
  workflow_rule_id      uuid references dialer_workflow_rules(id) on delete set null,
  member_id             uuid references members(id) on delete set null,
  event_type            text not null
                          check (event_type in (
                            'enqueued',
                            'dispatched',
                            'provider_call_started',
                            'provider_call_completed',
                            'retry_scheduled',
                            'failed',
                            'cancelled',
                            'live_transfer_attempted',
                            'live_transfer_fallback_booked',
                            'live_transfer_fallback_callback',
                            'live_transfer_fallback_ended'
                          )),
  outcome               text,
  reason                text,
  payload               jsonb default '{}'::jsonb,
  created_at            timestamptz default now()
);

create index if not exists dialer_queue_events_rep_created_idx
  on dialer_queue_events(rep_id, created_at desc);
create index if not exists dialer_queue_events_queue_idx
  on dialer_queue_events(queue_id, created_at desc);
create index if not exists dialer_queue_events_rule_idx
  on dialer_queue_events(workflow_rule_id, created_at desc);

create table if not exists dialer_transfer_availability (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  member_id             uuid not null references members(id) on delete cascade,
  day_of_week           int not null check (day_of_week between 0 and 6),
  start_local           time not null,
  end_local             time not null,
  timezone              text,
  accepts_live_transfer boolean not null default true,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists dialer_transfer_member_idx
  on dialer_transfer_availability(rep_id, member_id, day_of_week, start_local);
create index if not exists dialer_transfer_day_idx
  on dialer_transfer_availability(rep_id, day_of_week, accepts_live_transfer);

alter table dialer_transfer_availability drop constraint if exists dialer_transfer_availability_window_check;
alter table dialer_transfer_availability add constraint dialer_transfer_availability_window_check
  check (end_local > start_local);

create unique index if not exists dialer_transfer_unique_window
  on dialer_transfer_availability(rep_id, member_id, day_of_week, start_local, end_local);

drop trigger if exists dialer_transfer_availability_set_updated_at on dialer_transfer_availability;
create trigger dialer_transfer_availability_set_updated_at
  before update on dialer_transfer_availability
  for each row execute function set_updated_at();

alter table if exists voice_calls add column if not exists dialer_mode text default 'concierge';
alter table if exists voice_calls drop constraint if exists voice_calls_dialer_mode_check;
alter table if exists voice_calls add constraint voice_calls_dialer_mode_check
  check (dialer_mode in ('concierge','appointment_setter','pipeline','live_transfer'));
create index if not exists voice_calls_mode_idx
  on voice_calls(rep_id, dialer_mode, created_at desc);

alter table dialer_workflow_rules enable row level security;
alter table dialer_queue enable row level security;
alter table dialer_queue_events enable row level security;
alter table dialer_transfer_availability enable row level security;
