-- Google connection health (owner 2026-10-17, lib/google/tokenHealth.ts).
-- When Google refuses a saved grant (invalid_grant: revoked, password change,
-- six months unused) or a calendar write lacks a scope, the row is flagged so
-- the person sees "Reconnect Google" and gets ONE notice. A connect, reconnect
-- or Google sign-in clears it. Additive and idempotent.
alter table google_tokens
  add column if not exists needs_reconnect boolean not null default false,
  add column if not exists reconnect_reason text,
  add column if not exists broken_at timestamptz;

notify pgrst, 'reload schema';
