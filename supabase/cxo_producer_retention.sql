-- Agent retention, placement by carrier/product and the submit->issue lag for
-- Ciao's producer_production tool (Suite CXO, 2026-10-18).
--
-- Retention uses the Team page's definitions (pinnacle_build_people_stats,
-- supabase/pinnacle_people_stats.sql) so Ciao and the agent page agree:
--   * writing  = at least one policy that is not declined, dated
--                least(Effective Date, Pinnacle Recording Date) (tenant book:
--                submitted_on, not declined or withdrawn);
--   * left     = 90 days with no policy after the agent's last one, or moved
--                to a leaving Directory status (Inactive Agent, Terminated,
--                Agent Release Approved, Agent Pending Release) while still
--                writing; whichever came first;
--   * headcount on a day = agents writing in the 90 days up to it who have
--                not left by it (the page's "flow" headcount).
-- Per window: active at the start (headcount the day before), retained (of
-- those, not left by the end), stopped (left during the window), active at
-- the end, new writers (first policy ever in the window), joined (Directory
-- created / contracted in the window), reactivated (a policy in the window
-- after a 90+ day gap), plus who went quiet and who is drifting (30-89 days
-- since their last policy).
--
-- Sources, one shape: p_source 'pinnacle' reads the Airtable mirror (no
-- tenant column; the app calls it only for tenants on the Pinnacle
-- allow-list), 'tenant' reads cxo_book_* scoped by p_rep_id.
--
-- All functions are read only and executable by service_role only.
-- Idempotent: safe to re-run. Run in the SuiteCXO project (ndschjbuyjmxtzqyjgyi).

-- 1) Pinnacle: the page's agent writes, cached after every sync -------------
-- Reading the policy JSON on every question took 5-30 s; the same rows the
-- Team page builds from are kept here (one row per non-declined policy) and
-- rebuilt by pinnacle_post_sync() right after pinnacle_build_people_stats().
create table if not exists public.pinnacle_agent_writes (
  agent text not null,
  line text not null,
  wrote date not null,
  ap numeric not null default 0
);
create index if not exists pinnacle_agent_writes_agent_idx on public.pinnacle_agent_writes (agent, wrote);
create index if not exists pinnacle_agent_writes_wrote_idx on public.pinnacle_agent_writes (wrote);
alter table public.pinnacle_agent_writes enable row level security;
revoke all on public.pinnacle_agent_writes from anon, authenticated;
grant select, insert, update, delete on public.pinnacle_agent_writes to service_role;

create table if not exists public.pinnacle_agent_dir (
  id text primary key,
  name text not null,
  team text not null default '',
  created date,
  status text,
  status_changed date,
  leaving boolean not null default false
);
alter table public.pinnacle_agent_dir enable row level security;
revoke all on public.pinnacle_agent_dir from anon, authenticated;
grant select, insert, update, delete on public.pinnacle_agent_dir to service_role;

create or replace function public.pinnacle_build_agent_writes() returns void
language plpgsql security definer set search_path = public set statement_timeout = '600s'
as $fn$
begin
  delete from pinnacle_agent_writes;
  insert into pinnacle_agent_writes (agent, line, wrote, ap)
  select agent, line, wrote, ap from (
    -- One row per policy number (latest edit wins), same dedupe and dates as the page.
    select distinct on (r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id))
      r.fields->'Pinnacle Team Member'->>0 as agent,
      case when r.table_name ilike '%health%' then 'Health' when r.table_name ilike '%annuit%' then 'Annuity' else 'Life' end as line,
      least(pinnacle_safe_date(r.fields->>'Effective Date'), pinnacle_safe_date(r.fields->>'Pinnacle Recording Date')) as wrote,
      coalesce(pinnacle_safe_num(r.fields->>'Annual Premium'), 0) as ap,
      lower(coalesce(r.fields->>'Summary Status', '')) as st
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW'
      and r.table_name in ('Pinnacle Life Policies', 'Pinnacle Health Policies', 'Pinnacle Annuity Policies')
    order by r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ) p
  where st <> 'declined' and agent is not null and wrote is not null
    and extract(year from wrote) between 2020 and 2030;

  delete from pinnacle_agent_dir;
  insert into pinnacle_agent_dir (id, name, team, created, status, status_changed, leaving)
  select distinct on (r.record_id) r.record_id,
    coalesce(nullif(btrim(r.fields->>'Pinnacle Team Member'), ''), 'Unnamed agent'),
    coalesce(pinnacle_label(r.fields->'Team (Parsed for Score)'), ''),
    pinnacle_safe_date(r.fields->>'Agent Created On:'),
    r.fields->>'Agent Status',
    pinnacle_safe_date(r.fields->>'Last Agent Status Change'),
    coalesce(r.fields->>'Agent Status', '') in ('Inactive Agent', 'Terminated', 'Agent Release Approved', 'Agent Pending Release')
  from pinnacle_airtable_records r
  where r.base_id = 'appHyYBfI6kfX6ZuW' and r.table_name = 'Pinnacle Directory'
    and coalesce(r.fields->>'Agent Status', '') in ('Active Agent', 'Inactive Agent', 'Team Leader', 'Agent Pending Release',
      'Agent Release Declined', 'New Agent', 'Terminated', 'Agent Release Approved')
  order by r.record_id, r.fetched_at desc;
