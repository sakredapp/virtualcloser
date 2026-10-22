#!/bin/sh
# Nightly encrypted backup of the box's database (and the app's uploaded files
# volume if mounted at /data/files) to RESTIC_REPOSITORY: a second disk the
# client owns (/backup-repo, the default) or any S3-compatible bucket
# (s3:https://host/bucket + AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).
# RESTIC_PASSWORD encrypts it; it is in the box's .env and on the build sheet,
# never in git. Keeps 7 daily, 4 weekly, 12 monthly snapshots.
set -eu
export PGHOST="${PGHOST:-db}" PGUSER="${PGUSER:-postgres}" PGDATABASE="${PGDATABASE:-suitecxo}"
restic cat config >/dev/null 2>&1 || restic init
pg_dump -Fc | restic backup --host "${BOX_ID:-box}" --tag db --stdin --stdin-filename suitecxo.dump
if [ -d /data/files ]; then restic backup --host "${BOX_ID:-box}" --tag files /data/files; fi
restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 12 >/dev/null
echo "$(date -u +%FT%TZ) backup ok"
