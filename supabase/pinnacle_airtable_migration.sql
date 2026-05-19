-- Pinnacle Wellness Airtable sync — multi-base from the start.
--
-- Brad Plummer shares three separate Airtable bases (Pinnacle Directory +
-- two parallel BoB trackers whose table names overlap), so base_id is
-- part of the natural key throughout. A single PAT
-- (PINNACLE_AIRTABLE_TOKEN) has read access to all configured bases;
-- bases + table lists come from PINNACLE_AIRTABLE_BASES.
--
-- Applied to prod via Supabase MCP (pinnacle_airtable_init_multibase
-- 2026-05-19). An earlier single-base version of this file was committed
-- before the migration was ever applied — this revision rewrites it to
-- match what's actually in prod.
--
-- Tables:
--   pinnacle_airtable_records   — raw rows, upsert by (base_id, table_name, record_id)
--   pinnacle_airtable_snapshots — daily aggregated metrics, one per (base, day)
--   pinnacle_airtable_sync_runs — audit log, one per cron invocation

create table if not exists pinnacle_airtable_records (
  base_id    text not null,
  table_name text not null,
  record_id  text not null,
  fields     jsonb not null default '{}'::jsonb,
  airtable_created  timestamptz,
  last_modified_at  timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (base_id, table_name, record_id)
);

create index if not exists pinnacle_airtable_records_base_idx
  on pinnacle_airtable_records (base_id, table_name);
create index if not exists pinnacle_airtable_records_fetched_idx
  on pinnacle_airtable_records (fetched_at);

create table if not exists pinnacle_airtable_snapshots (
  base_id        text not null,
  snapshot_date  date not null,
  revenue_total  numeric,
  apps_submitted int,
  apps_approved  int,
  apps_funded    int,
  metrics        jsonb not null default '{}'::jsonb,
  updated_at     timestamptz not null default now(),
  primary key (base_id, snapshot_date)
);

create index if not exists pinnacle_airtable_snapshots_date_idx
  on pinnacle_airtable_snapshots (snapshot_date desc);

create table if not exists pinnacle_airtable_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  tables       jsonb,
  error        text
);

create index if not exists pinnacle_airtable_sync_runs_started_idx
  on pinnacle_airtable_sync_runs (started_at desc);

-- RLS: server-role only (same posture as other VC server-only tables).
alter table pinnacle_airtable_records enable row level security;
alter table pinnacle_airtable_snapshots enable row level security;
alter table pinnacle_airtable_sync_runs enable row level security;
