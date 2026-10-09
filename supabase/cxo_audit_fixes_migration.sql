-- CXO audit fixes (2026-10-09). Already applied live on ndschjbuyjmxtzqyjgyi;
-- this file records them. Safe to re-run.

-- 1. A slug or alias belongs to exactly one rep (login/session host safety).
CREATE OR REPLACE FUNCTION public.reps_hosts_unique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  h text;
  mine text[];
begin
  mine := array_remove(array[lower(new.slug)] || coalesce((select array_agg(lower(x)) from unnest(new.host_aliases) x), '{}'), null);
  if (select count(*) from unnest(mine)) <> (select count(distinct x) from unnest(mine) x) then
    raise exception 'rep % lists the same host twice (slug/aliases)', new.id using errcode = '23505';
  end if;
  foreach h in array mine loop
    perform pg_advisory_xact_lock(hashtext('reps_host:' || h));
    if exists (
      select 1 from reps r
      where r.id <> new.id
        and (lower(r.slug) = h or h = any (select lower(y) from unnest(r.host_aliases) y))
    ) then
      raise exception 'host "%" is already used by another rep as a slug or alias', h using errcode = '23505';
    end if;
  end loop;
  return new;
end $function$;
revoke all on function public.reps_hosts_unique() from public, anon, authenticated;
drop trigger if exists reps_hosts_unique on public.reps;
CREATE TRIGGER reps_hosts_unique BEFORE INSERT OR UPDATE OF slug, host_aliases ON public.reps FOR EACH ROW EXECUTE FUNCTION reps_hosts_unique();

-- 4/5. Incremental cursor from the last SUCCESSFUL run; sweep guard bookkeeping.
alter table public.pinnacle_sync_cursor add column if not exists last_ok_start timestamptz;
update public.pinnacle_sync_cursor c set last_ok_start = r.s
  from (select base_id, table_name, max(started_at) s from public.pinnacle_sync_table_runs group by 1, 2) r
 where c.last_ok_start is null and r.base_id = c.base_id and r.table_name = c.table_name;
alter table public.pinnacle_sync_table_runs add column if not exists clean boolean not null default true;
alter table public.pinnacle_sync_table_runs add column if not exists sweep_skipped text;

-- 5. Sweep only a clean run that fetched >= 90% of the live rows.
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
  swept_total bigint := 0;
  tables_done int := 0;
  skipped jsonb := '[]'::jsonb;
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
    -- Sweep only a pull that finished cleanly (no error, not cut off) AND saw
    -- at least 90% of the rows we hold for that table. A short or broken
    -- pull is never trusted to wipe rows.
    select count(*) into live from pinnacle_airtable_records
    where base_id = r.base_id and table_name = r.table_name;
    if not coalesce(r.clean, false) then
      why := 'run not clean';
    elsif r.fetched is null or r.fetched <= 0 then
      why := 'zero-row fetch';
    elsif r.fetched < 0.9 * live then
      why := format('fetched %s < 90%% of %s live rows', r.fetched, live);
    end if;
    if why is null then
      delete from pinnacle_airtable_records
      where base_id = r.base_id and table_name = r.table_name and fetched_at < r.started_at;
      get diagnostics n = row_count;
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

  return jsonb_build_object('tables', tables_done, 'swept', swept_total, 'sweep_skipped', skipped, 'rebuilt_at', now());
end;
$function$;
revoke all on function public.pinnacle_post_sync(boolean) from public, anon, authenticated;
grant execute on function public.pinnacle_post_sync(boolean) to service_role;

-- 7. One to-do per message per member.
CREATE UNIQUE INDEX IF NOT EXISTS cxo_todos_message_link_uq ON public.cxo_todos USING btree (rep_id, member_id, link_kind, link_id) WHERE ((link_kind = 'message'::text) AND (deleted_at IS NULL));

-- 11. Batch the meeting-mention bumps into one statement.
CREATE OR REPLACE FUNCTION public.cxo_bump_todo_mentions(p_rep_id text, p_member_id uuid, p_ids uuid[], p_note_id uuid, p_title text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update cxo_todos t
  set mentions = t.mentions + x.n, note_id = p_note_id, meeting_title = p_title, meeting_at = p_at, updated_at = now()
  from (select id, count(*)::int n from unnest(p_ids) id group by id) x
  where t.id = x.id and t.rep_id = p_rep_id and t.member_id = p_member_id;
$function$;
revoke all on function public.cxo_bump_todo_mentions(text, uuid, uuid[], uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cxo_bump_todo_mentions(text, uuid, uuid[], uuid, text, timestamptz) to service_role;
