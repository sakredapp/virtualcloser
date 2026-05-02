-- ============================================================================
-- Weekly billing migration.
--
-- Replaces the monthly cycle with a weekly Monday-anchor cycle. Cash collected
-- upfront every Monday. Adds support tables for the offer-page checkout flow,
-- invoice caching, weekly usage rollups, billing audit, and global Stripe
-- event idempotency.
--
-- Idempotent. Safe to re-run. Old monthly tables (agent_billing_period) are
-- left in place as historical data; new code reads/writes agent_billing_week.
-- ============================================================================

-- ── reps.tier: add 'team' tier ──────────────────────────────────────────
alter table reps drop constraint if exists reps_tier_check;
alter table reps add constraint reps_tier_check
  check (tier in ('individual','team','enterprise'));

-- ── reps: org-level Stripe subscription columns ─────────────────────────
-- Set when the rep account itself pays for hours (team or enterprise tier).
-- For individual tier, billing lives on agent_billing instead.
alter table reps add column if not exists stripe_subscription_id text;
alter table reps add column if not exists billing_status text not null default 'none'
  check (billing_status in ('none','trialing','active','past_due','canceled','incomplete','paused'));
alter table reps add column if not exists current_week_start timestamptz;
alter table reps add column if not exists current_week_end   timestamptz;
alter table reps add column if not exists cancel_at_week_end boolean not null default false;
alter table reps add column if not exists weekly_hours_quota int default 0;
alter table reps add column if not exists overflow_enabled boolean not null default false;
alter table reps add column if not exists volume_tier text default 't1'
  check (volume_tier in ('t1','t2','t3','t4','t5'));
alter table reps add column if not exists default_payment_method_id text;
alter table reps add column if not exists card_brand text;
alter table reps add column if not exists card_last4 text;
alter table reps add column if not exists card_exp_month smallint;
alter table reps add column if not exists card_exp_year  smallint;

create index if not exists reps_billing_status_idx on reps(billing_status);
create index if not exists reps_stripe_sub_idx on reps(stripe_subscription_id) where stripe_subscription_id is not null;

-- ── agent_billing: weekly cycle columns ─────────────────────────────────
alter table agent_billing add column if not exists weekly_hours_quota int default 0;
alter table agent_billing add column if not exists overflow_enabled boolean not null default false;
alter table agent_billing add column if not exists volume_tier text default 't1'
  check (volume_tier in ('t1','t2','t3','t4','t5'));
alter table agent_billing add column if not exists cancel_at_week_end boolean not null default false;
alter table agent_billing add column if not exists current_week_start timestamptz;
alter table agent_billing add column if not exists current_week_end   timestamptz;

-- Existing status constraint covers what we need; just widen it for 'paused'.
alter table agent_billing drop constraint if exists agent_billing_status_check;
alter table agent_billing add constraint agent_billing_status_check
  check (status in ('pending_setup','active','past_due','cancelled','paused'));

-- ── agent_billing_week ───────────────────────────────────────────────────
-- One row per (member, ISO week). Replaces agent_billing_period (monthly)
-- for active billing math. Old monthly rows kept for history.
create table if not exists agent_billing_week (
  id                  uuid primary key default gen_random_uuid(),
  member_id           uuid not null references members(id) on delete cascade,
  rep_id              text not null references reps(id) on delete cascade,
  iso_week            text not null,                  -- '2026-W18'
  week_start          timestamptz not null,           -- Monday 00:00 UTC
  week_end            timestamptz not null,           -- next Monday 00:00 UTC
  planned_hours       numeric(8,2) not null default 0,
  consumed_seconds    int not null default 0,
  overage_hours       numeric(8,2) not null default 0,
  status              text not null default 'open'
                       check (status in ('open','closed')),
  stripe_invoice_id   text,
  invoice_paid_at     timestamptz,
  overage_pushed_at   timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (member_id, iso_week)
);
create index if not exists agent_billing_week_member_idx on agent_billing_week(member_id, iso_week desc);
create index if not exists agent_billing_week_open_idx on agent_billing_week(member_id) where status = 'open';
create index if not exists agent_billing_week_rep_idx on agent_billing_week(rep_id, iso_week);

drop trigger if exists agent_billing_week_touch on agent_billing_week;
create trigger agent_billing_week_touch
  before update on agent_billing_week
  for each row execute function set_updated_at();

alter table agent_billing_week enable row level security;

-- ── org_billing_week ─────────────────────────────────────────────────────
-- Same idea but for the rep-account level subscription (team / enterprise).
create table if not exists org_billing_week (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  iso_week            text not null,
  week_start          timestamptz not null,
  week_end            timestamptz not null,
  planned_hours       numeric(8,2) not null default 0,
  consumed_seconds    int not null default 0,
  overage_hours       numeric(8,2) not null default 0,
  status              text not null default 'open'
                       check (status in ('open','closed')),
  stripe_invoice_id   text,
  invoice_paid_at     timestamptz,
  overage_pushed_at   timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (rep_id, iso_week)
);
create index if not exists org_billing_week_rep_idx on org_billing_week(rep_id, iso_week desc);
create index if not exists org_billing_week_open_idx on org_billing_week(rep_id) where status = 'open';

drop trigger if exists org_billing_week_touch on org_billing_week;
create trigger org_billing_week_touch
  before update on org_billing_week
  for each row execute function set_updated_at();

alter table org_billing_week enable row level security;

