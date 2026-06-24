-- Pinnacle rollup migration — precomputed daily aggregates for scale.
--
-- The analytics RPCs (pinnacle_premium_daily / pinnacle_status_daily /
-- pinnacle_window_summary) used to full-scan pinnacle_airtable_records (~188k
-- jsonb rows, regex per row) on EVERY dashboard interaction. This precomputes
-- the daily aggregates into two small tables, rebuilt once per sync, and
-- repoints those hot RPCs to read the rollups instead (see the updated
-- definitions in pinnacle_analytics_functions.sql). breakdown + month_summary
-- stay on raw — breakdown needs per-record dimension fields, and month_summary
-- only runs in crons, not per-interaction.
--
-- Apply order: run THIS file first (creates + populates the rollups), then
-- re-run pinnacle_analytics_functions.sql (the repointed read functions).

-- ── Rollup tables ────────────────────────────────────────────────────────

-- Premium by (base, effective-date, line). Mirrors pinnacle_premium_daily's
-- filters: excludes directory / agent-list / rolling tables, validates date.
create table if not exists pinnacle_daily_rollup (
  base_id          text not null,
  d                date not null,
  line             text not null,
  premium          numeric default 0,
  policies         bigint default 0,
  funded_premium   numeric default 0,
  funded_policies  bigint default 0,
  primary key (base_id, d, line)
);
create index if not exists pinnacle_daily_rollup_base_date_idx
  on pinnacle_daily_rollup (base_id, d desc);

-- Disposition counts by (effective-date, line) for the Pinnacle master base.
-- Mirrors pinnacle_status_daily's filter (base = pinnacle, excl. directory).
create table if not exists pinnacle_status_rollup (
  d           date not null,
  line        text not null,
  total       bigint default 0,
  paid        bigint default 0,
  declined    bigint default 0,
  lapsed      bigint default 0,
  submitted   bigint default 0,
  primary key (d, line)
);
create index if not exists pinnacle_status_rollup_date_idx
  on pinnacle_status_rollup (d desc);

-- ── Rebuild function (called by the sync, see lib/pinnacle/airtable.ts) ────

create or replace function public.pinnacle_rebuild_rollups()
returns void language plpgsql as $$
begin
  -- Premium rollup — all bases.
  truncate pinnacle_daily_rollup;
  insert into pinnacle_daily_rollup (base_id, d, line, premium, policies, funded_premium, funded_policies)
  with src as (
    select
      r.base_id, r.table_name,
      r.fields->>'Effective Date' as eff_raw,
      nullif(regexp_replace(coalesce(r.fields->>'Annual Premium',''), '[^0-9.\-]', '', 'g'), '')::numeric as ap,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from pinnacle_airtable_records r
    where lower(r.table_name) not like '%directory%'
      and lower(r.table_name) not like '%agent list%'
      and lower(r.table_name) not like '%rolling%'
  ),
  typed as (
    select
      eff_raw::date as d, base_id,
      case
        when table_name ilike '%annuit%' then 'Annuity'
        when table_name ilike '%health%' then 'Health'
        when table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      coalesce(ap,0) as ap,
      (status like '%issue - paid%' or status like '%issue-paid%' or status like '%funded%') as is_funded
    from src
    where eff_raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      and substring(eff_raw,1,4)::int between 2020 and 2030
  )
  select base_id, d, line, sum(ap), count(*)::bigint,
         sum(ap) filter (where is_funded), count(*) filter (where is_funded)::bigint
  from typed group by base_id, d, line;

  -- Status rollup — Pinnacle master base only.
  truncate pinnacle_status_rollup;
  insert into pinnacle_status_rollup (d, line, total, paid, declined, lapsed, submitted)
  with src as (
    select
      r.fields->>'Effective Date' as eff_raw,
      case
        when r.table_name ilike '%annuit%' then 'Annuity'
        when r.table_name ilike '%health%' then 'Health'
        when r.table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW' and lower(r.table_name) not like '%directory%'
  )
  select eff_raw::date, line, count(*)::bigint,
    count(*) filter (where status like '%issue - paid%' or status like '%issue-paid%')::bigint,
    count(*) filter (where status like '%declin%')::bigint,
    count(*) filter (where status like '%lapse%')::bigint,
    count(*) filter (where status like '%submit%')::bigint
  from src
  where eff_raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    and substring(eff_raw,1,4)::int between 2020 and 2030
  group by 1, 2;
end;
$$;

-- Back-compat shim: the sync historically called pinnacle_refresh_mv(), which
-- never existed (the call silently failed). Define it as a thin alias so the
-- rebuild runs even on older sync code.
create or replace function public.pinnacle_refresh_mv()
returns void language sql as $$
  select public.pinnacle_rebuild_rollups();
$$;

-- Populate immediately so the dashboard has data before the next sync runs.
select public.pinnacle_rebuild_rollups();
