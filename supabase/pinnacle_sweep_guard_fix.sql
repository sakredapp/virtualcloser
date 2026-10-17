-- Pinnacle mirror: let the newest FULL import replace the older copy.
-- 2026-10-17.
--
-- Why: Pinnacle re-imports its policy tables in Airtable about weekly, which
-- gives every row a NEW record_id. The upsert keys on record_id, so after a
-- re-import the mirror holds both copies until the sweep deletes the rows the
-- latest full pull did not touch (fetched_at < run.started_at). The old guard
-- only swept when `fetched >= 90% of live rows`, but `live` already counts
-- BOTH copies (~2x), so after every re-import the sweep was always skipped
-- ("fetched 83108 < 90% of 163773 live rows") and the duplicates stayed.
--
-- New guard (still never deletes on a partial pull):
--   1. the run finished clean and fetched > 0;
--   2. fetched >= 90% of the PREVIOUS clean full pull of that table (falls
--      back to the old 90%-of-live check when there is no previous pull);
--   3. at least 90% of the fetched rows actually landed (fetched_at >= start).
-- Then pinnacle_sweep_table() deletes the stale rows. For policy tables it
-- deletes a stale row only when its Policy Number is in the new pull, or when
-- the stale policies missing from the new pull ("orphans", i.e. Pinnacle
-- removed them) are at most 1% of the pull. More orphans than that looks like
-- a partial import, so they are kept and reported as kept_orphans.
--
-- The rollups already dedupe by Policy Number, so dashboard premium totals
-- were not doubled; the raw mirror, pinnacle_table_counts and
-- pinnacle_airtable_snapshots were.

create or replace function public.pinnacle_sweep_table(
  p_base text, p_table text, p_started timestamptz, p_orphan_max numeric default 0.01
) returns jsonb
language plpgsql security definer set search_path = public set statement_timeout = 0 as $$
declare
  v_fresh bigint;
  v_has_pn boolean;
  v_orphans bigint := 0;
  v_deleted bigint := 0;
  v_keep_orphans boolean := false;
begin
  select count(*), bool_or(nullif(btrim(fields->>'Policy Number'), '') is not null)
    into v_fresh, v_has_pn
  from pinnacle_airtable_records
  where base_id = p_base and table_name = p_table and fetched_at >= p_started;

  if coalesce(v_fresh, 0) = 0 then
    return jsonb_build_object('deleted', 0, 'reason', 'no fresh rows');
  end if;

  if not coalesce(v_has_pn, false) then
    -- Directory / agent lists: no policy key, the full pull is the table.
    delete from pinnacle_airtable_records
    where base_id = p_base and table_name = p_table and fetched_at < p_started;
    get diagnostics v_deleted = row_count;
    return jsonb_build_object('deleted', v_deleted, 'kept_orphans', 0, 'fresh', v_fresh);
  end if;

  create temp table if not exists _pin_fresh_pn (pn text primary key) on commit drop;
  truncate _pin_fresh_pn;
  insert into _pin_fresh_pn
    select distinct btrim(fields->>'Policy Number')
    from pinnacle_airtable_records
    where base_id = p_base and table_name = p_table and fetched_at >= p_started
      and nullif(btrim(fields->>'Policy Number'), '') is not null;

  select count(distinct btrim(a.fields->>'Policy Number')) into v_orphans
  from pinnacle_airtable_records a
  where a.base_id = p_base and a.table_name = p_table and a.fetched_at < p_started
    and nullif(btrim(a.fields->>'Policy Number'), '') is not null
    and not exists (select 1 from _pin_fresh_pn f where f.pn = btrim(a.fields->>'Policy Number'));

  v_keep_orphans := v_orphans > p_orphan_max * v_fresh;

  delete from pinnacle_airtable_records a
  where a.base_id = p_base and a.table_name = p_table and a.fetched_at < p_started
    and (
      not v_keep_orphans
      or nullif(btrim(a.fields->>'Policy Number'), '') is null
      or exists (select 1 from _pin_fresh_pn f where f.pn = btrim(a.fields->>'Policy Number'))
    );
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted,
    'orphan_policies', v_orphans,
    'kept_orphans', case when v_keep_orphans then v_orphans else 0 end,
    'fresh', v_fresh);
