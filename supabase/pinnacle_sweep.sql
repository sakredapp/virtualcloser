-- Pinnacle mirror sweep + post-sync rebuild (2026-10-09).
--
-- WHY: Brad's policy tables are WIPED AND RE-IMPORTED in Airtable every week,
-- and every import arrives with brand-new record ids. The sync only ever
-- upserted, so the mirror kept every weekly copy: ~20 copies of the Health and
-- Life books by October 2026 ($2.70B of "2026 premium" against ~$185M in the
-- latest import). The old daily rollup was frozen at 6 weekly copies of Health
-- ($256M) because the rebuild RPC could never finish inside PostgREST's 8s
-- statement timeout.
--
-- HOW: the app records each table it fetched to the END in
-- pinnacle_sync_table_runs (cheap insert). A pg_cron job (runs as postgres,
-- no 8s limit) calls pinnacle_post_sync() every 20 minutes; when there is a
-- completed table fetch it has not processed yet, it deletes that table's rows
-- the fetch did not see (fetched_at < the fetch's start = gone from Airtable),
-- rebuilds pinnacle_daily_rollup / pinnacle_status_rollup / pinnacle_dim_rollup
-- from the same cleaned mirror, and expires the per-tenant day cache so the
-- next page view recomputes. Overview and Team then read one source.

create table if not exists public.pinnacle_sync_table_runs (
  id           bigserial primary key,
  base_id      text not null,
  table_name   text not null,
  started_at   timestamptz not null,
  completed_at timestamptz not null default now(),
  fetched      integer not null default 0,
  swept_at     timestamptz,
  swept        bigint
);
create index if not exists pinnacle_sync_table_runs_pending_idx
  on public.pinnacle_sync_table_runs (completed_at) where swept_at is null;
grant select, insert, update on public.pinnacle_sync_table_runs to service_role;
grant usage, select on sequence public.pinnacle_sync_table_runs_id_seq to service_role;

drop function if exists public.pinnacle_sweep_stale(text, text, timestamptz);

create or replace function public.pinnacle_post_sync(p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
set statement_timeout = 0
as $$
declare
  r record;
  n bigint;
  swept_total bigint := 0;
  tables_done int := 0;
begin
  -- Only one runner at a time (cron tick overlapping a manual call).
  if not pg_try_advisory_xact_lock(hashtext('pinnacle_post_sync')) then
    return jsonb_build_object('skipped', 'already running');
  end if;

  -- Latest completed, unswept fetch per table. Older pending runs for the
  -- same table are superseded and just marked.
  for r in
    select distinct on (base_id, table_name) id, base_id, table_name, started_at, fetched
    from pinnacle_sync_table_runs
    where swept_at is null
    order by base_id, table_name, completed_at desc
  loop
    n := 0;
    -- A zero-row fetch is never trusted to wipe a table.
    if r.fetched > 0 then
      delete from pinnacle_airtable_records
      where base_id = r.base_id and table_name = r.table_name and fetched_at < r.started_at;
      get diagnostics n = row_count;
    end if;
    update pinnacle_sync_table_runs set swept_at = now(), swept = n
    where base_id = r.base_id and table_name = r.table_name and swept_at is null and completed_at <= now();
    swept_total := swept_total + n;
    tables_done := tables_done + 1;
  end loop;

  if tables_done = 0 and not p_force then
    return jsonb_build_object('skipped', 'nothing new');
  end if;

  perform pinnacle_rebuild_rollups();
  perform pinnacle_rebuild_dim_rollup();
  -- Expire every tenant's day cache: the next view recomputes from the
  -- rebuilt rollups.
  update pinnacle_rollup_cache set computed_at = 'epoch', computing_since = null;

  return jsonb_build_object('tables', tables_done, 'swept', swept_total, 'rebuilt_at', now());
end;
$$;
revoke all on function public.pinnacle_post_sync(boolean) from public, anon, authenticated;
grant execute on function public.pinnacle_post_sync(boolean) to service_role;

create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'pinnacle-post-sync';
select cron.schedule('pinnacle-post-sync', '*/20 * * * *', $$select public.pinnacle_post_sync(false)$$);
