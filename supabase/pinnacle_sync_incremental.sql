-- Storage (owner 10-09): daily pulls are incremental. A table is fully
-- rescanned (and swept) at most weekly, or when an incremental pull sees a
-- re-import (more than half the table came back as new/changed). In between,
-- only rows Airtable reports as created or modified since the last pull are
-- fetched and upserted; nothing is swept.
alter table pinnacle_sync_cursor add column if not exists last_full_at timestamptz;
alter table pinnacle_sync_cursor add column if not exists run_since timestamptz;
alter table pinnacle_sync_table_runs add column if not exists incremental boolean not null default false;
-- Today's pulls were full rescans.
update pinnacle_sync_cursor set last_full_at = completed_at where last_full_at is null and last_error is null and completed_at is not null;

CREATE OR REPLACE FUNCTION public.pinnacle_post_sync(p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
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
    where swept_at is null and not incremental
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

  -- Incremental pulls (changed rows only) never sweep: they did not see the
  -- whole table. They only ask for the rebuild below.
  update pinnacle_sync_table_runs set swept_at = now(), swept = 0
  where incremental and swept_at is null and completed_at <= now();
  get diagnostics n = row_count;
  tables_done := tables_done + n;

  if tables_done = 0 and not p_force then
    return jsonb_build_object('skipped', 'nothing new');
  end if;

  perform pinnacle_rebuild_rollups();
  perform pinnacle_rebuild_dim_rollup();
  perform pinnacle_build_people_stats();
  -- Expire every tenant's day cache: the next view recomputes from the
  -- rebuilt rollups.
  update pinnacle_rollup_cache set computed_at = 'epoch', computing_since = null;

  return jsonb_build_object('tables', tables_done, 'swept', swept_total, 'rebuilt_at', now());
end;
$function$;