end $$;
revoke all on function public.pinnacle_sweep_table(text, text, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.pinnacle_sweep_table(text, text, timestamptz, numeric) to service_role;

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
  live bigint;
  prev bigint;
  landed bigint;
  res jsonb;
  swept_total bigint := 0;
  tables_done int := 0;
  skipped jsonb := '[]'::jsonb;
  kept jsonb := '[]'::jsonb;
  why text;
begin
  -- Only one runner at a time (cron tick overlapping a manual call).
  if not pg_try_advisory_xact_lock(hashtext('pinnacle_post_sync')) then
    return jsonb_build_object('skipped', 'already running');
  end if;

  -- Latest completed, unswept fetch per table. Older pending runs for the
  -- same table are superseded and just marked.
  for r in
    select distinct on (base_id, table_name) id, base_id, table_name, started_at, fetched, clean
    from pinnacle_sync_table_runs
    where swept_at is null and not incremental
    order by base_id, table_name, completed_at desc
  loop
    n := 0;
    why := null;
    -- Size reference: the previous clean full pull of this table. Comparing
    -- with live rows double-counts after a re-import (both copies are live).
    select t.fetched into prev
    from pinnacle_sync_table_runs t
    where t.base_id = r.base_id and t.table_name = r.table_name
      and not t.incremental and t.clean and t.fetched > 0
      and t.started_at < r.started_at
    order by t.started_at desc limit 1;

    if not coalesce(r.clean, false) then
      why := 'run not clean';
    elsif r.fetched is null or r.fetched <= 0 then
      why := 'zero-row fetch';
    elsif prev is not null and r.fetched < 0.9 * prev then
      why := format('fetched %s < 90%% of previous full pull %s', r.fetched, prev);
    elsif prev is null then
      select count(*) into live from pinnacle_airtable_records
      where base_id = r.base_id and table_name = r.table_name;
      if r.fetched < 0.9 * live then
        why := format('fetched %s < 90%% of %s live rows (no previous full pull)', r.fetched, live);
      end if;
    end if;
    if why is null then
      select count(*) into landed from pinnacle_airtable_records
      where base_id = r.base_id and table_name = r.table_name and fetched_at >= r.started_at;
      if landed < 0.9 * r.fetched then
        why := format('only %s of %s fetched rows landed', landed, r.fetched);
      end if;
    end if;

    if why is null then
      res := pinnacle_sweep_table(r.base_id, r.table_name, r.started_at);
      n := coalesce((res->>'deleted')::bigint, 0);
      if coalesce((res->>'kept_orphans')::bigint, 0) > 0 then
        kept := kept || jsonb_build_object('base_id', r.base_id, 'table', r.table_name, 'kept_orphans', (res->>'kept_orphans')::bigint);
      end if;
    else
      skipped := skipped || jsonb_build_object('base_id', r.base_id, 'table', r.table_name, 'reason', why);
    end if;
    update pinnacle_sync_table_runs set swept_at = now(), swept = n,
      sweep_skipped = case when id = r.id then why else 'superseded' end
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

  return jsonb_build_object('tables', tables_done, 'swept', swept_total, 'sweep_skipped', skipped,
    'kept_orphans', kept, 'rebuilt_at', now());
end;
$function$;
revoke all on function public.pinnacle_post_sync(boolean) from public, anon, authenticated;
grant execute on function public.pinnacle_post_sync(boolean) to service_role;

-- Stale sync-cursor row from a typo'd table name in PINNACLE_AIRTABLE_BASES
-- ("WoW PC Agent List" with a trailing backtick): 403 since 2026-10-09 and
-- shown as an error. The real "WoW PC Agent List" syncs fine.
delete from pinnacle_sync_cursor where table_name = 'WoW PC Agent List`';
delete from pinnacle_sync_table_runs where table_name = 'WoW PC Agent List`';

-- One-off cleanup (2026-10-17) of the copies the old guard left behind. The
-- latest pulls are already marked swept/skipped, so re-sweep each table from
-- its latest clean full pull. Orphans are KEPT here (p_orphan_max = 0) so the
-- distinct policy count does not change; the next weekly full pull removes
-- them under the normal 1% rule. Runs from pg_cron (no statement timeout),
-- logs to pinnacle_maintenance_log, then unschedules itself.
create or replace function public.pinnacle_dedupe_reimports_once()
returns void language plpgsql security definer set statement_timeout = 0 set search_path = public, cron as $$
declare r record; res jsonb := '[]'::jsonb;
begin
  -- Unschedule outside the inner block so a failure does not retry every minute.
  perform cron.unschedule('pinnacle-dedupe-reimports-once');
  begin
  perform pg_advisory_xact_lock(hashtext('pinnacle_post_sync'));
  for r in
    select distinct on (base_id, table_name) base_id, table_name, started_at
    from pinnacle_sync_table_runs
    where not incremental and clean and fetched > 0
    order by base_id, table_name, started_at desc
  loop
    if exists (select 1 from pinnacle_airtable_records a
               where a.base_id = r.base_id and a.table_name = r.table_name and a.fetched_at < r.started_at) then
      res := res || jsonb_build_object('base_id', r.base_id, 'table', r.table_name,
        'result', pinnacle_sweep_table(r.base_id, r.table_name, r.started_at, 0));
    end if;
  end loop;
  insert into pinnacle_maintenance_log (note, result) values ('dedupe re-imports 2026-10-17', jsonb_build_object('sweep', res));
  exception when others then
    insert into pinnacle_maintenance_log (note, result) values ('dedupe re-imports 2026-10-17 FAILED', jsonb_build_object('err', sqlerrm));
  end;
end $$;
revoke all on function public.pinnacle_dedupe_reimports_once() from public, anon, authenticated;

-- Rebuild after the cleanup: a separate one-shot so it runs after the delete
-- commits (post_sync takes the same advisory lock).
create or replace function public.pinnacle_rebuild_once()
returns void language plpgsql security definer set statement_timeout = 0 set search_path = public, cron as $$
declare b jsonb;
begin
  if exists (select 1 from cron.job where jobname = 'pinnacle-dedupe-reimports-once') then
    return; -- cleanup has not run yet
  end if;
  perform cron.unschedule('pinnacle-rebuild-once');
  begin
    b := pinnacle_post_sync(true);
    insert into pinnacle_maintenance_log (note, result) values ('rebuild after dedupe 2026-10-17', b);
  exception when others then
    insert into pinnacle_maintenance_log (note, result) values ('rebuild after dedupe 2026-10-17 FAILED', jsonb_build_object('err', sqlerrm));
  end;
end $$;
revoke all on function public.pinnacle_rebuild_once() from public, anon, authenticated;

select cron.schedule('pinnacle-dedupe-reimports-once', '* * * * *', $c$set statement_timeout = 0; select public.pinnacle_dedupe_reimports_once()$c$);
select cron.schedule('pinnacle-rebuild-once', '* * * * *', $c$set statement_timeout = 0; select public.pinnacle_rebuild_once()$c$);
