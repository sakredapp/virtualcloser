#!/bin/bash
# First boot only (Postgres runs files in /docker-entrypoint-initdb.d once, on an
# empty data directory). Creates the roles Supabase gives every project, so the
# migrations' "grant ... to service_role" / "revoke ... from anon" lines work,
# and the extensions the app uses.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v authpw="$PGRST_AUTHENTICATOR_PASSWORD" <<'SQL'
create role anon nologin noinherit;
create role authenticated nologin noinherit;
-- The app talks to the database only as service_role (via PostgREST with the
-- signed service JWT), exactly as on Supabase, where service_role bypasses RLS.
create role service_role nologin noinherit bypassrls;
create role authenticator login noinherit password :'authpw';
grant anon, authenticated, service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;

create extension if not exists pgcrypto;
create extension if not exists vector;
create extension if not exists pg_cron;
grant usage on schema cron to postgres;
SQL
