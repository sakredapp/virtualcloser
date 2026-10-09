CREATE OR REPLACE FUNCTION public.pinnacle_rebuild_dim_rollup()
 RETURNS void
 LANGUAGE plpgsql
 SET statement_timeout TO '1800s'
AS $function$
begin
  truncate pinnacle_name_map;
  insert into pinnacle_name_map (record_id, name, source_table)
  select distinct on (r.record_id) r.record_id,
    coalesce(
      pinnacle_label(r.fields -> 'Name'), pinnacle_label(r.fields -> 'Full Name'),
      pinnacle_label(r.fields -> 'Agent Name'), pinnacle_label(r.fields -> 'Agent'),
      pinnacle_label(r.fields -> 'Team Name'), pinnacle_label(r.fields -> 'Team'),
      pinnacle_label(r.fields -> 'Agency'), nullif(btrim(concat_ws(' ', r.fields ->> 'First Name', r.fields ->> 'Last Name')), '')
    ),
    r.table_name
  from pinnacle_airtable_records r
  where r.base_id = 'appHyYBfI6kfX6ZuW'
    and lower(r.table_name) ~ '(directory|agent|team|agenc|producer|roster|downline)'
    and coalesce(
      pinnacle_label(r.fields -> 'Name'), pinnacle_label(r.fields -> 'Full Name'),
      pinnacle_label(r.fields -> 'Agent Name'), pinnacle_label(r.fields -> 'Agent'),
      pinnacle_label(r.fields -> 'Team Name'), pinnacle_label(r.fields -> 'Team'),
      pinnacle_label(r.fields -> 'Agency'), nullif(btrim(concat_ws(' ', r.fields ->> 'First Name', r.fields ->> 'Last Name')), '')
    ) is not null
  order by r.record_id, (lower(r.table_name) like '%directory%') desc;

  truncate pinnacle_dim_rollup;
  insert into pinnacle_dim_rollup (d, line, dim, label, team, premium, funded, policies, paid, declined, lapsed)
  with dd as (
    -- Airtable's policy tables are wiped and re-imported weekly with new
    -- record ids, so the mirror can hold the same policy many times. One row
    -- per policy number (latest edit wins); rows without one stay as-is.
    select distinct on (r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW'
      and lower(r.table_name) not like '%directory%'
      and lower(r.table_name) not like '%agent list%'
      and lower(r.table_name) not like '%rolling%'
    order by r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ),
  src as (
    select
      pinnacle_safe_date(r.fields ->> 'Effective Date') as d,
      case
        when r.table_name ilike '%annuit%' then 'Annuity'
        when r.table_name ilike '%health%' then 'Health'
        when r.table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      coalesce(pinnacle_safe_num(r.fields ->> 'Annual Premium'), 0) as ap,
      lower(coalesce(r.fields ->> 'Summary Status', '')) as status,
      pinnacle_label(r.fields -> 'Team (Parsed)') as team_raw,
      pinnacle_label(r.fields -> 'Agent') as agent_raw,
      pinnacle_label(r.fields -> 'Carrier') as carrier,
      pinnacle_label(r.fields -> 'State') as state,
      pinnacle_label(r.fields -> 'Product Name') as product
    from dd r
  ),
  named as (
    select s.d, s.line, s.ap, s.status, s.carrier, s.state, s.product,
      case when s.team_raw ~ '^rec[A-Za-z0-9]{14}$' then tm.name else s.team_raw end as team,
      case when s.agent_raw ~ '^rec[A-Za-z0-9]{14}$' then am.name else s.agent_raw end as agent
    from src s
    left join pinnacle_name_map tm on tm.record_id = s.team_raw
    left join pinnacle_name_map am on am.record_id = s.agent_raw
    where s.d is not null and extract(year from s.d) between 2020 and 2030
  ),
  flags as (
    select *,
      (status like '%issue - paid%' or status like '%issue-paid%' or status like '%funded%') as is_paid,
      (status like '%declin%') as is_declined,
      (status like '%lapse%') as is_lapsed
    from named
  ),
  dims as (
    select d, line, 'team' as dim, team as label, '' as team, ap, is_paid, is_declined, is_lapsed from flags where team is not null
    union all
    select d, line, 'agent', agent, coalesce(team, ''), ap, is_paid, is_declined, is_lapsed from flags where agent is not null
    union all
    select d, line, 'carrier', carrier, '', ap, is_paid, is_declined, is_lapsed from flags where carrier is not null
    union all
    select d, line, 'state', state, '', ap, is_paid, is_declined, is_lapsed from flags where state is not null
    union all
    select d, line, 'product', product, '', ap, is_paid, is_declined, is_lapsed from flags where product is not null
  )
  select d, line, dim, label, team,
    sum(ap), coalesce(sum(ap) filter (where is_paid), 0),
    count(*)::bigint,
    count(*) filter (where is_paid)::bigint,
    count(*) filter (where is_declined)::bigint,
    count(*) filter (where is_lapsed)::bigint
  from dims
  group by d, line, dim, label, team;
end;
$function$;

CREATE OR REPLACE FUNCTION public.pinnacle_rebuild_rollups()
 RETURNS void
 LANGUAGE plpgsql
 SET statement_timeout TO '1800s'
AS $function$
begin
  -- Premium rollup — all bases.
  truncate pinnacle_daily_rollup;
  insert into pinnacle_daily_rollup (base_id, d, line, premium, policies, funded_premium, funded_policies)
  with dd as (
    -- Airtable's policy tables are wiped and re-imported weekly with new
    -- record ids, so the mirror can hold the same policy many times. One row
    -- per policy number (latest edit wins); rows without one stay as-is.
    select distinct on (r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where lower(r.table_name) not like '%directory%'
      and lower(r.table_name) not like '%agent list%'
      and lower(r.table_name) not like '%rolling%'
    order by r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ),
  src as (
    select
      r.base_id, r.table_name,
      r.fields->>'Effective Date' as eff_raw,
      nullif(regexp_replace(coalesce(r.fields->>'Annual Premium',''), '[^0-9.\-]', '', 'g'), '')::numeric as ap,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from dd r
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
  with dd as (
    -- Airtable's policy tables are wiped and re-imported weekly with new
    -- record ids, so the mirror can hold the same policy many times. One row
    -- per policy number (latest edit wins); rows without one stay as-is.
    select distinct on (r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW' and lower(r.table_name) not like '%directory%'
    order by r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ),
  src as (
    select
      r.fields->>'Effective Date' as eff_raw,
      case
        when r.table_name ilike '%annuit%' then 'Annuity'
        when r.table_name ilike '%health%' then 'Health'
        when r.table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from dd r
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
$function$;
