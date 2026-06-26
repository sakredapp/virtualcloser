-- Payroll / Commissions workstation (Lauren) — v0 scaffold.
--
-- Models the core of how she works payroll today: carrier DEPOSITS land in the
-- bank, she matches them to SALES/commissions owed, then tracks what's been
-- PAID OUT. Deliberately flexible (free-text agent/carrier/product, a notes
-- field, a status enum) so we can reshape it to her real workflow over the
-- first couple weeks from her in-app feedback rather than guessing now.

-- Carrier deposits that hit the bank.
create table if not exists payroll_deposits (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null references reps(id) on delete cascade,
  carrier       text,
  amount        numeric default 0,
  deposited_on  date,
  matched       boolean default false,
  notes         text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists payroll_deposits_rep_idx on payroll_deposits (rep_id, deposited_on desc);

-- A sale and the commission owed on it; tracked from expected → matched → paid.
create table if not exists commission_entries (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  agent_name        text,
  client_name       text,
  carrier           text,
  product           text,
  premium           numeric default 0,   -- sale amount / annual premium
  commission_amount numeric default 0,   -- commission owed
  commission_rate   numeric,             -- optional %, if she works it that way
  status            text not null default 'expected'
    check (status in ('expected','matched','paid')),
  deposit_id        uuid references payroll_deposits(id) on delete set null,
  sale_date         date,
  paid_on           date,
  notes             text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);
create index if not exists commission_entries_rep_idx on commission_entries (rep_id, created_at desc);
create index if not exists commission_entries_agent_idx on commission_entries (rep_id, agent_name);
create index if not exists commission_entries_status_idx on commission_entries (rep_id, status);

-- Lauren's own description of how she actually runs the day — captured in-app so
-- it (and her per-section feedback) shapes the build over the first 2 weeks.
create table if not exists payroll_settings (
  rep_id         text primary key references reps(id) on delete cascade,
  workflow_notes text,
  updated_at     timestamptz default now()
);

-- Google Sheets she connects so the workstation can pull her data in. Multiple
-- per rep. Reuses the existing Google OAuth (spreadsheets scope) via lib/google.
create table if not exists payroll_sheets (
  id              uuid primary key default gen_random_uuid(),
  rep_id          text not null references reps(id) on delete cascade,
  spreadsheet_id  text not null,
  title           text,
  label           text,        -- her name for it ("Commissions paid", "Deposits log")
  default_tab     text,        -- which tab/sheet to read by default
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (rep_id, spreadsheet_id)
);
create index if not exists payroll_sheets_rep_idx on payroll_sheets (rep_id, created_at desc);