-- ── invoices ─────────────────────────────────────────────────────────────
-- Cached invoices so admin/billing pages don't hammer Stripe on every render.
-- Webhook keeps this in sync via invoice.created / .finalized / .paid /
-- .payment_failed.
create table if not exists invoices (
  id                  text primary key,                     -- Stripe invoice id (in_xxx)
  stripe_customer_id  text not null,
  rep_id              text references reps(id) on delete set null,
  member_id           uuid references members(id) on delete set null,
  scope               text not null check (scope in ('org','member')),
  status              text not null,                        -- draft|open|paid|void|uncollectible
  amount_due_cents    int not null default 0,
  amount_paid_cents   int not null default 0,
  amount_remaining_cents int not null default 0,
  currency            text not null default 'usd',
  hosted_invoice_url  text,
  invoice_pdf_url     text,
  number              text,
  iso_week            text,                                  -- '2026-W18' if known
  period_start        timestamptz,
  period_end          timestamptz,
  collection_method   text,                                  -- charge_automatically | send_invoice
  attempt_count       int default 0,
  next_payment_attempt timestamptz,
  finalized_at        timestamptz,
  paid_at             timestamptz,
  voided_at           timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index if not exists invoices_rep_idx on invoices(rep_id, created_at desc) where rep_id is not null;
create index if not exists invoices_member_idx on invoices(member_id, created_at desc) where member_id is not null;
create index if not exists invoices_status_idx on invoices(status);
create index if not exists invoices_customer_idx on invoices(stripe_customer_id, created_at desc);

drop trigger if exists invoices_touch on invoices;
create trigger invoices_touch
  before update on invoices
  for each row execute function set_updated_at();

alter table invoices enable row level security;

-- ── carts ────────────────────────────────────────────────────────────────
-- Server-side cart for the offer page. We never trust client-side totals;
-- the checkout-session route reloads the cart by id and re-computes price
-- from catalog before creating the Stripe Checkout Session.
create table if not exists carts (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  display_name        text,
  company             text,
  phone               text,
  tier                text not null default 'individual'
                       check (tier in ('individual','team','enterprise')),
  rep_count           int not null default 1 check (rep_count > 0),
  weekly_hours        int not null default 0,
  trainer_weekly_hours int not null default 0,
  overflow_enabled    boolean not null default false,
  addons              jsonb not null default '[]'::jsonb,    -- ['vc_crm_ghl', 'vc_dialer_pro', ...]
  computed_total_cents int,
  metadata            jsonb not null default '{}'::jsonb,
  expires_at          timestamptz not null default now() + interval '24 hours',
  checkout_session_id text,
  converted_rep_id    text references reps(id) on delete set null,
  converted_member_id uuid references members(id) on delete set null,
  converted_at        timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index if not exists carts_email_idx on carts(lower(email)) where email is not null;
create index if not exists carts_session_idx on carts(checkout_session_id) where checkout_session_id is not null;
create index if not exists carts_unconverted_idx on carts(created_at desc) where converted_at is null;

drop trigger if exists carts_touch on carts;
create trigger carts_touch
  before update on carts
  for each row execute function set_updated_at();

alter table carts enable row level security;

-- ── billing_audit ────────────────────────────────────────────────────────
-- Append-only log of every billing-impacting action taken from the admin UI
-- or via API. Lets you answer "who comped this customer?" months later.
create table if not exists billing_audit (
  id              uuid primary key default gen_random_uuid(),
  actor_kind      text not null check (actor_kind in ('admin','system','customer','webhook')),
  actor_id        text,                                          -- admin email | webhook event id | etc
  action          text not null,                                 -- 'subscription.create' | 'invoice.refund' | ...
  rep_id          text references reps(id) on delete set null,
  member_id       uuid references members(id) on delete set null,
  stripe_object_id text,
  amount_cents    int,
  before          jsonb,
  after           jsonb,
  notes           text,
  created_at      timestamptz default now()
);
create index if not exists billing_audit_rep_idx on billing_audit(rep_id, created_at desc) where rep_id is not null;
create index if not exists billing_audit_member_idx on billing_audit(member_id, created_at desc) where member_id is not null;
create index if not exists billing_audit_action_idx on billing_audit(action, created_at desc);

alter table billing_audit enable row level security;

-- ── stripe_events ────────────────────────────────────────────────────────
-- Global Stripe webhook idempotency (broader scope than agent_billing_event,
-- which we keep for backwards compat). Insert on receive; if conflict, the
-- event was already processed — return 200 and skip.
create table if not exists stripe_events (
  id              text primary key,                              -- Stripe event id (evt_xxx)
  type            text not null,
  livemode        boolean not null default false,
  api_version     text,
  payload         jsonb,
  received_at     timestamptz default now(),
  processed_at    timestamptz,
  error           text
);
create index if not exists stripe_events_type_idx on stripe_events(type, received_at desc);
create index if not exists stripe_events_unprocessed_idx on stripe_events(received_at) where processed_at is null;

alter table stripe_events enable row level security;

-- ── billing_change_requests ──────────────────────────────────────────────
-- Managers (read-only on billing) can request changes; owners approve.
create table if not exists billing_change_requests (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  requested_by      uuid not null references members(id) on delete cascade,
  target_member_id  uuid references members(id) on delete cascade,
  kind              text not null check (kind in (
                       'add_hours','remove_hours','toggle_overflow',
                       'add_addon','remove_addon','cancel','other'
                     )),
  payload           jsonb not null default '{}'::jsonb,
  status            text not null default 'open'
                     check (status in ('open','approved','rejected','applied')),
  reviewed_by       uuid references members(id) on delete set null,
  reviewed_at       timestamptz,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists billing_change_requests_open_idx
  on billing_change_requests(rep_id, created_at desc) where status = 'open';

drop trigger if exists billing_change_requests_touch on billing_change_requests;
create trigger billing_change_requests_touch
  before update on billing_change_requests
  for each row execute function set_updated_at();

alter table billing_change_requests enable row level security;

-- ============================================================================
-- DONE
-- ============================================================================
