-- Pinnacle revenue-dashboard analytics functions.
-- Applied to prod 2026-05-21 (via Supabase migration). Kept here for the record;
-- re-running is safe (CREATE OR REPLACE). All read-only / STABLE.
--
-- Source table: pinnacle_airtable_records (raw Airtable jsonb).
-- Product line is derived from table name in the Pinnacle master base
-- (appHyYBfI6kfX6ZuW); agency-book bases aren't line-labeled.

-- 1. Daily premium series by base + product line. Powers the trend chart,
--    KPIs, projection. Reads the precomputed pinnacle_daily_rollup (rebuilt
--    each sync) instead of full-scanning the raw table on every page load.
--    See pinnacle_rollup_migration.sql for the rollup + rebuild logic.
create or replace function public.pinnacle_premium_daily()
returns table (
  d date, base_id text, line text, premium numeric, policies bigint,
  funded_premium numeric, funded_policies bigint
)
language sql stable as $$
  select d, base_id, line, premium, policies, funded_premium, funded_policies
  from pinnacle_daily_rollup;
$$;

-- 2. Daily disposition counts (Pinnacle base) → Insurance Health section.
--    Reads the precomputed pinnacle_status_rollup (rebuilt each sync).
create or replace function public.pinnacle_status_daily()
returns table (
  d date, line text, total bigint, paid bigint, declined bigint, lapsed bigint, submitted bigint
)
language sql stable as $$
  select d, line, total, paid, declined, lapsed, submitted
  from pinnacle_status_rollup;
$$;

-- 3. On-demand breakdown by dimension (team/agent/carrier/state/product).
create or replace function public.pinnacle_breakdown(
  p_dim text, p_line text, p_start date, p_end date, p_limit int default 25
)
returns table (
  label text, premium numeric, policies bigint, paid bigint, declined bigint, lapsed bigint
)
language sql stable as $$
  with src as (
    select
      case lower(p_dim)
        when 'team' then nullif(r.fields->>'Team (Parsed)','')
        when 'agent' then nullif(r.fields->>'Agent','')
        when 'carrier' then nullif(r.fields->>'Carrier','')
        when 'state' then nullif(r.fields->>'State','')
        when 'product' then nullif(r.fields->>'Product Name','')
        else null end as label,
      case
        when r.table_name ilike '%annuit%' then 'Annuity'
        when r.table_name ilike '%health%' then 'Health'
        when r.table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      r.fields->>'Effective Date' as eff_raw,
      nullif(regexp_replace(coalesce(r.fields->>'Annual Premium',''), '[^0-9.\-]', '', 'g'), '')::numeric as ap,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW' and lower(r.table_name) not like '%directory%'
  ),
  filtered as (
    select * from src
    where label is not null
      and eff_raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      and eff_raw::date between p_start and p_end
      and (p_line = 'All' or line = p_line)
  )
  select label, round(coalesce(sum(ap),0)), count(*)::bigint,
    count(*) filter (where status like '%issue - paid%' or status like '%issue-paid%')::bigint,
    count(*) filter (where status like '%declin%')::bigint,
    count(*) filter (where status like '%lapse%')::bigint
  from filtered group by label
  order by 2 desc nulls last
  limit greatest(1, least(p_limit, 200));
$$;

-- 4. Compact current/previous-month rollup → Command Center revenue strip.
create or replace function public.pinnacle_month_summary()
returns table (
  this_month_premium numeric, prev_month_premium numeric,
  this_month_total bigint, this_month_paid bigint
)
language sql stable as $$
  with src as (
    select
      r.fields->>'Effective Date' as eff_raw,
      nullif(regexp_replace(coalesce(r.fields->>'Annual Premium',''), '[^0-9.\-]', '', 'g'), '')::numeric as ap,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW' and lower(r.table_name) not like '%directory%'
      and r.fields->>'Effective Date' ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  ),
  typed as (select eff_raw::date as d, ap, status from src)
  select
    coalesce(sum(ap) filter (where date_trunc('month',d)=date_trunc('month',current_date)),0),
    coalesce(sum(ap) filter (where date_trunc('month',d)=date_trunc('month',current_date - interval '1 month')),0),
    count(*) filter (where date_trunc('month',d)=date_trunc('month',current_date))::bigint,
    count(*) filter (where date_trunc('month',d)=date_trunc('month',current_date)
      and (status like '%issue - paid%' or status like '%issue-paid%'))::bigint
  from typed;
$$;

-- 5. Arbitrary-window premium summary → Command Center revenue strip.
--    Mirrors pinnacle_premium_daily's exact filters (Pinnacle base, same table
--    exclusions + date validation) so a 7d/30d window here sums to the SAME
--    number the Pinnacle dashboard KPI shows for the same window — the home
--    strip and the Pinnacle page reconcile instead of telling two stories.
-- Reads the precomputed pinnacle_daily_rollup. `paid`/`total` map to
-- funded_policies/policies — slightly broader than the old issue-paid-only
-- count, but consistent with the dashboard's "funded" definition and instant.
create or replace function public.pinnacle_window_summary(p_start date, p_end date)
returns table (premium numeric, policies bigint, funded numeric, paid bigint, total bigint)
language sql stable as $$
  select
    coalesce(sum(premium),0)::numeric,
    coalesce(sum(policies),0)::bigint,
    coalesce(sum(funded_premium),0)::numeric,
    coalesce(sum(funded_policies),0)::bigint,
    coalesce(sum(policies),0)::bigint
  from pinnacle_daily_rollup
  where base_id = 'appHyYBfI6kfX6ZuW' and d between p_start and p_end;
$$;
