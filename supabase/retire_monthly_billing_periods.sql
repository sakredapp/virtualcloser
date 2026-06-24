-- Retire the monthly per-agent billing-period model.
--
-- Context: charging is fully WEEKLY now (Stripe subscriptions + metered
-- overage + the billing-week-rollover cron). The monthly agent_billing_period
-- table and the legacy monthly columns on agent_billing are no longer
-- written or read by any application code (verified by code-search: zero
-- callers, see commit b602e36).
--
-- This script is SAFE to run pre-launch (0 Stripe subscriptions, 0 rows in
-- agent_billing). Review and run it manually — it is NOT applied by any
-- migration runner.
--
-- After this runs:
--   - The monthly tracking tables/columns are gone.
--   - The close-billing-period cron continues to produce only the tenant-
--     level margin rollup (billing_periods) — that's unchanged.
--   - All per-agent billing flows through agent_billing (weekly columns) +
--     agent_billing_week / org_billing_week.
--
-- Optional rollback: this migration is destructive. To undo, restore from a
-- Supabase backup or re-create the table/columns from git history (the type
-- AgentBillingPeriodRow in lib/billing/agentBilling.ts pre-commit b602e36
-- documents the exact schema).

begin;

-- 1. Drop the monthly per-agent period table.
drop table if exists public.agent_billing_period cascade;

-- 2. Drop the legacy monthly columns on agent_billing. The weekly columns
--    (weekly_hours_quota, overflow_enabled, volume_tier, cancel_at_week_end,
--    current_week_start, current_week_end) are kept — those are live.
alter table public.agent_billing
  drop column if exists plan_minutes_per_month,
  drop column if exists plan_price_cents,
  drop column if exists price_per_minute_cents;

commit;

-- Post-run sanity checks (run separately, expect zero rows / clean schema):
--   select * from information_schema.tables
--    where table_schema='public' and table_name='agent_billing_period';
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='agent_billing'
--    and column_name in ('plan_minutes_per_month','plan_price_cents','price_per_minute_cents');
