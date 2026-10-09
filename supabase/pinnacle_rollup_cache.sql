-- Precomputed executive rollup, one row per viewer tenant.
-- Overview / Performance / Reports / MCP read this row instead of running
-- the eight pinnacle_* RPCs on every page view. Filled by
-- /api/cron/pinnacle-sync (after the Airtable sync), /api/cron/pinnacle-rollup,
-- POST /api/pinnacle/refresh, and lazily on the first page view of the day.
create table if not exists public.pinnacle_rollup_cache (
  tenant_id       text primary key,
  payload         jsonb not null,
  computed_at     timestamptz not null default now(),
  -- Per-tenant in-flight lock: set while a recompute runs so two executives
  -- opening the suite at 8am do not both recompute; the second waits.
  computing_since timestamptz
);

alter table public.pinnacle_rollup_cache enable row level security;
revoke all on public.pinnacle_rollup_cache from anon, authenticated;
grant select, insert, update, delete on public.pinnacle_rollup_cache to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'public.pinnacle_rollup_cache', 'SELECT, INSERT, UPDATE, DELETE') then
    raise exception 'service_role is missing privileges on pinnacle_rollup_cache';
  end if;
end $$;
