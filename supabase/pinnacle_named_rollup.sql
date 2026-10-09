-- Pinnacle named rollup: real agency and agent names for the Team page.
-- Owner runs this once in Supabase ndschjbuyjmxtzqyjgyi (SQL editor), 2026-10-09.
--
-- Why: the Team page, Overview "top teams/agents" and the MCP read
-- pinnacle_breakdown, which scans the raw 1.3 GB mirror per request and
-- casts `Effective Date` / `Annual Premium` with ::date / ::numeric. One bad
-- value (2025-02-30, "", "-", "1.2.3") or a slow 12-month scan fails the
-- whole call, the loader swallows the error, and no names show anywhere.
-- Also, `fields->>'Agent'` on an Airtable linked-record field returns the raw
-- id array (["rec…"]) instead of a name.
--
-- This file:
--   1. pinnacle_safe_date / pinnacle_safe_num: never throw.
--   2. pinnacle_label: flattens a field (text, array, {name}) to text.
--   3. pinnacle_name_map: rec id → display name, from directory / agent /
--      team tables in the master base.
--   4. pinnacle_dim_rollup + pinnacle_rebuild_dim_rollup(): one row per day,
--      line, dimension, label (and team for agents). Rebuilt by the daily
--      sync after pinnacle_rebuild_rollups (lib/pinnacle/airtable.ts).
--   5. pinnacle_breakdown_v2: indexed read used by the app (falls back to
--      the old RPC until this has run).
--   6. pinnacle_breakdown replaced with the safe casts (same signature).
--   7. Builds the rollup once.
-- Diagnostics for the empty recent months are at the bottom (read-only).

-- 1. Safe casts ------------------------------------------------------------
create or replace function public.pinnacle_safe_date(t text)
returns date language plpgsql immutable as $$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return substring(t, 1, 10)::date;
exception when others then
  return null;
end;
$$;

create or replace function public.pinnacle_safe_num(t text)
returns numeric language plpgsql immutable as $$
declare s text := nullif(regexp_replace(coalesce(t, ''), '[^0-9.\-]', '', 'g'), '');
begin
  if s is null then return null; end if;
  return s::numeric;
exception when others then
  return null;
end;
$$;

-- 2. Field → text ------------------------------------------------------------
-- Text stays text; an array takes its first element (linked records list the
-- primary link first); an object takes its name.
create or replace function public.pinnacle_label(v jsonb)
returns text language sql immutable as $$
  select nullif(btrim(case jsonb_typeof(v)
    when 'string' then v #>> '{}'
    when 'number' then v #>> '{}'
    when 'array' then case jsonb_typeof(v -> 0)
        when 'object' then coalesce(v -> 0 ->> 'name', v -> 0 ->> 'Name', v -> 0 ->> 'id')
        else v ->> 0 end
    when 'object' then coalesce(v ->> 'name', v ->> 'Name', v ->> 'id')
    else null end), '')
$$;

-- 3. rec id → name -----------------------------------------------------------
create table if not exists public.pinnacle_name_map (
  record_id text primary key,
  name text not null,
  source_table text
);
grant select, insert, update, delete on public.pinnacle_name_map to service_role;

-- 4. The rollup --------------------------------------------------------------
create table if not exists public.pinnacle_dim_rollup (
  d date not null,
  line text not null,
  dim text not null,
  label text not null,
  team text not null default '',
  premium numeric not null default 0,
  funded numeric not null default 0,
  policies bigint not null default 0,
  paid bigint not null default 0,
  declined bigint not null default 0,
  lapsed bigint not null default 0,
  primary key (dim, d, line, label, team)
);
create index if not exists pinnacle_dim_rollup_dim_d on public.pinnacle_dim_rollup (dim, d);
grant select, insert, update, delete on public.pinnacle_dim_rollup to service_role;

