-- ============================================================================
-- Bulk import + lead tracking migration
-- Fixes:
--   1. leads.phone          — new column (was missing entirely)
--   2. leads.do_not_call    — terminal DNC flag set by dialer post-call
--   3. leads.import_batch_id — FK to new import_batches table
--   4. import_batches       — one record per CSV file upload
--   5. dialer_queue.import_batch_id — FK to import_batches
-- Safe to run multiple times (all DDL is idempotent).
-- ============================================================================

-- 1. Phone number on leads (E.164 stored here, mirrors dialer_queue.phone)
alter table leads
  add column if not exists phone text;

create index if not exists leads_phone_idx
  on leads(rep_id, phone)
  where phone is not null;

-- 2. Hard DNC flag. Set true by applyAiSalespersonOutcome when the lead
--    opts out during a call. The cron skips all queue rows whose lead has
--    this set, making it a pre-dial gate (not just post-call).
alter table leads
  add column if not exists do_not_call boolean not null default false;

create index if not exists leads_dnc_idx
  on leads(rep_id, do_not_call)
  where do_not_call = true;

-- 3. Import batches — one record per CSV/XLSX upload.
--    Tracks file metadata, counts, and whether calling has started.
create table if not exists import_batches (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  member_id         uuid references members(id) on delete set null,
  ai_salesperson_id uuid,
  file_name         text,
  source            text not null default 'csv',
  vendor_name       text,
  cost_per_lead     numeric(10, 4),
  total_count       int  not null default 0,
  inserted_count    int  not null default 0,
  duplicate_count   int  not null default 0,
  failed_count      int  not null default 0,
  enrolled_count    int  not null default 0,
  -- 'pending'  = imported but calling not started yet
  -- 'active'   = queue rows inserted, cron is dialing
  -- 'paused'   = calling paused (queue rows have scheduled_for = far future)
  -- 'completed'= all queue rows terminal (completed/failed/cancelled)
  status            text not null default 'pending'
                    check (status in ('pending', 'active', 'paused', 'completed')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists import_batches_rep_idx
  on import_batches(rep_id, created_at desc);

create index if not exists import_batches_status_idx
  on import_batches(rep_id, status)
  where status in ('pending', 'active', 'paused');

drop trigger if exists import_batches_set_updated_at on import_batches;
create trigger import_batches_set_updated_at
  before update on import_batches
  for each row execute function set_updated_at();

-- 4. FK on leads → import_batches
alter table leads
  add column if not exists import_batch_id uuid references import_batches(id) on delete set null;

create index if not exists leads_import_batch_idx
  on leads(import_batch_id)
  where import_batch_id is not null;

-- 5. FK on dialer_queue → import_batches
alter table dialer_queue
  add column if not exists import_batch_id uuid references import_batches(id) on delete set null;

create index if not exists dialer_queue_batch_idx
  on dialer_queue(import_batch_id)
  where import_batch_id is not null;
