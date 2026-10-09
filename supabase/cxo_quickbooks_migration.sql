-- QuickBooks Online — Suite CXO (Pinnacle exec team, owner-approved 10-09).
--
-- READ-ONLY connection: the app only reads reports from QuickBooks and never
-- writes to the books. One connection per org (rep_id). Tokens are stored
-- AES-256-GCM encrypted by the app (lib/qbo/shared.ts); never in plain text.
--
--   cxo_qbo_connections        the org's QuickBooks company + encrypted tokens
--   cxo_qbo_pnl_monthly        Profit and Loss by month (revenue, costs, net)
--   cxo_qbo_expense_monthly    expenses by category (top-level account) by month
--   cxo_qbo_revenue_breakdown  revenue by customer and by class, by month
--
-- Every table is scoped by rep_id. RLS on with no policies and grants to
-- service_role only, like every other cxo_* table: the app reads and writes
-- server-side; anon and authenticated get nothing. Idempotent.
-- Project ndschjbuyjmxtzqyjgyi.

create table if not exists cxo_qbo_connections (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null unique,
  realm_id              text not null,
  company_name          text,
  environment           text not null default 'production' check (environment in ('sandbox', 'production')),
  access_token_enc      text not null,
  refresh_token_enc     text not null,
  access_expires_at     timestamptz not null,
  refresh_expires_at    timestamptz,
  connected_by_member   uuid,
  connected_by_name     text,
  needs_reconnect       boolean not null default false,
  last_sync_at          timestamptz,
  last_sync_ok          boolean,
  last_sync_error       text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists cxo_qbo_pnl_monthly (
  id             uuid primary key default gen_random_uuid(),
  rep_id         text not null,
  month          text not null check (month ~ '^\d{4}-\d{2}$'),  -- 'YYYY-MM'
  income         numeric not null default 0,
  cogs           numeric not null default 0,
  gross_profit   numeric not null default 0,
  expenses       numeric not null default 0,
  other_income   numeric not null default 0,
  other_expenses numeric not null default 0,
  net_income     numeric not null default 0,
  synced_at      timestamptz not null default now(),
  unique (rep_id, month)
);

create table if not exists cxo_qbo_expense_monthly (
  id        uuid primary key default gen_random_uuid(),
  rep_id    text not null,
  month     text not null check (month ~ '^\d{4}-\d{2}$'),
  category  text not null,
  amount    numeric not null default 0,
  synced_at timestamptz not null default now(),
  unique (rep_id, month, category)
);
create index if not exists cxo_qbo_expense_monthly_rep_idx on cxo_qbo_expense_monthly (rep_id, month);

create table if not exists cxo_qbo_revenue_breakdown (
  id        uuid primary key default gen_random_uuid(),
  rep_id    text not null,
  month     text not null check (month ~ '^\d{4}-\d{2}$'),
  dimension text not null check (dimension in ('customer', 'class')),
  name      text not null,
  amount    numeric not null default 0,
  synced_at timestamptz not null default now(),
  unique (rep_id, month, dimension, name)
);
create index if not exists cxo_qbo_revenue_breakdown_rep_idx on cxo_qbo_revenue_breakdown (rep_id, dimension, month);

-- ── Access: service_role only ─────────────────────────────────────────────
alter table cxo_qbo_connections       enable row level security;
alter table cxo_qbo_pnl_monthly       enable row level security;
alter table cxo_qbo_expense_monthly   enable row level security;
alter table cxo_qbo_revenue_breakdown enable row level security;

revoke all on cxo_qbo_connections, cxo_qbo_pnl_monthly, cxo_qbo_expense_monthly, cxo_qbo_revenue_breakdown from anon, authenticated;
grant select, insert, update, delete on cxo_qbo_connections, cxo_qbo_pnl_monthly, cxo_qbo_expense_monthly, cxo_qbo_revenue_breakdown to service_role;

notify pgrst, 'reload schema';
