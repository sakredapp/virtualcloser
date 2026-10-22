#!/bin/sh
# Brings the box's Postgres to the current Suite CXO schema. Runs on every
# `docker compose up` as the one-shot "migrate" service.
#
# Fresh box: applies selfhost/db/baseline.sql (the live schema, no rows), then
# records every file listed ABOVE the "# baseline" line in migrations.txt as
# covered by it. Every boot: applies, once each and in order, the files listed
# AFTER the "# baseline" line, then any supabase/*.sql not listed at all
# (alphabetically). Tracked in public.selfhost_migrations.
set -eu
: "${PGHOST:=db}" "${PGUSER:=postgres}" "${PGDATABASE:=suitecxo}"
export PGHOST PGUSER PGDATABASE
DIR=/migrations
LIST=/selfhost/migrations.txt
BASELINE=/selfhost/baseline.sql

until pg_isready -q; do echo "migrate: waiting for db"; sleep 1; done

psql -v ON_ERROR_STOP=1 -qc "create table if not exists public.selfhost_migrations (
  file text primary key, applied_at timestamptz not null default now(), ok boolean not null, error text)"

record() { # record FILE OK ERROR
  psql -qc "insert into public.selfhost_migrations(file, ok, error) values ('$1', $2, nullif('$3',''))
            on conflict (file) do update set ok = excluded.ok, error = excluded.error, applied_at = now()"
}

if [ "$(psql -tAc "select count(*) from public.selfhost_migrations where file = 'baseline.sql' and ok")" = "0" ]; then
  echo "migrate: fresh database, applying baseline.sql"
  if out=$(psql -v ON_ERROR_STOP=1 -q -f "$BASELINE" 2>&1); then
    record baseline.sql true ''
    # Everything above the "# baseline" marker is already in the baseline.
    for f in $(awk '/^# baseline/{exit} !/^#/ && NF' "$LIST"); do record "$f" true 'covered by baseline.sql'; done
  else
    err=$(printf '%s' "$out" | grep -m1 ERROR | sed "s/'/''/g")
    echo "migrate: FAILED baseline.sql: $err"
    record baseline.sql false "$err"
    exit 1
  fi
fi

order=$( (grep -v '^#' "$LIST" | sed '/^$/d'; ls "$DIR" | grep '\.sql$' | sort) | awk '!seen[$0]++')
applied=0; failed=0; skipped=0
for f in $order; do
  [ -f "$DIR/$f" ] || continue
  if [ "$(psql -tAc "select ok from public.selfhost_migrations where file = '$f'")" = "t" ]; then
    skipped=$((skipped+1)); continue
  fi
  if out=$(psql -v ON_ERROR_STOP=1 -q -f "$DIR/$f" 2>&1); then
    record "$f" true ''
    applied=$((applied+1))
  else
    err=$(printf '%s' "$out" | grep -m1 ERROR | sed "s/'/''/g")
    echo "migrate: FAILED $f: $err"
    record "$f" false "$err"
    failed=$((failed+1))
  fi
done
# PostgREST caches the schema; tell it to reload after a change.
psql -qc "notify pgrst, 'reload schema'"
echo "migrate: applied=$applied skipped=$skipped failed=$failed"
[ "$failed" -eq 0 ]
