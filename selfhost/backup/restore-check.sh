#!/bin/sh
# Proves the latest backup restores: pulls the newest db snapshot into a
# scratch database (restore_check), counts its tables against the live
# database, then drops the scratch database. Never touches the live one.
set -eu
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-postgres}"
LIVE="${PGDATABASE:-suitecxo}"
restic snapshots --tag db --latest 1
psql -d postgres -qc "drop database if exists restore_check"
psql -d postgres -qc "create database restore_check"
restic dump latest --tag db suitecxo.dump | pg_restore -d restore_check --no-owner 2>/tmp/restore.err || true
q="select count(*) from information_schema.tables where table_schema='public'"
live=$(psql -d "$LIVE" -tAc "$q"); got=$(psql -d restore_check -tAc "$q")
psql -d postgres -qc "drop database restore_check"
echo "restore-check: live public tables=$live restored=$got"
[ "$live" = "$got" ] && echo "restore-check: OK" || { echo "restore-check: MISMATCH"; head -20 /tmp/restore.err; exit 1; }
