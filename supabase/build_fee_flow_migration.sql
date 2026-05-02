-- ============================================================================
-- Build-fee-first flow + prospect linkage migration.
--
-- Adds the columns needed to:
--   - Capture a paid build fee but NOT yet activate the recurring subscription
--   - Stash the planned subscription configuration on the rep row for later
--     admin-driven activation
--   - Mirror prospect linkage so admin lists are unified
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- Widen reps.billing_status to include the new lifecycle states.
alter table reps drop constraint if exists reps_billing_status_check;
alter table reps add constraint reps_billing_status_check
  check (billing_status in (
    'none',
    'pending_activation',  -- build fee paid, sub not yet created (admin gate)
    'building',            -- admin marked build in-progress (optional)
    'trialing',
    'active',
    'past_due',
    'canceled',
    'incomplete',
    'paused'
  ));

-- Saved card from the build-fee Checkout (used by admin "Activate
-- subscription" to spin up the weekly sub off-session). Mirrors what
-- already lives in default_payment_method_id but only set after a
-- successful build-fee charge so we never confuse it with a customer's
-- portal-attached card.
alter table reps add column if not exists pending_payment_method_id text;

-- Snapshot of the configured plan at checkout time. Admin reads this
-- when activating to know what to subscribe them to. Shape:
-- {
--   "scope": "individual" | "team" | "enterprise",
--   "rep_count": 25,
--   "weekly_hours": 40,
--   "trainer_weekly_hours": 10,
--   "overflow_enabled": false,
--   "volume_tier": "t2",
--   "addons": ["vc_crm_ghl", "vc_dialer_pro"],
--   "build_fee_paid_cents": 875000,
--   "build_fee_paid_at": "2026-05-02T..."
-- }
alter table reps add column if not exists pending_plan jsonb;

-- Soft pointer to the original prospect row (Cal.com booking, Fathom
-- recording, etc.). Lets admin pull the call notes / build plan into
-- the customer detail view.
alter table reps add column if not exists prospect_id uuid references prospects(id) on delete set null;
create index if not exists reps_prospect_idx on reps(prospect_id) where prospect_id is not null;
create index if not exists reps_pending_activation_idx on reps(billing_status) where billing_status = 'pending_activation';

-- Track when the build fee landed (separate from monthly invoice cache).
alter table reps add column if not exists build_fee_paid_at timestamptz;
alter table reps add column if not exists build_fee_paid_cents int;
alter table reps add column if not exists build_fee_payment_intent_id text;

-- Track when admin activated the subscription (audit-friendly).
alter table reps add column if not exists subscription_activated_at timestamptz;
alter table reps add column if not exists subscription_activated_by text;
