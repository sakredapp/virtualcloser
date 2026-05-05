-- Stores per-client price overrides that the admin can set before or after
-- activation. Fields are optional; absent = fall back to catalog defaults.
--
-- Shape of pricing_overrides JSONB:
--   {
--     monthly_flat_cents?:  number,  -- flat $/mo replaces catalog-built total
--     sdr_hourly_cents?:    number,  -- $/hr override for SDR voice (100ths of cent → cents)
--   }
alter table reps
  add column if not exists pricing_overrides jsonb default '{}'::jsonb;
