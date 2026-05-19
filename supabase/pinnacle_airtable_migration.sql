-- Pinnacle Wellness Airtable sync.
--
-- Brad Plummer shared read-only access to the Pinnacle Wellness Airtable.
-- Spencer (who owns part of Pinnacle) wants to see revenue, apps submitted,
-- and other rollups every morning without having to log into Airtable.
--
-- Architecture:
--   pinnacle_airtable_records  → raw rows (one per Airtable record), pulled
--                                daily. Keyed by (table_name, record_id) so
--                                re-syncs upsert in place. We keep the full
--                                fields blob as jsonb so the dashboard can
--                                pick out whatever columns Brad's team adds
--                                without a schema migration.
--   pinnacle_airtable_snapshots → daily-grain aggregates (revenue, apps
--                                 submitted, etc). One row per snapshot_date.
--                                 Lets us chart trends without re-aggregating
--                                 the raw records every page load.
--   pinnacle_airtable_sync_runs → audit log of each cron run; helps debug
--                                 when the dashboard looks stale.

create table if not exists pinnacle_airtable_records (
  table_name        text not null,
  record_id         text not null,
  fields            jsonb not null default '{}'::jsonb,
  airtable_created  timestamptz,
  -- Airtable's last-modified — null if the table has no such column.
  last_modified_at  timestamptz,
  fetched_at        timestamptz not null default now(),
  primary key (table_name, record_id)
);

create index if not exists pinnacle_records_fetched_idx
  on pinnacle_airtable_records (fetched_at desc);

create index if not exists pinnacle_records_table_idx
  on pinnacle_airtable_records (table_name, fetched_at desc);

create table if not exists pinnacle_airtable_snapshots (
  snapshot_date     date primary key,
  -- Top-line metrics. Nullable because a field may not exist yet in the
  -- airtable when we add new metrics later.
  revenue_total     numeric,
  revenue_mtd       numeric,
  apps_submitted    integer,
  apps_approved     integer,
  apps_funded       integer,
  -- Catch-all bag for whatever additional rollups the dashboard wants to
  -- expose. Stored as { table_name: { count, sum_by_field, ... } }.
  metrics           jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists pinnacle_airtable_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  ok            boolean,
  -- Per-table summary { table_name: { fetched, upserted, error? } }.
  tables        jsonb not null default '{}'::jsonb,
  error         text
);

create index if not exists pinnacle_sync_runs_started_idx
  on pinnacle_airtable_sync_runs (started_at desc);
