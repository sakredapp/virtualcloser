#!/bin/sh
# Applies supabase/*.sql to the box's Postgres, once each, in the order in
# selfhost/db/migrations.txt (then any file not listed, alphabetically).
# Runs on every `docker compose up` as the one-shot "migrate" service; files
# already applied are skipped (tracked in public.selfhost_migrations), so the
# first boot applies everything and later boots apply only new files.
set -eu
: "${PGHOST:=db}" "${PGUSER:=postgres}" "${PGDATABASE:=suitecxo}"
export PGHOST PGUSER PGDATABASE
DIR=/migrations
LIST=/selfhost/migrations.txt

until pg_isready -q; do echo "migrate: waiting for db"; sleep 1; done

psql -v ON_ERROR_STOP=1 -qc "create table if not exists public.selfhost_migrations (
  file text primary key, applied_at timestamptz not null default now(), ok boolean not null, error text)"

order=$( (grep -v '^#' "$LIST" | sed '/^$/d'; ls "$DIR" | grep '\.sql$' | sort) | awk '!seen[$0]++')
applied=0; failed=0; skipped=0
for f in $order; do
  [ -f "$DIR/$f" ] || continue
  done_ok=$(psql -tAc "select ok from public.selfhost_migrations where file = '$f'")
  if [ "$done_ok" = "t" ]; then skipped=$((skipped+1)); continue; fi
  if out=$(psql -v ON_ERROR_STOP=1 -q -f "$DIR/$f" 2>&1); then
    psql -qc "insert into public.selfhost_migrations(file, ok) values ('$f', true)
              on conflict (file) do update set ok = true, error = null, applied_at = now()"
    applied=$((applied+1))
  else
    err=$(printf '%s' "$out" | grep -m1 ERROR | sed "s/'/''/g")
    echo "migrate: FAILED $f: $err"
    psql -qc "insert into public.selfhost_migrations(file, ok, error) values ('$f', false, '$err')
              on conflict (file) do update set ok = false, error = excluded.error, applied_at = now()"
    failed=$((failed+1))
  fi
done
# PostgREST caches the schema; tell it to reload after a change.
psql -qc "notify pgrst, 'reload schema'"
echo "migrate: applied=$applied skipped=$skipped failed=$failed"
[ "$failed" -eq 0 ]
