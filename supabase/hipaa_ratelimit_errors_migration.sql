-- HIPAA mode + per-member rate limiting + structured error log.
-- Three columns/tables, all safe to apply with zero downtime.
-- Apply via: supabase db push, or paste into the Supabase SQL editor.

-- ── 1. HIPAA mode (per-rep boolean) ───────────────────────────────────────
-- When TRUE, code paths that surface PII outside the trusted boundary
-- (Telegram notifications, GHL CRM push, GHL booking sync) either redact
-- or skip. Set per-rep so a single tenant can flip into compliance mode
-- without affecting the rest of the platform.
ALTER TABLE reps ADD COLUMN IF NOT EXISTS hipaa_mode boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN reps.hipaa_mode IS
  'When TRUE, the dialer redacts lead names from Telegram alerts and skips GHL CRM push entirely. Use for reps handling protected health information without full BAA chain (no signed BAA with Telegram/GHL).';

-- ── 2. Rate limit buckets ─────────────────────────────────────────────────
-- Fixed-window per-key counter. Used by lib/rateLimit.ts to throttle
-- /api/sms/send, /api/voice/calls, and any other endpoint where a
-- compromised session could spam external services.
CREATE TABLE IF NOT EXISTS rate_limit_buckets (
  key          text        PRIMARY KEY,
  count        integer     NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start
  ON rate_limit_buckets (window_start);

-- Atomic check-and-increment. Returns true when allowed (incremented),
-- false when the limit is already exhausted for the current window.
-- Window is rolled forward when the previous window has aged out.
CREATE OR REPLACE FUNCTION enforce_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  -- Try to insert a fresh bucket; on conflict roll the window forward if
  -- it's older than p_window_seconds, otherwise increment in place.
  INSERT INTO rate_limit_buckets (key, count, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                  WHEN rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
                    THEN 1
                  ELSE rate_limit_buckets.count + 1
                END,
        window_start = CASE
                  WHEN rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
                    THEN now()
                  ELSE rate_limit_buckets.window_start
                END
  RETURNING count, window_start INTO v_count, v_window_start;

  RETURN v_count <= p_limit;
END
$$;

-- ── 3. Structured app errors ──────────────────────────────────────────────
-- Replaces console.error fire-and-forget with a queryable error log.
-- lib/errors.ts writes here; admins query via /admin/errors. No third-party
-- vendor required. Errors persist 30 days then auto-trim by the cron.
CREATE TABLE IF NOT EXISTS app_errors (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  severity      text        NOT NULL DEFAULT 'error',  -- 'warn' | 'error' | 'fatal'
  source        text        NOT NULL,                  -- e.g. 'cron/dialer-queue', 'webhook/revring', 'reconcile/voice_calls'
  rep_id        text,
  member_id     uuid,
  error_type    text        NOT NULL,                  -- short stable code, e.g. 'sakredcrm_push_401'
  message       text        NOT NULL,
  stack         text,
  context       jsonb       NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_app_errors_occurred_at ON app_errors (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_errors_source_severity ON app_errors (source, severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_errors_rep_id ON app_errors (rep_id, occurred_at DESC) WHERE rep_id IS NOT NULL;

COMMENT ON TABLE app_errors IS
  'Structured error log written by lib/errors.ts. Queried from /admin/errors. Vendor-free observability — replaces blind console.error in webhooks, cron, and reconciler.';
