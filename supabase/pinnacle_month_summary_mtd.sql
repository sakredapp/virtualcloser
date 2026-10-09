-- pinnacle_month_summary → month-to-date from the rollups — Suite CXO.
--
-- The old body scanned raw pinnacle_airtable_records and summed the WHOLE
-- calendar month by effective date, so policies effective later this month
-- (future-dated) counted as "so far". Mira said "$9.2M so far in October"
-- while only $7.4M was effective through today.
--
-- Now: this month = the 1st through today (America/New_York) from
-- pinnacle_daily_rollup, the same table the dashboard reads; last month =
-- the whole previous month. Counts come from pinnacle_status_rollup. One
-- source, same numbers on the page and in Mira, and no raw-table scan.
--
-- Idempotent. Run in the SuiteCXO Supabase project (ndschjbuyjmxtzqyjgyi).

create or replace function public.pinnacle_month_summary()
returns table(this_month_premium numeric, prev_month_premium numeric, this_month_total bigint, this_month_paid bigint)
language sql
stable
as $$
  with t as (
    select (now() at time zone 'America/New_York')::date as today
  ), w as (
    select today,
           date_trunc('month', today)::date as m0,
           (date_trunc('month', today) - interval '1 month')::date as p0
    from t
  )
  select
    coalesce((select sum(r.premium) from pinnacle_daily_rollup r, w
              where r.base_id = 'appHyYBfI6kfX6ZuW' and r.d between w.m0 and w.today), 0)::numeric,
    coalesce((select sum(r.premium) from pinnacle_daily_rollup r, w
              where r.base_id = 'appHyYBfI6kfX6ZuW' and r.d >= w.p0 and r.d < w.m0), 0)::numeric,
    coalesce((select sum(s.total) from pinnacle_status_rollup s, w
              where s.d between w.m0 and w.today), 0)::bigint,
    coalesce((select sum(s.paid) from pinnacle_status_rollup s, w
              where s.d between w.m0 and w.today), 0)::bigint;
$$;

grant execute on function public.pinnacle_month_summary() to service_role;
