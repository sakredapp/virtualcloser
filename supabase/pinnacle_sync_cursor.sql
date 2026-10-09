-- Pinnacle Airtable sync: resumable cursor + one-off agency-book dedupe.
--
-- The Vercel cron (/api/cron/pinnacle-sync, every 15 min) pulls one table at a
-- time and saves its place here after every page, so a run that hits
-- maxDuration resumes on the next tick instead of starting over. A table is
-- pulled once a day; when its pull completes the route records it in
-- pinnacle_sync_table_runs and pinnacle_post_sync() (pg_cron) deletes the rows
-- that pull did not see, rebuilds the rollups and expires the day cache.

create table if not exists public.pinnacle_sync_cursor (
  base_id         text not null,
  table_name      text not null,
  run_start       timestamptz,          -- start of the pull in progress (null = idle)
  airtable_offset text,                 -- Airtable page cursor to resume from
  fetched         integer not null default 0,
  completed_at    timestamptz,          -- last COMPLETE pull of this table
  last_error      text,
  updated_at      timestamptz not null default now(),
  primary key (base_id, table_name)
);
alter table public.pinnacle_sync_cursor enable row level security;
grant select, insert, update, delete on public.pinnacle_sync_cursor to service_role;

-- When the route last warmed the overview cache after a sweep.
create table if not exists public.pinnacle_sync_state (
  id            int primary key default 1 check (id = 1),
  warmed_at     timestamptz
);
insert into public.pinnacle_sync_state (id) values (1) on conflict do nothing;
alter table public.pinnacle_sync_state enable row level security;
grant select, insert, update on public.pinnacle_sync_state to service_role;

-- One-off: the agency bases' "Rolling 2025 BOB" kept every weekly re-import
-- (777k rows for 65k policies). Keep the newest row per policy number.
create or replace function public.pinnacle_dedupe_rolling()
returns jsonb language plpgsql security definer set statement_timeout = 0 set search_path = public as $$
declare v_deleted bigint;
begin
  perform pg_advisory_xact_lock(hashtext('pinnacle_post_sync'));
  create temp table _keep on commit drop as
    select distinct on (base_id, table_name, btrim(fields->>'Policy Number')) base_id, record_id
    from pinnacle_airtable_records
    where table_name = 'Rolling 2025 BOB'
      and nullif(btrim(fields->>'Policy Number'), '') is not null
    order by base_id, table_name, btrim(fields->>'Policy Number'),
             fetched_at desc, coalesce(fields->>'Last Modified', '') desc;
  create index on _keep (base_id, record_id);
  delete from pinnacle_airtable_records r
   where r.table_name = 'Rolling 2025 BOB'
     and nullif(btrim(r.fields->>'Policy Number'), '') is not null
     and not exists (select 1 from _keep k where k.base_id = r.base_id and k.record_id = r.record_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end $$;
revoke all on function public.pinnacle_dedupe_rolling() from public, anon, authenticated;

create or replace function public.pinnacle_dedupe_rolling_once()
returns void language plpgsql security definer set statement_timeout = 0 set search_path = public, cron as $$
declare a jsonb;
begin
  perform cron.unschedule('pinnacle-dedupe-rolling-once');
  a := pinnacle_dedupe_rolling();
  insert into pinnacle_maintenance_log (note, result) values ('dedupe rolling', a);
exception when others then
  insert into pinnacle_maintenance_log (note, result) values ('dedupe rolling FAILED', jsonb_build_object('err', sqlerrm));
end $$;
revoke all on function public.pinnacle_dedupe_rolling_once() from public, anon, authenticated;

-- Applied 2026-10-09 by hand, in order:
--   select cron.schedule('pinnacle-dedupe-rolling-once', '* * * * *', $c$set statement_timeout = 0; select public.pinnacle_dedupe_rolling_once()$c$);
--   then, once logged: a one-off pg_cron `vacuum full pinnacle_airtable_records`
--   to hand the ~3GB of dead space back to the disk.
