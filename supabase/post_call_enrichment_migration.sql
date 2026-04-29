-- Post-call enrichment migration.
-- Adds richer fields to voice_calls that RevRing (and Vapi) now surface.
-- Safe to re-run: all `add column if not exists`.

-- summary      — provider-supplied transcript summary (RevRing post-call body)
-- hangup_cause — why the call ended (RevRing: endedReason / Vapi: endedReason)
-- error_message — provider error string when status='failed'
-- call_variables — snapshot of conversation variables at call end
-- call_metrics  — structured call metrics (duration, rings, cost breakdown, etc.)

alter table if exists voice_calls
  add column if not exists summary         text,
  add column if not exists hangup_cause    text,
  add column if not exists error_message   text,
  add column if not exists call_variables  jsonb default '{}'::jsonb,
  add column if not exists call_metrics    jsonb default '{}'::jsonb;
