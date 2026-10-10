-- Suite CXO: a company's own Google OAuth client (owner 2026-10-10).
-- Stored on reps.settings (JSONB) as
--   settings.google_oauth = { client_id, client_secret_enc, redirect_uri?, updated_at }
-- client_secret_enc is AES-256-GCM, sealed by the app (lib/google.ts). Plain
-- secrets are never written. No new columns: this documents the keys and lets
-- us find every tenant on its own client without scanning every row.
comment on column public.reps.settings is
  'Tenant settings (JSONB). google_oauth = the company''s own Google OAuth client: client_id, client_secret_enc (app-encrypted, never plain), redirect_uri?, updated_at. Absent = the global client.';

create index if not exists reps_google_oauth_client_idx
  on public.reps ((settings -> 'google_oauth' ->> 'client_id'))
  where settings -> 'google_oauth' ->> 'client_id' is not null;
