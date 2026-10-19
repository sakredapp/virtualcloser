-- ============================================================================
-- Suite CXO bills on Whop (owner ruling 2026-10-19: no Stripe anywhere).
--
-- reps:               the Whop membership that pays for the seats, the last
--                     Whop payment, and 'comped' (no charge, on purpose).
-- onboarding_tokens:  the Whop checkout configuration behind a sign-and-pay
--                     link (stripe_session_id is left as history).
-- billing_audit:      the Whop object an admin action touched.
-- cxo_whop_webhook_events: one row per Whop delivery (webhook-id), so a retry
--                     is a no-op and every delivery is on record.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

alter table reps drop constraint if exists reps_billing_status_check;
alter table reps add constraint reps_billing_status_check
  check (billing_status in ('none','pending_activation','building','trialing','active','past_due','canceled','incomplete','paused','comped'));

alter table reps add column if not exists whop_membership_id text;
alter table reps add column if not exists whop_last_payment_id text;
alter table reps add column if not exists whop_checkout_url text;
alter table reps add column if not exists comped_at timestamptz;
alter table reps add column if not exists comped_reason text;
alter table reps add column if not exists comped_cents integer;

alter table onboarding_tokens add column if not exists whop_checkout_id text;

alter table billing_audit add column if not exists whop_object_id text;

create table if not exists cxo_whop_webhook_events (
  id          text primary key,              -- webhook-id header
  type        text not null,
  outcome     text not null,
  rep_id      text,
  resource_id text,
  detail      jsonb,
  received_at timestamptz not null default now()
);
alter table cxo_whop_webhook_events enable row level security;
revoke all on cxo_whop_webhook_events from anon, authenticated;
grant select, insert, update, delete on cxo_whop_webhook_events to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'cxo_whop_webhook_events', 'INSERT') then
    raise exception 'service_role cannot insert into cxo_whop_webhook_events';
  end if;
  if has_table_privilege('anon', 'cxo_whop_webhook_events', 'SELECT') then
    raise exception 'anon can read cxo_whop_webhook_events';
  end if;
end $$;
