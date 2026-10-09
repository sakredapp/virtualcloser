-- Team page: people stats (headcount, onboarding, retention) from the Pinnacle
-- Directory joined to the master book's policies by 'Pinnacle Team Member'
-- (the Directory record id; 100% of policies carry it, unlike NPN).
-- Rebuilt by pinnacle_post_sync() after every swept pull; the page reads the
-- one cached row.
--
-- Data notes (10-09 audit, 8,316 Directory rows):
--  * 'Agent Created On:' 100% filled, but 1,644 rows are the Aug-2024 bulk
--    import, so onboarding metrics only use agents created on/after the first
--    month the policy book covers (Jan 2026).
--  * '5K/10K Sale Status Change' and 'First Sale Status Change' are bulk
--    stamped (3,837 rows share one second), so milestone timing is computed
--    from the policies themselves, not those timestamps.
--  * 'Last Agent Status Change' 99.6% filled; it carries admin clean-up waves
--    (Oct 2025, Mar 2026), so the chart is "marked inactive", not "stopped".
--  * Policy book holds effective dates from Jan 2026 only: 13-month
--    persistency cannot be computed until Feb 2027.
create table if not exists pinnacle_people_rollup (
  id int primary key default 1 check (id = 1),
  data jsonb not null,
  computed_at timestamptz not null default now()
);
alter table pinnacle_people_rollup enable row level security;
grant select, insert, update, delete on pinnacle_people_rollup to service_role;

create or replace function pinnacle_build_people_stats() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  book_start date;
  out jsonb;
