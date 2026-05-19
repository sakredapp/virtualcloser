-- Brand split: every tenant gets a brand identity (virtualcloser | cxo).
-- VirtualCloser stays the default; CXO Suite tenants are flipped explicitly.
-- The brand controls the marketing site, dashboard chrome, tab catalog, email
-- templates, and (eventually) the Telegram bot used for outbound DMs.

ALTER TABLE reps
  ADD COLUMN IF NOT EXISTS brand TEXT NOT NULL DEFAULT 'virtualcloser';

-- Limit to known values so a typo can't quietly break the resolver.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reps_brand_check'
  ) THEN
    ALTER TABLE reps
      ADD CONSTRAINT reps_brand_check
      CHECK (brand IN ('virtualcloser', 'cxo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reps_brand ON reps (brand);

COMMENT ON COLUMN reps.brand IS
  'Brand skin: virtualcloser (default) or cxo. Drives marketing domain, dashboard chrome, tab catalog, and email/Telegram bot identity.';