end;
$fn$;
revoke all on function public.pinnacle_build_agent_writes() from public, anon, authenticated;
grant execute on function public.pinnacle_build_agent_writes() to service_role;

-- Hook it into the post-sync right after the Team page stats, without
-- copying the whole function: patch the live definition once (idempotent).
do $do$
declare def text;
begin
  def := pg_get_functiondef('public.pinnacle_post_sync(boolean)'::regprocedure);
  if position('pinnacle_build_agent_writes' in def) = 0 then
    if position('perform pinnacle_build_people_stats();' in def) = 0 then
      raise exception 'pinnacle_post_sync has no pinnacle_build_people_stats() call to hook after';
    end if;
    def := replace(def, 'perform pinnacle_build_people_stats();',
      'perform pinnacle_build_people_stats();' || chr(10) || '  perform pinnacle_build_agent_writes();');
    execute def;
  end if;
end;
$do$;

-- First fill.
select public.pinnacle_build_agent_writes();

-- 2) Retention ---------------------------------------------------------------
create or replace function public.cxo_producer_retention(
  p_source text, p_rep_id text, p_line text,
  p_start date, p_end date, p_prior_start date, p_prior_end date,
  p_today date, p_team text default null, p_limit int default 25
)
returns jsonb
language sql stable
set search_path = public
as $$
  with
  raw_w as (
    select agent, line, wrote, ap from pinnacle_agent_writes where p_source = 'pinnacle'
    union all
    select pol.producer_id::text, pol.line, pol.submitted_on, pol.annual_premium
    from cxo_book_policies pol
    where p_source = 'tenant' and pol.rep_id = p_rep_id and pol.status not in ('declined', 'withdrawn')
  ),
  dir as (
    select id, name, team, created, status, status_changed, leaving from pinnacle_agent_dir where p_source = 'pinnacle'
    union all
    select p.id::text, p.name, coalesce(p.agency, ''), p.contracted_at, p.status, null::date, false
    from cxo_book_producers p
    where p_source = 'tenant' and p.rep_id = p_rep_id
  ),
  dir_f as (
    select * from dir where p_team is null or team ilike '%' || p_team || '%'
  ),
  w as (
    select x.agent, x.wrote, x.ap
    from raw_w x left join dir d on d.id = x.agent
    where x.wrote <= p_today
      and (p_line is null or p_line = 'All' or x.line = p_line)
      and (p_team is null or d.team ilike '%' || p_team || '%')
  ),
  lw as (
    select agent, min(wrote) as first_wrote, max(wrote) as last_wrote from w group by agent
  ),
  lft as (
    select l.agent, l.first_wrote, l.last_wrote, least(
        case when l.last_wrote + 90 <= p_today then l.last_wrote + 90 end,
        case when d.leaving and d.status_changed between l.last_wrote and least(l.last_wrote + 90, p_today) then d.status_changed end
      ) as left_on
    from lw l left join dir d on d.id = l.agent
  ),
  per as (
    select k, s, least(e, p_today) as e
    from (values ('now', p_start, p_end), ('prior', p_prior_start, p_prior_end)) v(k, s, e)
  ),
  hc_start as (
    select p.k, w.agent
    from per p join w on w.wrote > p.s - 91 and w.wrote <= p.s - 1
    join lft l on l.agent = w.agent
    where l.left_on is null or l.left_on > p.s - 1
    group by p.k, w.agent
  ),
  hc_end as (
    select p.k, w.agent
    from per p join w on w.wrote > p.e - 90 and w.wrote <= p.e
    join lft l on l.agent = w.agent
    where l.left_on is null or l.left_on > p.e
    group by p.k, w.agent
  ),
  gaps as (
    select agent, wrote, wrote - lag(wrote) over (partition by agent order by wrote) as gap from w
  ),
  stats as (
    select p.k, jsonb_build_object(
      'start', p.s, 'end', p.e,
      'active_start', (select count(*) from hc_start h where h.k = p.k),
      'retained', (select count(*) from hc_start h join lft l on l.agent = h.agent where h.k = p.k and (l.left_on is null or l.left_on > p.e)),
      'stopped', (select count(*) from lft l where l.left_on between p.s and p.e),
      'active_end', (select count(*) from hc_end h where h.k = p.k),
      'writing', (select count(distinct agent) from w where w.wrote between p.s and p.e),
      'new_writers', (select count(*) from lw where lw.first_wrote between p.s and p.e),
      'joined', (select count(*) from dir_f d where d.created between p.s and p.e),
      'reactivated', (select count(distinct g.agent) from gaps g where g.wrote between p.s and p.e and g.gap >= 90)
    ) as v
    from per p
  ),
  tail as (
    -- What each agent wrote in the 90 days up to their last policy.
    select w.agent, count(*) as policies, round(sum(w.ap)) as ap
    from w join lft l on l.agent = w.agent
    where w.wrote > l.last_wrote - 90
    group by w.agent
  ),
  quiet as (
    select coalesce(d.name, 'Unnamed agent') as name, nullif(d.team, '') as team, l.last_wrote as last_sale, l.left_on as stopped_on,
      case when l.left_on = l.last_wrote + 90 then 'no policy in 90 days' else 'marked ' || coalesce(d.status, 'inactive') end as why,
      t.policies as policies_last_90_days_before, t.ap as ap_last_90_days_before
    from lft l
    join per p on p.k = 'now'
    left join dir d on d.id = l.agent
    left join tail t on t.agent = l.agent
    where l.left_on between p.s and p.e
  ),
  risk as (
    select h.agent, max(w.wrote) as last_sale
    from hc_end h join per p on p.k = h.k join w on w.agent = h.agent and w.wrote <= p.e
    where h.k = 'now'
    group by h.agent
  ),
  risk2 as (
    select coalesce(d.name, 'Unnamed agent') as name, nullif(d.team, '') as team, r.last_sale,
      (p.e - r.last_sale) as days_since, t.ap as ap_last_90_days_before
    from risk r join per p on p.k = 'now'
    left join dir d on d.id = r.agent
    left join tail t on t.agent = r.agent
    where p.e - r.last_sale >= 30
  )
  select jsonb_build_object(
    'inactive_after_days', 90,
    'data_through', (select max(wrote) from w),
    'now', (select v from stats where k = 'now'),
    'prior', (select v from stats where k = 'prior'),
    'went_quiet_count', (select count(*) from quiet),
    'reactivated_agents', coalesce((select jsonb_agg(to_jsonb(x) order by x.came_back_on desc)
      from (select coalesce(d.name, 'Unnamed agent') as name, nullif(d.team, '') as team, min(g.wrote) as came_back_on, max(g.gap) as gap_days
            from gaps g join per p on p.k = 'now' left join dir d on d.id = g.agent
            where g.wrote between p.s and p.e and g.gap >= 90
            group by g.agent, d.name, d.team
            order by 3 desc
            limit greatest(1, least(p_limit, 200))) x), '[]'::jsonb),
    'went_quiet', coalesce((select jsonb_agg(to_jsonb(q) order by q.ap_last_90_days_before desc nulls last, q.last_sale desc)
      from (select * from quiet order by ap_last_90_days_before desc nulls last, last_sale desc limit greatest(1, least(p_limit, 200))) q), '[]'::jsonb),
    'drifting', jsonb_build_object(
      'days_30_59', (select count(*) from risk2 where days_since < 60),
      'days_60_89', (select count(*) from risk2 where days_since >= 60),
      'top', coalesce((select jsonb_agg(to_jsonb(x) order by x.ap_last_90_days_before desc nulls last)
        from (select * from risk2 order by ap_last_90_days_before desc nulls last limit 10) x), '[]'::jsonb))
  );