begin
  create temp table _dir on commit drop as
  select r.record_id as id,
    pinnacle_safe_date(r.fields->>'Agent Created On:') as created,
    r.fields->>'Agent Status' as status,
    pinnacle_safe_date(r.fields->>'Last Agent Status Change') as status_changed,
    coalesce(pinnacle_label(r.fields->'Team (Parsed for Score)'), '') as team,
    coalesce(nullif(btrim(r.fields->>'Pinnacle Team Member'), ''), 'Unnamed agent') as name,
    r.fields->>'First $5K in Sales' as k5,
    r.fields->>'First $10K in Sales' as k10,
    r.fields->>'First Sale?' as first_sale
  from pinnacle_airtable_records r
  where r.base_id = 'appHyYBfI6kfX6ZuW' and r.table_name = 'Pinnacle Directory'
    and coalesce(r.fields->>'Agent Status', '') in ('Active Agent','Inactive Agent','Team Leader','Agent Pending Release','Agent Release Declined','New Agent','Terminated','Agent Release Approved');

  create temp table _pol on commit drop as
  with dd as (
    select distinct on (r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW'
      and r.table_name in ('Pinnacle Life Policies','Pinnacle Health Policies','Pinnacle Annuity Policies')
    order by r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  )
  select r.fields->'Pinnacle Team Member'->>0 as agent,
    case when r.table_name ilike '%health%' then 'Health' when r.table_name ilike '%annuit%' then 'Annuity' else 'Life' end as line,
    pinnacle_safe_date(r.fields->>'Effective Date') as eff,
    least(pinnacle_safe_date(r.fields->>'Effective Date'), pinnacle_safe_date(r.fields->>'Pinnacle Recording Date')) as wrote,
    coalesce(pinnacle_safe_num(r.fields->>'Annual Premium'), 0) as ap,
    lower(coalesce(r.fields->>'Summary Status', '')) as st
  from dd r;
  delete from _pol where wrote is null or extract(year from wrote) not between 2020 and 2030;

  select min(date_trunc('month', wrote))::date into book_start from _pol where wrote >= date '2025-06-01';

  with
  roster as (select * from _dir where status not in ('Terminated','Agent Release Approved')),
  firsts as (
    select agent, min(wrote) as first_wrote from _pol where st <> 'declined' and wrote <= today group by agent
  ),
  cum as (
    select agent, wrote, sum(ap) over (partition by agent order by wrote rows unbounded preceding) as running
    from _pol where st <> 'declined' and wrote <= today
  ),
  ms as (
    select agent, min(wrote) filter (where running >= 5000) as at5, min(wrote) filter (where running >= 10000) as at10 from cum group by agent
  ),
  joiners as (
    select d.*, f.first_wrote, (f.first_wrote - d.created) as days_first,
           (m.at5 - d.created) as days5, (m.at10 - d.created) as days10
    from _dir d left join firsts f on f.agent = d.id left join ms m on m.agent = d.id
    where d.created >= book_start and d.created <= today
  ),
  months as (select generate_series(date_trunc('month', today) - interval '11 months', date_trunc('month', today), interval '1 month')::date as m),
  pers as (
    select p.line, (d.created > p.eff - interval '12 months') as new_agent, p.st
    from _pol p left join _dir d on d.id = p.agent
    where p.eff between (today - interval '12 months')::date and (today - interval '6 months')::date and p.st in ('issue - paid','lapsed')
  )
  select jsonb_build_object(
    'today', today,
    'book_start', book_start,
    'fill', (select jsonb_build_object(
        'directory_rows', count(*),
        'created_on', round(avg((r.fields ? 'Agent Created On:')::int) * 100, 1),
        'agent_status', round(avg((r.fields ? 'Agent Status')::int) * 100, 1),
        'last_status_change', round(avg((r.fields ? 'Last Agent Status Change')::int) * 100, 1),
        'first_sale', round(avg((r.fields ? 'First Sale?')::int) * 100, 1),
        'first_sale_status_change', round(avg((r.fields ? 'First Sale Status Change')::int) * 100, 1),
        'first_5k', round(avg((r.fields ? 'First $5K in Sales')::int) * 100, 1),
        'first_10k', round(avg((r.fields ? 'First $10K in Sales')::int) * 100, 1),
        'npn', round(avg((r.fields ? 'NPN')::int) * 100, 1),
        'team', round(avg((r.fields ? 'Team (Parsed for Score)')::int) * 100, 1))
      from pinnacle_airtable_records r where r.base_id = 'appHyYBfI6kfX6ZuW' and r.table_name = 'Pinnacle Directory'),
    'policies_linked_pct', (select round(avg((agent is not null and exists (select 1 from _dir d where d.id = agent))::int) * 100, 1) from _pol),
    'roster', (select count(*) from roster),
    'active', (select count(*) from roster where status in ('Active Agent','Team Leader','New Agent')),
    'agencies', (select count(distinct team) from roster where team <> '' and status in ('Active Agent','Team Leader','New Agent')),
    'writing30', (select count(distinct agent) from _pol where st <> 'declined' and wrote > today - 30 and wrote <= today),
    'writing90', (select count(distinct agent) from _pol where st <> 'declined' and wrote > today - 90 and wrote <= today),
    'new30', (select count(*) from roster where created > today - 30 and created <= today),
    'writing365', (select count(distinct agent) from _pol where st <> 'declined' and wrote > today - 365 and wrote <= today),
    'new90', (select count(*) from roster where created > today - 90 and created <= today),
    'new365', (select count(*) from roster where created > today - 365 and created <= today),
    'writers_by_month', (select jsonb_agg(jsonb_build_object('m', to_char(mo.m, 'YYYY-MM'),
        'n', (select count(distinct agent) from _pol where st <> 'declined' and wrote >= mo.m and wrote < (mo.m + interval '1 month')::date and wrote <= today)) order by mo.m) from months mo),
    'joins_by_month', (select jsonb_agg(jsonb_build_object('m', to_char(mo.m, 'YYYY-MM'),
        'joined', (select count(*) from _dir d where date_trunc('month', d.created) = mo.m),
        'still_active', (select count(*) from _dir d where date_trunc('month', d.created) = mo.m and d.status in ('Active Agent','Team Leader','New Agent')),
        'inactive', (select count(*) from _dir d where date_trunc('month', d.status_changed) = mo.m and d.status not in ('Active Agent','Team Leader','New Agent')),
        'wrote', (select count(*) from joiners j where date_trunc('month', j.created) = mo.m and j.first_wrote is not null),
        'median_days', (select percentile_cont(0.5) within group (order by greatest(j.days_first, 0)) from joiners j where date_trunc('month', j.created) = mo.m and j.first_wrote is not null)
      ) order by mo.m) from months mo),
    'first_policy', (select jsonb_build_object(
        'joiners', count(*),
        'wrote', count(*) filter (where first_wrote is not null),
        'median_days', percentile_cont(0.5) within group (order by greatest(days_first, 0)) filter (where first_wrote is not null),
        'eligible30', count(*) filter (where created <= today - 30),
        'within30', count(*) filter (where created <= today - 30 and days_first <= 30),
        'eligible60', count(*) filter (where created <= today - 60),
        'within60', count(*) filter (where created <= today - 60 and days_first <= 60),
        'eligible90', count(*) filter (where created <= today - 90),
        'within90', count(*) filter (where created <= today - 90 and days_first <= 90),
        'reached5k', count(*) filter (where days5 is not null),
        'median5k', percentile_cont(0.5) within group (order by greatest(days5, 0)) filter (where days5 is not null),
        'reached10k', count(*) filter (where days10 is not null),
        'median10k', percentile_cont(0.5) within group (order by greatest(days10, 0)) filter (where days10 is not null),
        'dir_5k_flag', count(*) filter (where k5 in ('Achieved','Achievement Recorded')),
        'dir_10k_flag', count(*) filter (where k10 in ('Achieved','Achievement Recorded'))
      ) from joiners),
    'persistency6', (select jsonb_object_agg(line, v) from (
        select coalesce(line, 'All') as line, jsonb_build_object(
          'new_paid', count(*) filter (where new_agent and st = 'issue - paid'),
          'new_total', count(*) filter (where new_agent),
          'rest_paid', count(*) filter (where not coalesce(new_agent, false) and st = 'issue - paid'),
          'rest_total', count(*) filter (where not coalesce(new_agent, false))) as v
        from pers group by rollup (line)) x)
  ) into out;

  -- Retention & turnover (10-09). "Still writing" at month k = a non-declined
  -- policy in the 90 days before join + k months. A joiner only counts at k
  -- when that whole 90-day window sits inside the book (on/after book_start)
  -- and has already happened. The Aug-2024 bulk import is not a real join
  -- date, so retention joiners start Sep 2024.
  create temp table _w on commit drop as
    select agent, wrote, ap from _pol where st <> 'declined' and wrote <= today and agent is not null;
  create index on _w (agent, wrote);

  create temp table _rk on commit drop as
  select j.id, j.created, k, x.at,
    exists (select 1 from _w w where w.agent = j.id and w.wrote > x.at - 90 and w.wrote <= x.at) as writing
  from _dir j
  cross join generate_series(1, 24) k
  cross join lateral (select (j.created + make_interval(months => k))::date as at) x
  where j.created >= date '2024-09-01' and j.created <= today
    and x.at <= today and x.at - 90 >= book_start;

  -- Left = stopped writing (90 days with no policy after their last one), or
  -- moved to a leaving status while still writing; whichever came first.
  create temp table _left on commit drop as
  select a.agent, a.last_wrote, least(
      case when a.last_wrote + 90 <= today then a.last_wrote + 90 end,
      case when d.status in ('Inactive Agent','Terminated','Agent Release Approved','Agent Pending Release')
            and d.status_changed between a.last_wrote and least(a.last_wrote + 90, today) then d.status_changed end
    ) as left_on
  from (select agent, max(wrote) as last_wrote from _w group by agent) a
  left join _dir d on d.id = a.agent;

  out := out || jsonb_build_object('retention', (
    with
    flow_start as (select date_trunc('month', book_start + 90)::date as s),
    fm as (select generate_series((select s from flow_start), date_trunc('month', today)::date, interval '1 month')::date as m),
    flow as (
      select fm.m, least((fm.m + interval '1 month')::date - 1, today) as e,
        (select count(*) from _dir d where d.created >= fm.m and d.created < (fm.m + interval '1 month')::date and d.created <= today) as joined,
        (select count(*) from _left l where l.left_on >= fm.m and l.left_on < (fm.m + interval '1 month')::date) as left_n
      from fm
    ),
    flow2 as (
      select f.*, (select count(distinct w.agent) from _w w left join _left l on l.agent = w.agent
                    where w.wrote > f.e - 90 and w.wrote <= f.e and (l.left_on is null or l.left_on > f.e)) as headcount
      from flow f
    ),
    curve as (select k, count(*) as n, count(*) filter (where writing) as w from _rk group by k),
    coh as (
      select to_char(date_trunc('quarter', created), 'YYYY') || ' Q' || extract(quarter from created) as q,
             date_trunc('quarter', created)::date as qs, k, count(*) as n, count(*) filter (where writing) as w
      from _rk group by 1, 2, 3
    ),
    wash as (
      select d.id, min(w.wrote) as first_wrote, max(w.wrote) as last_wrote
      from _dir d left join _w w on w.agent = d.id
      where d.created >= book_start and d.created <= today - 180
      group by d.id
    ),
    appr as (
      select d.id, d.name, d.team, d.created,
        floor((today - d.created) / 30.44)::int as months_in,
        (select max(wrote) from _w w where w.agent = d.id) as last_wrote,
        (select count(*) from _w w where w.agent = d.id and w.wrote > today - 60) as recent_n,
        (select coalesce(sum(ap), 0) from _w w where w.agent = d.id and w.wrote > today - 60) as recent_ap,
        (select count(*) from _w w where w.agent = d.id and w.wrote > today - 120 and w.wrote <= today - 60) as prior_n,
        (select coalesce(sum(ap), 0) from _w w where w.agent = d.id and w.wrote > today - 120 and w.wrote <= today - 60) as prior_ap
      from _dir d
      where d.status in ('Active Agent','Team Leader','New Agent')
        and d.created > (today - interval '10 months')::date and d.created <= (today - interval '6 months')::date
    )
    select jsonb_build_object(
      'since', '2024-09-01',
      'window_days', 90,
      'milestones', (select jsonb_object_agg('m' || k, jsonb_build_object('n', n, 'writing', w)) from curve where k in (3, 6, 10, 12, 24)),
      'curve', (select jsonb_agg(jsonb_build_object('k', k, 'n', n, 'writing', w) order by k) from curve),
      'cohorts', (select jsonb_agg(jsonb_build_object('q', q, 'start', qs, 'points', pts) order by qs) from (
          select q, qs, jsonb_agg(jsonb_build_object('k', k, 'n', n, 'writing', w) order by k) as pts from coh group by q, qs) c),
      'flow', (select jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'), 'joined', joined, 'left', left_n, 'headcount', headcount, 'partial', e < (m + interval '1 month')::date - 1) order by m) from flow2),
      'turnover', (select jsonb_build_object(
          'from', min(m), 'to', today,
          'left', sum(left_n),
          'avg_headcount', round(avg(headcount) filter (where e = (m + interval '1 month')::date - 1), 1),
          'months', round(((today - min(m)) + 1) / 30.44, 2)) from flow2),
      'washout', (select jsonb_build_object(
          'eligible', count(*),
          'never', count(*) filter (where first_wrote is null),
          'stopped90', count(*) filter (where first_wrote is not null and last_wrote - first_wrote <= 90 and last_wrote <= today - 90)) from wash),
      'approaching', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'team', team, 'months_in', months_in,
            'last_wrote', last_wrote, 'recent_n', recent_n, 'prior_n', prior_n, 'recent_ap', recent_ap, 'prior_ap', prior_ap)
          order by (prior_ap - recent_ap) desc) from (select * from appr where prior_n > 0 and recent_ap < prior_ap order by (prior_ap - recent_ap) desc limit 40) a), '[]'::jsonb),
      'approaching_total', (select count(*) from appr where prior_n > 0 and recent_ap < prior_ap)
    )));

  insert into pinnacle_people_rollup (id, data, computed_at) values (1, out, now())
  on conflict (id) do update set data = excluded.data, computed_at = excluded.computed_at;
  return out;
end;
$$;
grant execute on function pinnacle_build_people_stats() to service_role;

-- Post-sync also rebuilds the Team page people stats (10-09).
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
  perform pinnacle_build_people_stats();
  -- Expire every tenant's day cache: the next view recomputes from the
  -- rebuilt rollups.
  update pinnacle_rollup_cache set computed_at = 'epoch', computing_since = null;

  return jsonb_build_object('tables', tables_done, 'swept', swept_total, 'rebuilt_at', now());
end;
$function$
;
