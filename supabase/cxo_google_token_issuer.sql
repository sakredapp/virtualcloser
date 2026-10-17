-- Which Google client issued each stored connection (owner 2026-10-17).
--
-- A company with its own Google client (reps.settings.google_oauth, e.g.
-- Pinnacle) is Internal at Google, so a personal Gmail or another company's
-- calendar is added through the GLOBAL client with calendar-only access.
-- Every refresh and revoke must use the client that issued the connection
-- (lib/google.ts refreshClientsFor), so the issuer is stored per row.
--
--   oauth_source     'tenant' | 'global'; null = unknown (older code: try tenant, then global)
--   oauth_client_id  the client id that issued the tokens
--   calendar_only    true = an outside calendar; never used for inbox, send, Drive or Sheets
--
-- Backfill: verified 2026-10-17 that no tenant has google_oauth saved, so every
-- existing row was issued by the global client.

alter table google_tokens
  add column if not exists oauth_source text check (oauth_source in ('tenant', 'global')),
  add column if not exists oauth_client_id text,
  add column if not exists calendar_only boolean not null default false;

update google_tokens set oauth_source = 'global' where oauth_source is null;

notify pgrst, 'reload schema';
