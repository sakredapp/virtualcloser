-- ============================================================================
-- Per-AGENT (per-member) billing
--
-- Sits ON TOP of the existing tenant-level billing (client_addons,
-- billing_periods). That layer is for the rep account. This layer is for
-- the individual sales rep / "agent" who actually uses the AI SDR.
--
-- Concepts:
--   - Each agent picks a monthly plan (e.g. "40 hrs/wk × 4.3 = 172 hrs/mo")
--     and either pays themselves or has the org pay on their behalf.
--   - Stripe customer + saved payment method per agent.
--   - One billing period row per agent per calendar month. Tracks planned
--     minutes vs consumed minutes. NO ROLLOVER — period resets monthly.
--   - Mid-call shift-end is allowed: the dialer-queue gate only checks
--     can-start-new-call, not can-finish-existing.
--   - Internal canonical unit: SECONDS. UI displays hours via lib helpers.
--   - Existing dialer_shifts table provides the shift schedule (already
--     supports per-member time ranges, weekday + start/end minute).
--   - Existing members.timezone provides the per-agent timezone.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- ── agent_billing ────────────────────────────────────────────────────────
-- One row per member who has an AI SDR plan. Tracks Stripe linkage,
-- payer model, current subscription, and the chosen plan size.
create table if not exists agent_billing (
  id                       uuid primary key default gen_random_uuid(),
  member_id                uuid not null unique references members(id) on delete cascade,
  rep_id                   text not null references reps(id) on delete cascade,

  -- Who pays. 'self' = agent's own card. 'org' = the org pays on their
  -- behalf (uses the rep account's billing setup, not the member's card).
  -- Picked at onboarding by the rep / admin.
  payer_model              text not null default 'self'
                            check (payer_model in ('self','org')),

  -- Stripe linkage. customer_id always set; payment_method_id null until
  -- the agent saves a card. subscription_id null until they pick a plan.
  stripe_customer_id       text,
  stripe_payment_method_id text,
  stripe_subscription_id   text,

  -- Card display metadata (cached so we don't re-fetch from Stripe every
  -- dashboard render). Updated by webhook on payment_method.attached.
  card_brand               text,
  card_last4               text,
  card_exp_month           smallint,
  card_exp_year            smallint,

  -- The chosen monthly plan. plan_minutes_per_month = the canonical
  -- monthly bucket; UI shows hrs/wk by dividing by 4.3 weeks/mo.
  plan_minutes_per_month   int,
  plan_price_cents         int,
  -- Per-minute rate at the active volume tier (cents). For UI display only;
  -- the canonical price is plan_price_cents (flat monthly subscription).
  price_per_minute_cents   numeric(8,4),

  -- Status drives the can-dial gate. 'pending_setup' = no card yet.
  -- 'active' = good to dial. 'past_due' = invoice failed, dialer paused.
  -- 'cancelled' = no subscription.
  status                   text not null default 'pending_setup'
                            check (status in ('pending_setup','active','past_due','cancelled')),

  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

create index if not exists agent_billing_rep_idx       on agent_billing(rep_id);
create index if not exists agent_billing_status_idx    on agent_billing(status);
create index if not exists agent_billing_stripe_cust_idx on agent_billing(stripe_customer_id) where stripe_customer_id is not null;
create index if not exists agent_billing_stripe_sub_idx  on agent_billing(stripe_subscription_id) where stripe_subscription_id is not null;

-- ── agent_billing_period ─────────────────────────────────────────────────
-- One row per (member, month). Resets monthly — no rollover.
-- planned_seconds = subscription size at period open. consumed_seconds =
-- sum of voice_calls.duration_sec for the agent in this period. Overage
-- is only relevant for reporting; we don't auto-bill it (yet).
create table if not exists agent_billing_period (
  id                  uuid primary key default gen_random_uuid(),
  member_id           uuid not null references members(id) on delete cascade,
  rep_id              text not null references reps(id) on delete cascade,
  period_year_month   text not null,                  -- '2026-05'
  period_start        timestamptz not null,
  period_end          timestamptz not null,
  planned_seconds     int not null default 0,
  consumed_seconds    int not null default 0,
  overage_seconds     int not null default 0,
  status              text not null default 'open'
                       check (status in ('open','closed')),
  stripe_invoice_id   text,
  invoice_paid_at     timestamptz,
  closed_at           timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (member_id, period_year_month)
);

create index if not exists agent_billing_period_member_idx
  on agent_billing_period(member_id, period_year_month desc);
create index if not exists agent_billing_period_open_idx
  on agent_billing_period(member_id) where status = 'open';
create index if not exists agent_billing_period_rep_period_idx
  on agent_billing_period(rep_id, period_year_month);

-- ── agent_billing_event ──────────────────────────────────────────────────
-- Stripe webhook idempotency + audit log. One row per processed Stripe
-- event. We early-out webhook handling if stripe_event_id already exists.
create table if not exists agent_billing_event (
  id                  uuid primary key default gen_random_uuid(),
  stripe_event_id     text not null unique,
  event_type          text not null,
  member_id           uuid references members(id) on delete set null,
  rep_id              text references reps(id) on delete set null,
  payload             jsonb not null default '{}'::jsonb,
  processed_at        timestamptz default now(),
  created_at          timestamptz default now()
);

create index if not exists agent_billing_event_member_idx
  on agent_billing_event(member_id, processed_at desc) where member_id is not null;
create index if not exists agent_billing_event_type_idx
  on agent_billing_event(event_type, processed_at desc);

-- ── Touch triggers ───────────────────────────────────────────────────────
-- Reuse the existing set_updated_at() function from earlier migrations,
-- falling back to a fresh definition if it doesn't exist yet.
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'set_updated_at') then
    create function set_updated_at() returns trigger as $body$
    begin
      new.updated_at = now();
      return new;
    end;
    $body$ language plpgsql;
  end if;
end $$;

drop trigger if exists agent_billing_touch on agent_billing;
create trigger agent_billing_touch
  before update on agent_billing
  for each row execute function set_updated_at();

drop trigger if exists agent_billing_period_touch on agent_billing_period;
create trigger agent_billing_period_touch
  before update on agent_billing_period
  for each row execute function set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table agent_billing         enable row level security;
alter table agent_billing_period  enable row level security;
alter table agent_billing_event   enable row level security;
