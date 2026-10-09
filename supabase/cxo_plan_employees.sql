-- Sales Plan + Employees — Suite CXO (Pinnacle exec team, owner 10-09).
--
-- Sales Plan: monthly targets by product × carrier (premium + optional
-- policy count), unit economics per product × carrier, and each carrier's
-- marketing-allowance benchmark tiers by month or quarter. Actuals are NOT
-- stored here: they come from the Pinnacle rollups the Revenue page reads.
--
-- Employees: the payroll org chart — employee records (base pay), KPIs with
-- targets, actuals per period, bonus tiers, approved payout periods (locked),
-- and reviews. `member_id` on cxo_employees links a future employee login to
-- their own record only (self-view); nothing reads it for access yet.
--
-- Every table is scoped by rep_id (the org). RLS on with no policies and
-- grants to service_role only: the app reads and writes server-side; anon and
-- authenticated get nothing. Idempotent. Project ndschjbuyjmxtzqyjgyi.

-- ── Sales plan ────────────────────────────────────────────────────────────
create table if not exists cxo_plan_targets (
  id         uuid primary key default gen_random_uuid(),
  rep_id     text not null,
  year       int  not null check (year between 2000 and 2100),
  month      int  not null check (month between 1 and 12),
  product    text not null default '',
  carrier    text not null default '',
  premium    numeric not null default 0,
  policies   int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rep_id, year, month, product, carrier)
);
create index if not exists cxo_plan_targets_year_idx on cxo_plan_targets (rep_id, year);

create table if not exists cxo_plan_unit_econ (
  id               uuid primary key default gen_random_uuid(),
  rep_id           text not null,
  year             int  not null,
  product          text not null default '',
  carrier          text not null default '',
  commission_pct   numeric,
  avg_premium      numeric,
  override_pct     numeric,
  acquisition_cost numeric,
  updated_at       timestamptz not null default now(),
  unique (rep_id, year, product, carrier)
);

create table if not exists cxo_allowance_tiers (
  id         uuid primary key default gen_random_uuid(),
  rep_id     text not null,
  year       int  not null,
  carrier    text not null,
  period     text not null default 'quarter' check (period in ('month', 'quarter')),
  threshold  numeric not null check (threshold >= 0),
  unlocks    text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists cxo_allowance_tiers_year_idx on cxo_allowance_tiers (rep_id, year, carrier);

-- ── Employees ─────────────────────────────────────────────────────────────
create table if not exists cxo_employees (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null,
  name          text not null,
  title         text,
  department    text not null default '',
  manager_id    uuid references cxo_employees(id) on delete set null,
  start_date    date,
  email         text,
  base_salary   numeric,
  pay_frequency text not null default 'biweekly' check (pay_frequency in ('weekly', 'biweekly', 'semimonthly', 'monthly')),
  member_id     uuid,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists cxo_employees_rep_idx on cxo_employees (rep_id, department);
create index if not exists cxo_employees_member_idx on cxo_employees (rep_id, member_id) where member_id is not null;

create table if not exists cxo_employee_kpis (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null,
  employee_id uuid not null references cxo_employees(id) on delete cascade,
  name        text not null,
  unit        text not null default 'count' check (unit in ('count', 'usd', 'pct', 'days', 'hours')),
  target      numeric not null default 0,
  period      text not null default 'month' check (period in ('month', 'quarter')),
  weight      numeric not null default 1,
  lower_is_better boolean not null default false,
  sort        int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists cxo_employee_kpis_emp_idx on cxo_employee_kpis (rep_id, employee_id);

create table if not exists cxo_kpi_actuals (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null,
  kpi_id      uuid not null references cxo_employee_kpis(id) on delete cascade,
  employee_id uuid not null references cxo_employees(id) on delete cascade,
  period_key  text not null,           -- '2026-10' or '2026-Q4'
  actual      numeric not null default 0,
  source      text not null default 'entered',
  updated_at  timestamptz not null default now(),
  unique (kpi_id, period_key)
);
create index if not exists cxo_kpi_actuals_rep_idx on cxo_kpi_actuals (rep_id, period_key);

create table if not exists cxo_comp_tiers (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null,
  employee_id uuid not null references cxo_employees(id) on delete cascade,
  kpi_id      uuid references cxo_employee_kpis(id) on delete cascade, -- null = overall score
  period      text not null default 'month' check (period in ('month', 'quarter')),
  attain_pct  numeric not null check (attain_pct >= 0),
  bonus       numeric not null default 0 check (bonus >= 0),
  created_at  timestamptz not null default now()
);
create index if not exists cxo_comp_tiers_emp_idx on cxo_comp_tiers (rep_id, employee_id);

create table if not exists cxo_payout_periods (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null,
  period_key  text not null,
  approved_at timestamptz not null default now(),
  approved_by uuid,
  approved_by_name text,
  total       numeric not null default 0,
  lines       jsonb not null default '[]'::jsonb,
  unique (rep_id, period_key)
);

create table if not exists cxo_reviews (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null,
  employee_id   uuid not null references cxo_employees(id) on delete cascade,
  period_type   text not null check (period_type in ('month', 'quarter', 'year')),
  period_key    text not null,         -- '2026-10', '2026-Q4' or '2026'
  overall       int check (overall between 1 and 5),
  kpi_ratings   jsonb not null default '{}'::jsonb,
  notes         text,
  reviewer_id   uuid,
  reviewer_name text,
  created_at    timestamptz not null default now()
);
create index if not exists cxo_reviews_emp_idx on cxo_reviews (rep_id, employee_id, period_key);

-- ── Access: service_role only ─────────────────────────────────────────────
alter table cxo_plan_targets    enable row level security;
alter table cxo_plan_unit_econ  enable row level security;
alter table cxo_allowance_tiers enable row level security;
alter table cxo_employees       enable row level security;
alter table cxo_employee_kpis   enable row level security;
alter table cxo_kpi_actuals     enable row level security;
alter table cxo_comp_tiers      enable row level security;
alter table cxo_payout_periods  enable row level security;
alter table cxo_reviews         enable row level security;

revoke all on cxo_plan_targets, cxo_plan_unit_econ, cxo_allowance_tiers, cxo_employees, cxo_employee_kpis,
  cxo_kpi_actuals, cxo_comp_tiers, cxo_payout_periods, cxo_reviews from anon, authenticated;
grant select, insert, update, delete on cxo_plan_targets, cxo_plan_unit_econ, cxo_allowance_tiers, cxo_employees,
  cxo_employee_kpis, cxo_kpi_actuals, cxo_comp_tiers, cxo_payout_periods, cxo_reviews to service_role;

notify pgrst, 'reload schema';
