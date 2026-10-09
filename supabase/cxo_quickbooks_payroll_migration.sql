-- QuickBooks Online: employees + time activity (read only, synced from QBO).
-- Read by the Employees tab. Only what Intuit's Accounting API exposes:
-- no SSN, birth date, gender or home address is stored, even when returned.
-- Salary, pay rate, paychecks/pay stubs, deductions and payroll taxes are NOT
-- in the Accounting API (they need the QuickBooks Payroll API / partner access).

create table if not exists cxo_qbo_employees (
  id               uuid primary key default gen_random_uuid(),
  rep_id           text not null,
  qbo_id           text not null,             -- Employee.Id
  display_name     text not null,
  given_name       text,
  family_name      text,
  title            text,                      -- courtesy title (Mr/Ms), as QBO stores it
  email            text,
  phone            text,
  employee_number  text,
  active           boolean not null default true,
  hired_date       date,
  released_date    date,
  billable_time    boolean,
  bill_rate        numeric,                   -- what they're billed out at, if set
  cost_rate        numeric,                   -- hourly cost, if set (not payroll pay rate)
  qbo_updated_at   timestamptz,
  synced_at        timestamptz not null default now(),
  unique (rep_id, qbo_id)
);
create index if not exists cxo_qbo_employees_rep_idx on cxo_qbo_employees (rep_id, active);

create table if not exists cxo_qbo_time_activity (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null,
  qbo_id            text not null,            -- TimeActivity.Id
  txn_date          date not null,
  name_of           text,                     -- 'Employee' | 'Vendor'
  employee_qbo_id   text,                     -- joins cxo_qbo_employees.qbo_id
  employee_name     text,
  vendor_name       text,
  customer_name     text,
  class_name        text,
  item_name         text,                     -- service item
  hours             numeric not null default 0, -- worked, breaks removed
  billable_status   text,
  hourly_rate       numeric,
  cost_rate         numeric,
  description       text,
  qbo_updated_at    timestamptz,
  synced_at         timestamptz not null default now(),
  unique (rep_id, qbo_id)
);
create index if not exists cxo_qbo_time_activity_rep_idx on cxo_qbo_time_activity (rep_id, txn_date);
create index if not exists cxo_qbo_time_activity_emp_idx on cxo_qbo_time_activity (rep_id, employee_qbo_id, txn_date);

alter table cxo_qbo_employees     enable row level security;
alter table cxo_qbo_time_activity enable row level security;
revoke all on cxo_qbo_employees, cxo_qbo_time_activity from anon, authenticated;
grant select, insert, update, delete on cxo_qbo_employees, cxo_qbo_time_activity to service_role;
notify pgrst, 'reload schema';
