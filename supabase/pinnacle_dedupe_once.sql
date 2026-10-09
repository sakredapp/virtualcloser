-- One-time cleanup of the weekly re-import copies already in the mirror.
-- Keeps one row per (base, table, Policy Number): the newest import.
create or replace function public.pinnacle_dedupe_mirror()
returns jsonb language plpgsql security definer set statement_timeout = 0 set search_path = public as $$
declare v_deleted bigint;
begin
  perform pg_advisory_xact_lock(hashtext('pinnacle_post_sync'));
  create temp table _keep on commit drop as
    select distinct on (base_id, table_name, btrim(fields->>'Policy Number')) record_id
    from pinnacle_airtable_records
    where base_id = 'appHyYBfI6kfX6ZuW'
      and table_name in ('Pinnacle Life Policies', 'Pinnacle Health Policies')
      and nullif(btrim(fields->>'Policy Number'), '') is not null
    order by base_id, table_name, btrim(fields->>'Policy Number'),
             coalesce(fields->>'Created', '') desc, coalesce(fields->>'Last Modified', '') desc, fetched_at desc;
  create index on _keep (record_id);
  delete from pinnacle_airtable_records r
   where r.base_id = 'appHyYBfI6kfX6ZuW'
     and r.table_name in ('Pinnacle Life Policies', 'Pinnacle Health Policies')
     and nullif(btrim(r.fields->>'Policy Number'), '') is not null
     and not exists (select 1 from _keep k where k.record_id = r.record_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end $$;
revoke all on function public.pinnacle_dedupe_mirror() from public, anon, authenticated;
grant execute on function public.pinnacle_dedupe_mirror() to service_role;

create table if not exists public.pinnacle_maintenance_log (id bigserial primary key, at timestamptz default now(), note text, result jsonb);
grant select on public.pinnacle_maintenance_log to service_role;

create or replace function public.pinnacle_dedupe_and_rebuild_once()
returns void language plpgsql security definer set statement_timeout = 0 set search_path = public, cron as $$
declare a jsonb; b jsonb;
begin
  perform cron.unschedule('pinnacle-dedupe-once');
  a := pinnacle_dedupe_mirror();
  b := pinnacle_post_sync(true);
  insert into pinnacle_maintenance_log (note, result) values ('dedupe+rebuild', jsonb_build_object('dedupe', a, 'post_sync', b));
exception when others then
  insert into pinnacle_maintenance_log (note, result) values ('dedupe+rebuild FAILED', jsonb_build_object('err', sqlerrm));
end $$;
revoke all on function public.pinnacle_dedupe_and_rebuild_once() from public, anon, authenticated;

select cron.schedule('pinnacle-dedupe-once', '* * * * *', $c$select public.pinnacle_dedupe_and_rebuild_once()$c$);
