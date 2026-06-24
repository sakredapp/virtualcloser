-- Diagnostics safety net migration.
--
-- Two tables that close the "know before users do" gaps from the observability
-- audit: a worker heartbeat (so silent death of the Hetzner worker is
-- detectable + alertable) and a generic job-run audit (so any cron/tick records
-- last-success, generalizing the Pinnacle sync_runs pattern).

-- ── worker_health: one row per long-running worker ───────────────────────
-- The Hetzner worker upserts this every tick. A Vercel cron (health-check)
-- reads it; if last_tick_at goes stale the worker is presumed dead and the
-- operator is paged. alerted_at gates re-alerting so one outage = one alert;
-- a successful heartbeat clears it (recovery), re-arming the alarm.
create table if not exists worker_health (
  worker             text primary key,
  last_tick_at       timestamptz not null,
  tick_count         bigint default 0,
  consecutive_errors int default 0,
  last_summary       text,
  -- Set by the health-check cron when it pages about an outage; cleared by the
  -- next successful heartbeat. Non-null = "we've already alerted on this stall".
  alerted_at         timestamptz,
  updated_at         timestamptz default now()
);

-- ── job_runs: per-run audit for crons + worker subticks ──────────────────
-- Generalizes supabase/pinnacle_airtable_migration.sql's sync_runs so every
-- scheduled job can answer "did it run, when, did it succeed?".
create table if not exists job_runs (
  id          uuid primary key default gen_random_uuid(),
  job         text not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  ok          boolean,
  error       text,
  meta        jsonb,
  created_at  timestamptz default now()
);

create index if not exists job_runs_job_idx on job_runs (job, started_at desc);
-- Recent-failures sweep for the operator dashboard.
create index if not exists job_runs_failed_idx
  on job_runs (started_at desc) where ok = false;