$$;
revoke all on function public.cxo_producer_retention(text, text, text, date, date, date, date, date, text, int) from public, anon, authenticated;
grant execute on function public.cxo_producer_retention(text, text, text, date, date, date, date, date, text, int) to service_role;

-- 3) Tenant book: placement by carrier / product / agency -------------------
-- Same shape as pinnacle_breakdown_v2 plus pending. Withdrawn apps excluded
-- (as in cxo_book_producer_production). paid = issued, lapsed = issued then lapsed.
create or replace function public.cxo_book_breakdown(
  p_rep_id text, p_dim text, p_line text, p_start date, p_end date, p_limit int default 50
)
returns table(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint, lapsed bigint, pending bigint)
language sql stable
set search_path = public
as $$
  select coalesce(case lower(p_dim) when 'product' then pol.product when 'team' then pr.agency when 'line' then pol.line else pol.carrier end, 'Not recorded') as label,
    null::text,
    round(sum(pol.annual_premium)),
    round(sum(case when pol.status in ('issued', 'lapsed') then pol.annual_premium else 0 end)),
    count(*)::bigint,
    count(*) filter (where pol.status = 'issued')::bigint,
    count(*) filter (where pol.status = 'declined')::bigint,
    count(*) filter (where pol.status = 'lapsed')::bigint,
    count(*) filter (where pol.status = 'submitted')::bigint
  from cxo_book_policies pol
  left join cxo_book_producers pr on pr.id = pol.producer_id
  where pol.rep_id = p_rep_id and pol.submitted_on between p_start and p_end
    and pol.status <> 'withdrawn'
    and (p_line is null or p_line = 'All' or pol.line = p_line)
  group by 1
  order by 5 desc, 1
  limit greatest(1, least(p_limit, 200));
