-- ============================================================================
-- Virtual Closer - Supabase schema
-- Multi-tenant ready: every row is scoped by rep_id (tenant key).
-- Run this entire file in the Supabase SQL editor on a fresh project.
-- ============================================================================

-- Extensions ------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- ============================================================================
-- Tenants / Reps
-- One row per whitelabel account (e.g. "acme", "jane-doe"). The slug is what
-- you use for the subdomain: <slug>.virtualcloser.com
-- ============================================================================
create table if not exists reps (
  id              text primary key,            -- matches env REP_ID for that deployment
  slug            text unique not null,        -- subdomain slug
  display_name    text not null,
  company         text,
  email           text,
  claude_api_key  text,                        -- optional per-tenant override
  slack_webhook   text,                        -- optional per-tenant override
  hubspot_token   text,                        -- optional per-tenant override
  settings        jsonb default '{}'::jsonb,
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- ============================================================================
-- Leads
-- ============================================================================
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null references reps(id) on delete cascade,
  name          text not null,
  email         text,
  company       text,
  status        text default 'cold' check (status in ('hot','warm','cold','dormant')),
  last_contact  timestamptz,
  notes         text,
  source        text,                          -- hubspot | manual | import
  external_id  text,                           -- CRM record ID
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists leads_rep_id_idx         on leads(rep_id);
create index if not exists leads_rep_status_idx     on leads(rep_id, status);
create index if not exists leads_rep_updated_idx    on leads(rep_id, updated_at desc);
create index if not exists leads_rep_lastcontact_idx on leads(rep_id, last_contact);

-- ============================================================================
-- Agent actions (email drafts, classifications, alerts, dormant flags)
-- ============================================================================
create table if not exists agent_actions (
  id           uuid primary key default gen_random_uuid(),
  rep_id       text not null references reps(id) on delete cascade,
  lead_id      uuid references leads(id) on delete cascade,
  action_type  text not null check (action_type in ('email_draft','classification','alert','dormant_flag')),
  content      text,
  status       text default 'pending' check (status in ('pending','sent','dismissed')),
  created_at   timestamptz default now()
);

create index if not exists agent_actions_rep_status_idx on agent_actions(rep_id, status);
create index if not exists agent_actions_rep_type_idx   on agent_actions(rep_id, action_type);
create index if not exists agent_actions_lead_idx       on agent_actions(lead_id);
create index if not exists agent_actions_rep_created_idx on agent_actions(rep_id, created_at desc);

-- ============================================================================
-- Agent runs (cron execution log)
-- ============================================================================
create table if not exists agent_runs (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  run_type          text not null check (run_type in ('morning_scan','dormant_check','hot_pulse')),
  leads_processed   int default 0,
  actions_created   int default 0,
  status            text default 'success' check (status in ('success','error')),
  error             text,
  created_at        timestamptz default now()
);

create index if not exists agent_runs_rep_created_idx on agent_runs(rep_id, created_at desc);

-- ============================================================================
-- Brain dumps (raw mic transcripts) + extracted structured items
-- ============================================================================
create table if not exists brain_dumps (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references reps(id) on delete cascade,
  raw_text    text not null,
  summary     text,
  source      text default 'mic' check (source in ('mic','manual','import')),
  created_at  timestamptz default now()
);

create index if not exists brain_dumps_rep_created_idx on brain_dumps(rep_id, created_at desc);

create table if not exists brain_items (
  id             uuid primary key default gen_random_uuid(),
  rep_id         text not null references reps(id) on delete cascade,
  brain_dump_id  uuid references brain_dumps(id) on delete set null,
  item_type      text not null check (item_type i

drop trigger if exists brain_items_set_updated_at on brain_items;
create trigger brain_items_set_updated_at
  before update on brain_items
  for each row execute function set_updated_at();n ('task','goal','idea','plan','note')),
  content        text not null,
  priority       text default 'normal' check (priority in ('low','normal','high')),
  horizon        text check (horizon in ('day','week','month','quarter','year','none')),
  due_date       date,
  status         text default 'open' check (status in ('open','done','dismissed')),
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists brain_items_rep_status_idx   on brain_items(rep_id, status);
create index if not exists brain_items_rep_type_idx     on brain_items(rep_id, item_type);
create index if not exists brain_items_rep_horizon_idx  on brain_items(rep_id, horizon);
create index if not exists brain_items_rep_created_idx  on brain_items(rep_id, created_at desc);

alter table brain_dumps enable row level security;
alter table brain_items enable row level security;

-- ============================================================================
-- updated_at trigger
-- ============================================================================
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists reps_set_updated_at on reps;
create trigger reps_set_updated_at
  before update on reps
  for each row execute function set_updated_at();

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
  before update on leads
  for each row execute function set_updated_at();

-- ============================================================================
-- Row Level Security
-- The server-side code uses the service_role key and bypasses RLS, but we
-- still enable RLS + deny-by-default policies so nothing leaks if you ever
-- expose the anon key in the browser.
-- ============================================================================
alter table reps           enable row level security;
alter table leads          enable row level security;
alter table agent_actions  enable row level security;
alter table agent_runs     enable row level security;

-- No anon/authenticated policies by default. Service role bypasses RLS.
-- Add per-tenant JWT policies later if you introduce end-user login.

-- ============================================================================
-- Seed a first tenant (edit the slug + name before running, or skip this)
-- ============================================================================
-- insert into reps (id, slug, display_name, email)
-- values ('rep_001', 'demo', 'Demo Rep', 'demo@example.com')
-- on conflict (id) do nothing;