create or replace function public.pinnacle_rebuild_dim_rollup()
returns void language plpgsql
set statement_timeout = '600s'
as $$
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
  with src as (
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
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW'
      and lower(r.table_name) not like '%directory%'
      and lower(r.table_name) not like '%agent list%'
      and lower(r.table_name) not like '%rolling%'
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
$$;
grant execute on function public.pinnacle_rebuild_dim_rollup() to service_role;

-- 5. Indexed read -------------------------------------------------------------
create or replace function public.pinnacle_breakdown_v2(
  p_dim text, p_line text, p_start date, p_end date, p_limit int default 25
)
returns table (
  label text, team text, premium numeric, funded numeric,
  policies bigint, paid bigint, declined bigint, lapsed bigint
)
language sql stable as $$
  select r.label, nullif(r.team, ''), round(sum(r.premium)), round(sum(r.funded)),
    sum(r.policies)::bigint, sum(r.paid)::bigint, sum(r.declined)::bigint, sum(r.lapsed)::bigint
  from pinnacle_dim_rollup r
  where r.dim = lower(p_dim)
    and r.d between p_start and p_end
    and (p_line = 'All' or r.line = p_line)
  group by r.label, r.team
  order by 3 desc nulls last
  limit greatest(1, least(p_limit, 200));
$$;
grant execute on function public.pinnacle_breakdown_v2(text, text, date, date, int) to service_role;

-- 6. The old RPC, with casts that cannot throw (same signature) --------------
create or replace function public.pinnacle_breakdown(
  p_dim text, p_line text, p_start date, p_end date, p_limit int default 25
)
returns table (
  label text, premium numeric, policies bigint, paid bigint, declined bigint, lapsed bigint
)
language sql stable as $$
  select r.label, round(sum(r.premium)), sum(r.policies)::bigint, sum(r.paid)::bigint,
    sum(r.declined)::bigint, sum(r.lapsed)::bigint
  from pinnacle_dim_rollup r
  where r.dim = lower(p_dim)
    and r.d between p_start and p_end
    and (p_line = 'All' or r.line = p_line)
  group by r.label
  order by 2 desc nulls last
  limit greatest(1, least(p_limit, 200));
$$;

-- 7. Build it now ---------------------------------------------------------------
select public.pinnacle_rebuild_dim_rollup();

-- Check: named rows exist (expect real agency / agent names, not rec ids).
-- select dim, count(distinct label) as names, sum(premium) from pinnacle_dim_rollup group by dim;
-- select label, team, sum(premium) from pinnacle_dim_rollup where dim = 'agent' group by 1, 2 order by 3 desc limit 20;

-- ============================================================================
-- DIAGNOSTICS (read-only): why are recent months near empty?
-- Hypothesis: recent applications carry a blank or future Effective Date, so a
-- by-effective-date book under-counts the current month.
-- ============================================================================
-- a) How many master-book rows per submit month have no / future Effective Date:
-- select date_trunc('month', pinnacle_safe_date(coalesce(fields->>'Submitted Date', fields->>'Application Date', fields->>'Date Submitted', fields->>'App Date')))::date as submit_month,
--        count(*) as rows,
--        count(*) filter (where pinnacle_safe_date(fields->>'Effective Date') is null) as no_effective,
--        count(*) filter (where pinnacle_safe_date(fields->>'Effective Date') > current_date) as future_effective
-- from pinnacle_airtable_records
-- where base_id = 'appHyYBfI6kfX6ZuW' and lower(table_name) not like '%directory%'
-- group by 1 order by 1 desc limit 15;
--
-- b) Which date-like fields the recent records actually carry:
-- select k, count(*) from pinnacle_airtable_records r, jsonb_object_keys(r.fields) k
-- where r.base_id = 'appHyYBfI6kfX6ZuW' and k ilike '%date%' and r.updated_at > now() - interval '30 days'
-- group by k order by 2 desc;
--
-- c) Raw value shape of Agent / Team (Parsed) (array of rec ids vs text):
-- select jsonb_typeof(fields->'Agent') t_agent, jsonb_typeof(fields->'Team (Parsed)') t_team, count(*)
-- from pinnacle_airtable_records where base_id = 'appHyYBfI6kfX6ZuW' and lower(table_name) not like '%directory%'
-- group by 1, 2;
