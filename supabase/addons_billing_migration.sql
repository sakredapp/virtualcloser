-- ============================================================================
-- Add-ons + usage tracking + billing periods
--
-- Three tables that power the à-la-carte add-on system:
--   1. client_addons    — which add-ons each client has active (per rep_id)
--   2. usage_events     — append-only log of every cap-counted event
--                         (Vapi appt confirmed, roleplay minute, WAVV dial)
--   3. billing_periods  — monthly rollup. Cap-hit emails reference this row.
--                         Closed by 1st-of-month cron.
--
-- Plus:
--   - prospects.selected_addons jsonb — cart built on prospect detail page
--                                       (or shared via /offer?cart=…). When a
--                                       prospect converts to a client this is
--                                       copied forward into client_addons.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── prospects.selected_addons ─────────────────────────────────────────────
alter table prospects
  add column if not exists selected_addons jsonb default '[]'::jsonb;

create index if not exists prospects_selected_addons_idx
  on prospects using gin (selected_addons);

-- ── client_addons ─────────────────────────────────────────────────────────
-- Per-client active add-on roster. status drives entitlement checks at
-- runtime — 'active' means usage allowed, 'over_cap' means hard-stop the
-- service for this client until the next monthly close OR an admin override.
create table if not exists client_addons (
  id              uuid primary key default gen_random_uuid(),
  rep_id          text not null references reps(id) on delete cascade,
  addon_key       text not null,
  status          text not null default 'active'
                  check (status in ('active','paused','over_cap','cancelled')),
  monthly_price_cents int not null,
  cap_value       int,                      -- null = unlimited
  cap_unit        text not null,            -- 'unlimited'|'appts_confirmed'|'roleplay_minutes'|'wavv_dials'
  source          text not null default 'admin_cart'
                  check (source in ('admin_cart','self_serve','manual','converted_prospect')),
  -- Lock the original quoted price for 30 days post-conversion so customers
  -- don't get re-priced mid-onboarding when we tune the catalog.
  locked_price_until timestamptz,
  activated_at    timestamptz default now(),
  paused_at       timestamptz,
  cancelled_at    timestamptz,
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (rep_id, addon_key)
);

create index if not exists client_addons_rep_idx
  on client_addons(rep_id, status);
create index if not exists client_addons_status_idx
  on client_addons(status) where status in ('active','over_cap');

drop trigger if exists client_addons_set_updated_at on client_addons;
create trigger client_addons_set_updated_at
  before update on client_addons
  for each row execute function set_updated_at();

alter table client_addons enable row level security;

-- ── usage_events ──────────────────────────────────────────────────────────
-- Append-only log. Every cap-counted event lands here so the billing
-- dashboard can replay any month's history. period_year_month is denormalized
-- ('2026-04' format) for fast monthly aggregation without date_trunc on every
-- query.
create table if not exists usage_events (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  addon_key           text not null,
  event_type          text not null,        -- 'appt_confirmed'|'roleplay_minute'|'wavv_dial'|'cap_hit_email_sent'
  quantity            numeric not null default 1,
  unit                text not null,        -- matches client_addons.cap_unit
  cost_cents_estimate int not null default 0,
  source_table        text,                 -- e.g. 'voice_calls', 'roleplay_sessions'
  source_id           uuid,
  occurred_at         timestamptz not null default now(),
  period_year_month   text not null,        -- '2026-04' — denormalized for cheap aggregation
  metadata            jsonb default '{}'::jsonb,
  created_at          timestamptz default now()
);

create index if not exists usage_events_rep_period_idx
  on usage_events(rep_id, addon_key, period_year_month);
create index if not exists usage_events_period_idx
  on usage_events(period_year_month, addon_key);
create index if not exists usage_events_occurred_idx
  on usage_events(rep_id, occurred_at desc);

alter table usage_events enable row level security;

-- ── billing_periods ───────────────────────────────────────────────────────
-- Monthly rollup row per (rep_id, period). Closed = month is final, no more
-- usage_events should land. Cap-hit emails are deduplicated by checking for
-- a usage_events row with event_type='cap_hit_email_sent' in the same period.
create table if not exists billing_periods (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  period_year_month   text not null,        -- '2026-04'
  status              text not null default 'open'
                      check (status in ('open','closed')),
  total_revenue_cents       int not null default 0,
  total_our_cost_cents      int not null default 0,
  total_margin_cents        int not null default 0,
  addon_usage         jsonb not null default '{}'::jsonb,
                                            -- { addon_key: { used: n, cap: n, cost_cents: n } }
  -- Per-period override cap bumps (admin "allow overage" button writes here).
  -- Shape: { addon_key: extra_cap_units }
  cap_overrides       jsonb default '{}'::jsonb,
  closed_at           timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (rep_id, period_year_month)
);

create index if not exists billing_periods_rep_idx
  on billing_periods(rep_id, period_year_month desc);
create index if not exists billing_periods_status_idx
  on billing_periods(status, period_year_month);

drop trigger if exists billing_periods_set_updated_at on billing_periods;
create trigger billing_periods_set_updated_at
  before update on billing_periods
  for each row execute function set_updated_at();

alter table billing_periods enable row level security;

-- ── voice_calls.status: add 'blocked_cap' ────────────────────────────────
-- When a dialer dispatch is blocked by an over-cap entitlement we still
-- write a voice_calls row for traceability — just with status='blocked_cap'
-- so it doesn't muddle the connected/voicemail/etc. KPI math.
--
-- Guarded so this migration can run before dialer_migration.sql. If
-- voice_calls doesn't exist yet, dialer_migration.sql will create it with
-- the legacy check; re-run this block (or the dialer migration's own
-- equivalent) to add 'blocked_cap'.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'voice_calls'
  ) then
    alter table voice_calls drop constraint if exists voice_calls_status_check;
    alter table voice_calls add constraint voice_calls_status_check
      check (status in (
        'queued','ringing','in_progress','completed',
        'failed','no_answer','voicemail','busy','cancelled',
        'blocked_cap'
      ));
  end if;
end $$;
