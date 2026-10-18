-- The "Suite CXO" Google app as a third issuer (owner 2026-10-17).
--
-- google_tokens.oauth_source gains 'brand' = issued by the Suite CXO Google app
-- (GOOGLE_BRAND_CLIENT_ID / GOOGLE_BRAND_CLIENT_SECRET, no Gmail scopes).
-- 'tenant' = a company's own client, 'global' = the Virtual Closer app.
-- Every refresh uses the client that issued the row (lib/google.ts refreshClientsFor).
--
-- Until this runs, lib/google.ts saveTokens stores a brand-issued row without
-- oauth_source (oauth_client_id still names the Suite CXO app, and refresh
-- matches on it), so nothing breaks in between. Existing rows are untouched.
--
-- The check was created inline by cxo_google_token_issuer.sql, so Postgres
-- named it google_tokens_oauth_source_check.

alter table google_tokens drop constraint if exists google_tokens_oauth_source_check;
alter table google_tokens
  add constraint google_tokens_oauth_source_check
  check (oauth_source in ('tenant', 'brand', 'global'));

notify pgrst, 'reload schema';
