-- Producer (agent) production for Ciao (Suite CXO, QA gap #1, 2026-10-18).
--
-- Two sources, one shape:
--   1. pinnacle_producer_production(): Pinnacle Life Group's book (the
--      Airtable mirror rollup pinnacle_dim_rollup, dim = 'agent'). That book
--      has no tenant column; the app reads it only for tenants on the Pinnacle
--      allow-list (lib/pinnacle/access.ts).
--   2. cxo_book_producers + cxo_book_policies: a tenant-scoped book for any
--      other Suite CXO org (rep_id on every row). The review/demo tenant
--      rep_store_review_pinnacle holds invented rows here for QA and demos.
--      No client names or contact details: production facts only.
--
-- Both functions are read only and executable by service_role only.
-- Idempotent: safe to re-run.

-- 1) Tenant-scoped book ------------------------------------------------------
create table if not exists public.cxo_book_producers (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  name text not null,
  agency text,
  upline text,
  state text,
  status text not null default 'active' check (status in ('active', 'inactive', 'terminated')),
  contracted_at date,
  external_id text,
  created_at timestamptz not null default now()
);
create index if not exists cxo_book_producers_rep_idx on public.cxo_book_producers (rep_id, name);
alter table public.cxo_book_producers enable row level security;
revoke all on public.cxo_book_producers from anon, authenticated;
grant select, insert, update, delete on public.cxo_book_producers to service_role;

create table if not exists public.cxo_book_policies (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  producer_id uuid not null references public.cxo_book_producers(id) on delete cascade,
  carrier text,
  line text not null default 'Life' check (line in ('Health', 'Life', 'Annuity', 'Other')),
  product text,
  submitted_on date not null,
  annual_premium numeric not null default 0,
  status text not null default 'submitted' check (status in ('submitted', 'issued', 'declined', 'lapsed', 'withdrawn')),
  issued_on date,
  lapsed_on date,
  external_id text,
  created_at timestamptz not null default now()
);
create index if not exists cxo_book_policies_rep_day_idx on public.cxo_book_policies (rep_id, submitted_on);
create index if not exists cxo_book_policies_producer_idx on public.cxo_book_policies (producer_id);
alter table public.cxo_book_policies enable row level security;
revoke all on public.cxo_book_policies from anon, authenticated;
grant select, insert, update, delete on public.cxo_book_policies to service_role;

-- 2) Tenant book: production per producer over a window ----------------------
-- premium = submitted annual premium (AP) by submitted_on; funded = issued AP.
-- paid = issued policies, lapsed = issued then lapsed, declined, pending.
create or replace function public.cxo_book_producer_production(
  p_rep_id text, p_line text, p_start date, p_end date, p_name text default null, p_limit int default 500
)
returns table(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint,
  lapsed bigint, pending bigint, first_policy date, contracted_at date, status text)
language sql stable
as $$
  with firsts as (
    select producer_id, min(submitted_on) as first_policy
    from public.cxo_book_policies where rep_id = p_rep_id group by producer_id
  ),
  win as (
    select pol.producer_id,
      sum(pol.annual_premium) as premium,
      sum(case when pol.status in ('issued', 'lapsed') then pol.annual_premium else 0 end) as funded,
      count(*) as policies,
      count(*) filter (where pol.status = 'issued') as paid,
      count(*) filter (where pol.status = 'declined') as declined,
      count(*) filter (where pol.status = 'lapsed') as lapsed,
      count(*) filter (where pol.status = 'submitted') as pending
    from public.cxo_book_policies pol
    where pol.rep_id = p_rep_id and pol.submitted_on between p_start and p_end
      and pol.status <> 'withdrawn'
      and (p_line is null or p_line = 'All' or pol.line = p_line)
    group by pol.producer_id
  )
  select p.name, p.agency, coalesce(w.premium, 0), coalesce(w.funded, 0), coalesce(w.policies, 0)::bigint,
    coalesce(w.paid, 0)::bigint, coalesce(w.declined, 0)::bigint, coalesce(w.lapsed, 0)::bigint, coalesce(w.pending, 0)::bigint,
    f.first_policy, p.contracted_at, p.status
  from public.cxo_book_producers p
  left join win w on w.producer_id = p.id
  left join firsts f on f.producer_id = p.id
  where p.rep_id = p_rep_id
    and (p_name is null or p.name ilike '%' || p_name || '%')
    -- Everyone with business in the window, plus anyone contracted in it (new producers with no business yet).
    and (w.producer_id is not null or p.contracted_at between p_start and p_end or p_name is not null)
  order by 3 desc, 1
  limit greatest(1, least(p_limit, 2000));
$$;
revoke all on function public.cxo_book_producer_production(text, text, date, date, text, int) from public, anon, authenticated;
grant execute on function public.cxo_book_producer_production(text, text, date, date, text, int) to service_role;

-- 3) Pinnacle book: the same shape from the agent rollup ----------------------
-- first_policy = the agent's earliest effective date anywhere in the rollup
-- (the rollup starts at the book's first month, so "new" is relative to it).
create or replace function public.pinnacle_producer_production(
  p_line text, p_start date, p_end date, p_name text default null, p_limit int default 500
)
returns table(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint,
  lapsed bigint, pending bigint, first_policy date, contracted_at date, status text)
language sql stable
as $$
  with win as (
    select r.label, nullif(max(r.team), '') as team,
      round(sum(r.premium)) as premium, round(sum(r.funded)) as funded,
      sum(r.policies)::bigint as policies, sum(r.paid)::bigint as paid,
      sum(r.declined)::bigint as declined, sum(r.lapsed)::bigint as lapsed
    from public.pinnacle_dim_rollup r
    where r.dim = 'agent' and r.d between p_start and p_end
      and (p_line is null or p_line = 'All' or r.line = p_line)
      and (p_name is null or r.label ilike '%' || p_name || '%')
    group by r.label
  ),
  firsts as (
    select r.label, min(r.d) as first_policy
    from public.pinnacle_dim_rollup r
    where r.dim = 'agent' and r.policies > 0 and r.label in (select label from win)
    group by r.label
  )
  select w.label, w.team, w.premium, w.funded, w.policies, w.paid, w.declined, w.lapsed,
    greatest(w.policies - w.paid - w.declined - w.lapsed, 0)::bigint,
    f.first_policy, null::date, null::text
  from win w left join firsts f on f.label = w.label
  order by 3 desc nulls last, 1
  limit greatest(1, least(p_limit, 2000));
$$;
revoke all on function public.pinnacle_producer_production(text, date, date, text, int) from public, anon, authenticated;
grant execute on function public.pinnacle_producer_production(text, date, date, text, int) to service_role;

-- 4) Recurring reports: a weekly/daily production report ----------------------
alter table public.cxo_report_jobs drop constraint if exists cxo_report_jobs_kind_check;
alter table public.cxo_report_jobs add constraint cxo_report_jobs_kind_check
  check (kind in ('open_by_person', 'overdue', 'waiting_on', 'my_open', 'production'));
