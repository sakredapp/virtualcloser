-- Comp grids + upload log — Suite CXO Sales Plan (owner 10-09).
--
-- cxo_comp_rates: one row per product × carrier. agency_rate is the agency's
-- contract level from the carrier (percent of premium, 110 = 110%).
-- agent_levels is the agent payout ladder [{level, rate}]; payout_rate is the
-- level the profit math uses (the highest agent level unless the upload said
-- otherwise). Spread = agency_rate − payout_rate. Rows only ever come from an
-- upload the executive reviewed and saved; there is no hand-entry UI.
--
-- cxo_plan_uploads: what was uploaded, when, by whom, what it held and what
-- reading it cost (Claude is used for messy layouts and PDFs only).
--
-- Scoped by rep_id. RLS on with no policies; service_role only (same as
-- cxo_plan_employees.sql). Idempotent. Project ndschjbuyjmxtzqyjgyi.

create table if not exists cxo_plan_uploads (
  id           uuid primary key default gen_random_uuid(),
  rep_id       text not null,
  kind         text not null check (kind in ('plan', 'comp')),
  year         int,
  filename     text not null default '',
  source       text not null default 'file' check (source in ('xlsx', 'xls', 'csv', 'pdf', 'sheet', 'file')),
  rows_saved   int not null default 0,
  carriers     int not null default 0,
  products     int not null default 0,
  read_by      text not null default 'rules' check (read_by in ('rules', 'claude')),
  ai_cost_usd  numeric,
  member_id    uuid,
  member_name  text,
  created_at   timestamptz not null default now()
);
create index if not exists cxo_plan_uploads_rep_idx on cxo_plan_uploads (rep_id, kind, created_at desc);

create table if not exists cxo_comp_rates (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null,
  product       text not null default '',
  carrier       text not null default '',
  agency_rate   numeric not null check (agency_rate >= 0 and agency_rate <= 1000),
  payout_rate   numeric check (payout_rate >= 0 and payout_rate <= 1000),
  payout_level  text,
  agent_levels  jsonb not null default '[]'::jsonb,
  upload_id     uuid references cxo_plan_uploads(id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (rep_id, product, carrier)
);
create index if not exists cxo_comp_rates_rep_idx on cxo_comp_rates (rep_id, carrier);

alter table cxo_plan_uploads enable row level security;
alter table cxo_comp_rates   enable row level security;

revoke all on cxo_plan_uploads, cxo_comp_rates from anon, authenticated;
grant select, insert, update, delete on cxo_plan_uploads, cxo_comp_rates to service_role;

notify pgrst, 'reload schema';
