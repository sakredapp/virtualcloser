-- Employees v2 (owner 10-09): quotas with a type, yearly periods, HR basics,
-- a time-off log, and links to the book (Premium / Policies by agent or team)
-- and to QuickBooks (cxo_qbo_employees). Service-role only, like every cxo table.

-- Quotas are KPIs with a type. Every existing KPI becomes a 'custom' quota.
alter table cxo_employee_kpis add column if not exists quota_type text not null default 'custom';
alter table cxo_employee_kpis drop constraint if exists cxo_employee_kpis_quota_type_check;
alter table cxo_employee_kpis add constraint cxo_employee_kpis_quota_type_check
  check (quota_type in ('revenue', 'premium', 'policies', 'recruits', 'appointments', 'custom'));
-- 'book' = actual read live from the book (premium / policies) for the employee's book_match.
alter table cxo_employee_kpis add column if not exists actual_source text not null default 'manual';
alter table cxo_employee_kpis drop constraint if exists cxo_employee_kpis_actual_source_check;
alter table cxo_employee_kpis add constraint cxo_employee_kpis_actual_source_check
  check (actual_source in ('manual', 'book'));

-- Year periods (period key '2026').
alter table cxo_employee_kpis drop constraint if exists cxo_employee_kpis_period_check;
alter table cxo_employee_kpis add constraint cxo_employee_kpis_period_check check (period in ('month', 'quarter', 'year'));
alter table cxo_comp_tiers drop constraint if exists cxo_comp_tiers_period_check;
alter table cxo_comp_tiers add constraint cxo_comp_tiers_period_check check (period in ('month', 'quarter', 'year'));

-- HR basics, all optional. Pay is exec-only (stripped server-side).
alter table cxo_employees add column if not exists hourly_rate numeric;
alter table cxo_employees add column if not exists hours_per_week numeric;
alter table cxo_employees add column if not exists pto_allowed_days numeric;
alter table cxo_employees add column if not exists pto_balance_days numeric;
-- Book link: the agent or team name this person is credited with in the book.
alter table cxo_employees add column if not exists book_match text;
alter table cxo_employees add column if not exists book_dim text;
alter table cxo_employees drop constraint if exists cxo_employees_book_dim_check;
alter table cxo_employees add constraint cxo_employees_book_dim_check check (book_dim is null or book_dim in ('agent', 'team'));
-- QuickBooks link (cxo_qbo_employees.qbo_id); matched by email/name when null.
alter table cxo_employees add column if not exists qbo_employee_id text;

create table if not exists cxo_employee_time_off (
  id           uuid primary key default gen_random_uuid(),
  rep_id       text not null,
  employee_id  uuid not null references cxo_employees(id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  days         numeric not null default 1 check (days >= 0),
  kind         text not null default 'vacation' check (kind in ('vacation', 'sick', 'personal', 'other')),
  note         text,
  source       text not null default 'entered',
  created_at   timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists cxo_employee_time_off_emp_idx on cxo_employee_time_off (rep_id, employee_id, start_date);

alter table cxo_employee_time_off enable row level security;
revoke all on cxo_employee_time_off from anon, authenticated;
grant select, insert, update, delete on cxo_employee_time_off to service_role;
notify pgrst, 'reload schema';