$$;
revoke all on function public.cxo_book_breakdown(text, text, text, date, date, int) from public, anon, authenticated;
grant execute on function public.cxo_book_breakdown(text, text, text, date, date, int) to service_role;

-- 4) How long apps stay pending ----------------------------------------------
-- curve: by age in weeks (today minus the date the book buckets by: Pinnacle
-- = Effective Date, the date every placement figure uses; tenant =
-- submitted_on), how many apps and how many are still pending. The app reads
-- the age from which pending stays under 5% as the settle lag.
-- Tenant books also carry issued_on, so the real median submit->issue days.
create or replace function public.cxo_placement_maturity(
  p_source text, p_rep_id text, p_line text, p_today date, p_weeks int default 16
)
returns jsonb
language sql stable
set search_path = public
as $$
  with ages as (
    select ((p_today - s.d) / 7)::int as wk, sum(s.total)::bigint as apps, sum(s.submitted)::bigint as pending
    from pinnacle_status_rollup s
    where p_source = 'pinnacle' and s.d <= p_today and s.d > p_today - 7 * least(greatest(p_weeks, 4), 52)
      and (p_line is null or p_line = 'All' or s.line = p_line)
    group by 1
    union all
    select ((p_today - pol.submitted_on) / 7)::int, count(*)::bigint, count(*) filter (where pol.status = 'submitted')::bigint
    from cxo_book_policies pol
    where p_source = 'tenant' and pol.rep_id = p_rep_id and pol.status <> 'withdrawn'
      and pol.submitted_on <= p_today and pol.submitted_on > p_today - 7 * least(greatest(p_weeks, 4), 52)
      and (p_line is null or p_line = 'All' or pol.line = p_line)
    group by 1
  ),
  issue_lag as (
    select (pol.issued_on - pol.submitted_on) as days
    from cxo_book_policies pol
    where p_source = 'tenant' and pol.rep_id = p_rep_id and pol.issued_on is not null
      and pol.submitted_on > p_today - 365 and pol.submitted_on <= p_today
      and (p_line is null or p_line = 'All' or pol.line = p_line)
  )
  select jsonb_build_object(
    'basis', case when p_source = 'pinnacle' then 'effective_date' else 'submitted_on' end,
    'curve', coalesce((select jsonb_agg(jsonb_build_object('week', wk, 'apps', apps, 'pending', pending) order by wk) from ages), '[]'::jsonb),
    'median_issue_days', (select percentile_cont(0.5) within group (order by days) from issue_lag),
    'p90_issue_days', (select percentile_cont(0.9) within group (order by days) from issue_lag),
    'issued_sample', (select count(*) from issue_lag)
  );
$$;
revoke all on function public.cxo_placement_maturity(text, text, text, date, int) from public, anon, authenticated;
grant execute on function public.cxo_placement_maturity(text, text, text, date, int) to service_role;
