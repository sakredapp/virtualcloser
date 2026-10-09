-- Breakdown speed-up: monthly pre-aggregate of pinnacle_dim_rollup — Suite CXO.
--
-- /api/pinnacle/breakdown timed out (8s role statement_timeout) on 10-09
-- while the mirror was being de-duplicated. pinnacle_breakdown_v2 summed
-- every daily row in the window (55k rows for a 12-month agent list).
-- Now whole months come from pinnacle_dim_rollup_month (~7x fewer rows) and
-- only the partial first/last month comes from the daily table. Same
-- numbers: the monthly table is a straight sum of the daily one, rebuilt at
-- the end of pinnacle_rebuild_dim_rollup() in the same transaction.
--
-- Idempotent. Run in the SuiteCXO Supabase project (ndschjbuyjmxtzqyjgyi).

create table if not exists pinnacle_dim_rollup_month (
  m        date    not null,
  line     text    not null,
  dim      text    not null,
  label    text    not null,
  team     text    not null default '',
  premium  numeric not null default 0,
  funded   numeric not null default 0,
  policies bigint  not null default 0,
  paid     bigint  not null default 0,
  declined bigint  not null default 0,
  lapsed   bigint  not null default 0,
  primary key (dim, m, line, label, team)
);
alter table pinnacle_dim_rollup_month enable row level security;
grant select, insert, update, delete on pinnacle_dim_rollup_month to service_role;

CREATE OR REPLACE FUNCTION public.pinnacle_rebuild_dim_rollup()
 RETURNS void
 LANGUAGE plpgsql
 SET statement_timeout TO '1800s'
AS $function$
begin
  delete from pinnacle_name_map;
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

  delete from pinnacle_dim_rollup;
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
      -- Team = the Directory's 'Team (Parsed for Score)' for the writing agent
      -- (Score's own naming). Life policies carry no 'Team (Parsed)' at all.
      coalesce(pinnacle_label(dir.fields -> 'Team (Parsed for Score)'),
               pinnacle_label(r.fields -> 'Team (Parsed)'),
               pinnacle_label(r.fields -> 'Team (parsed)')) as team_raw,
      pinnacle_label(r.fields -> 'Agent') as agent_raw,
      pinnacle_label(r.fields -> 'Carrier') as carrier,
      pinnacle_label(r.fields -> 'State') as state,
      pinnacle_label(r.fields -> 'Product Name') as product
    from dd r
    left join pinnacle_airtable_records dir
      on dir.base_id = r.base_id and dir.table_name = 'Pinnacle Directory'
     and dir.record_id = r.fields -> 'Pinnacle Team Member' ->> 0
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

  -- Monthly pre-aggregate for the breakdown tables (pinnacle_breakdown_v2
  -- reads whole months here and only the partial edge days from the daily
  -- table). Rebuilt in the same transaction, so readers never see it empty.
  delete from pinnacle_dim_rollup_month;
  insert into pinnacle_dim_rollup_month (m, line, dim, label, team, premium, funded, policies, paid, declined, lapsed)
  select date_trunc('month', d)::date, line, dim, label, team,
    sum(premium), sum(funded), sum(policies)::bigint, sum(paid)::bigint, sum(declined)::bigint, sum(lapsed)::bigint
  from pinnacle_dim_rollup
  group by 1, line, dim, label, team
  order by dim, 1;
end;
$function$
;

create or replace function public.pinnacle_breakdown_v2(p_dim text, p_line text, p_start date, p_end date, p_limit integer default 25)
returns table(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint, lapsed bigint)
language plpgsql
stable
as $$
declare
  -- First whole month inside the window, and the day after the last one.
  ms date := case when p_start = date_trunc('month', p_start)::date then p_start
                  else (date_trunc('month', p_start) + interval '1 month')::date end;
  me date := case when p_end = (date_trunc('month', p_end) + interval '1 month - 1 day')::date
                  then (date_trunc('month', p_end) + interval '1 month')::date
                  else date_trunc('month', p_end)::date end;
  v_dim text := lower(p_dim);
begin
  if ms >= me then
    -- No whole month inside the window: daily rows only.
    ms := p_end + 1;
    me := p_end + 1;
  end if;
  return query
  with rows as (
    -- whole months
    select r.label, r.team, r.premium, r.funded, r.policies, r.paid, r.declined, r.lapsed
    from pinnacle_dim_rollup_month r
    where r.dim = v_dim and r.m >= ms and r.m < me
      and (p_line = 'All' or r.line = p_line)
    union all
    -- partial first month (or the whole window when it has no whole month)
    select r.label, r.team, r.premium, r.funded, r.policies, r.paid, r.declined, r.lapsed
    from pinnacle_dim_rollup r
    where r.dim = v_dim and r.d >= p_start and r.d < least(ms, p_end + 1)
      and (p_line = 'All' or r.line = p_line)
    union all
    -- partial last month
    select r.label, r.team, r.premium, r.funded, r.policies, r.paid, r.declined, r.lapsed
    from pinnacle_dim_rollup r
    where r.dim = v_dim and r.d >= greatest(me, p_start) and r.d <= p_end and me <= p_end
      and (p_line = 'All' or r.line = p_line)
  )
  select x.label, nullif(x.team, ''), round(sum(x.premium)), round(sum(x.funded)),
    sum(x.policies)::bigint, sum(x.paid)::bigint, sum(x.declined)::bigint, sum(x.lapsed)::bigint
  from rows x
  group by x.label, x.team
  order by 3 desc nulls last
  limit greatest(1, least(p_limit, 200));
end;
$$;
grant execute on function public.pinnacle_breakdown_v2(text, text, date, date, integer) to service_role;

-- First fill (the 20-minute post-sync keeps it current after this).
insert into pinnacle_dim_rollup_month (m, line, dim, label, team, premium, funded, policies, paid, declined, lapsed)
select date_trunc('month', d)::date, line, dim, label, team,
  sum(premium), sum(funded), sum(policies)::bigint, sum(paid)::bigint, sum(declined)::bigint, sum(lapsed)::bigint
from pinnacle_dim_rollup
group by 1, line, dim, label, team
on conflict do nothing;
