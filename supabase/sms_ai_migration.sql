-- AI SMS infrastructure: sessions + message log
-- Also adds context JSONB to ai_salesperson_followups for SMS call-outcome routing.
-- Run via Supabase migrations or MCP apply_migration.

-- ── ai_salesperson_followups: add context column ──────────────────────────
-- Stores call outcome + phone for the SMS cron to use without extra lookups.
ALTER TABLE ai_salesperson_followups
  ADD COLUMN IF NOT EXISTS context jsonb;

-- ── sms_ai_sessions ───────────────────────────────────────────────────────
-- One active session per lead. Tracks conversation state, discovery data,
-- and engagement scoring. UNIQUE (lead_id, rep_id) so re-engagement crons
-- and inbound webhooks always find the same session.
CREATE TABLE IF NOT EXISTS sms_ai_sessions (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id                uuid        NOT NULL,
  ai_salesperson_id     uuid,
  lead_id               uuid,
  phone                 text        NOT NULL,
  -- state machine
  -- context_confirmed → discovery_in_progress → discovery_complete →
  -- appointment_proposed → appointment_booked | dormant | escalated | opted_out
  state                 text        NOT NULL DEFAULT 'context_confirmed',
  discovery             jsonb       NOT NULL DEFAULT '{}',
  engagement_score      text        NOT NULL DEFAULT 'low',  -- low | medium | high
  appointment_likelihood int        NOT NULL DEFAULT 0,      -- 0–100
  last_sentiment        text,                                -- positive | neutral | negative
  buying_signal_count   int         NOT NULL DEFAULT 0,
  attempt_count         int         NOT NULL DEFAULT 1,
  ai_paused             bool        NOT NULL DEFAULT false,
  escalation_reason     text,
  last_contact_at       timestamptz,
  last_response_at      timestamptz,
  first_response_at     timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, rep_id)
);

CREATE INDEX IF NOT EXISTS idx_sms_ai_sessions_rep_state
  ON sms_ai_sessions (rep_id, state);
CREATE INDEX IF NOT EXISTS idx_sms_ai_sessions_lead
  ON sms_ai_sessions (lead_id);
CREATE INDEX IF NOT EXISTS idx_sms_ai_sessions_phone_rep
  ON sms_ai_sessions (phone, rep_id);

-- ── sms_messages ──────────────────────────────────────────────────────────
-- Immutable log of every inbound and outbound SMS message.
-- provider_message_id UNIQUE prevents duplicate processing of Twilio retries.
CREATE TABLE IF NOT EXISTS sms_messages (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  rep_id               uuid        NOT NULL,
  lead_id              uuid,
  session_id           uuid        REFERENCES sms_ai_sessions(id),
  direction            text        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body                 text        NOT NULL,
  from_phone           text,
  to_phone             text,
  status               text        NOT NULL DEFAULT 'queued',
  -- queued | sent | delivered | failed
  is_ai_reply          bool        NOT NULL DEFAULT false,
  provider_message_id  text        UNIQUE,
  error_message        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_messages_session
  ON sms_messages (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_lead
  ON sms_messages (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_messages_rep_inbound
  ON sms_messages (rep_id, created_at DESC)
  WHERE direction = 'inbound';
