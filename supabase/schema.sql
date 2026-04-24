-- ============================================================================
-- Virtual Closer - Supabase schema
-- Multi-tenant ready: every row is scoped by rep_id (tenant key).
-- Run this entire file in the Supabase SQL editor. Safe to re-run.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ── Tenants / Reps ────────────────────────────────────────────────────────
create table if not exists reps (
  id                text primary key,
  slug              text unique not null,
  display_name      text not null,
  company           text,
  email             text,
  claude_api_key    text,
  telegram_chat_id  text,
  hubspot_token     text,
  settings          jsonb default '{}'::jsonb,
  is_active         boolean default true,
  tier              text default 'salesperson' check (tier in ('salesperson','team_builder','executive')),
  monthly_fee       numeric default 50,
  build_fee         numeric default 1500,
  start_date        date,
  onboarding_steps  jsonb default '[]'::jsonb,
  build_notes       text,
  integrations      jsonb default '{}'::jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- Idempotent column adds (in case you already ran an older version)
alter table reps add column if not exists tier text default 'salesperson';
alter table reps add column if not exists monthly_fee numeric default 50;
alter table reps add column if not exists build_fee numeric default 1500;
alter table reps add column if not exists start_date date;
alter table reps add column if not exists onboarding_steps jsonb default '[]'::jsonb;
alter table reps add column if not exists build_notes text;
alter table reps add column if not exists integrations jsonb default '{}'::jsonb;
alter table reps add column if not exists password_hash text;
alter table reps add column if not exists last_login_at timestamptz;
alter table reps add column if not exists telegram_link_code text;

-- Backfill a link code for any existing tenant missing one.
update reps
   set telegram_link_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
 where telegram_link_code is null;

create unique index if not exists reps_telegram_link_code_idx on reps(telegram_link_code);
create index if not exists reps_telegram_chat_id_idx on reps(telegram_chat_id);

-- Migrate legacy slack_webhook column → telegram_chat_id (idempotent)
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_name = 'reps' and column_name = 'slack_webhook'
  ) and not exists (
    select 1 from information_schema.columns
     where table_name = 'reps' and column_name = 'telegram_chat_id'
  ) then
    alter table reps rename column slack_webhook to telegram_chat_id;
  end if;
end $$;
alter table reps add column if not exists telegram_chat_id text;

-- Migrate legacy tier values → new keys (idempotent)
alter table reps drop constraint if exists reps_tier_check;
update reps set tier = 'salesperson'  where tier = 'starter';
update reps set tier = 'team_builder' where tier = 'pro';
update reps set tier = 'executive'    where tier = 'space_station';
alter table reps alter column tier set default 'salesperson';
alter table reps add constraint reps_tier_check
  check (tier in ('salesperson','team_builder','executive'));

-- ── Leads ─────────────────────────────────────────────────────────────────
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null references reps(id) on delete cascade,
  name          text not null,
  email         text,
  company       text,
  status        text default 'cold' check (status in ('hot','warm','cold','dormant')),
  last_contact  timestamptz,
  notes         text,
  source        text,
  external_id   text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists leads_rep_id_idx          on leads(rep_id);
create index if not exists leads_rep_status_idx      on leads(rep_id, status);
create index if not exists leads_rep_updated_idx     on leads(rep_id, updated_at desc);
create index if not exists leads_rep_lastcontact_idx on leads(rep_id, last_contact);

-- ── Agent actions ─────────────────────────────────────────────────────────
create table if not exists agent_actions (
  id           uuid primary key default gen_random_uuid(),
  rep_id       text not null references reps(id) on delete cascade,
  lead_id      uuid references leads(id) on delete cascade,
  action_type  text not null check (action_type in ('email_draft','classification','alert','dormant_flag')),
  content      text,
  status       text default 'pending' check (status in ('pending','sent','dismissed')),
  created_at   timestamptz default now()
);

create index if not exists agent_actions_rep_status_idx  on agent_actions(rep_id, status);
create index if not exists agent_actions_rep_type_idx    on agent_actions(rep_id, action_type);
create index if not exists agent_actions_lead_idx        on agent_actions(lead_id);
create index if not exists agent_actions_rep_created_idx on agent_actions(rep_id, created_at desc);

-- ── Agent runs ────────────────────────────────────────────────────────────
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

-- ── Brain dumps + items ───────────────────────────────────────────────────
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
  item_type      text not null check (item_type in ('task','goal','idea','plan','note')),
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

-- ── Client activity log (admin notes, onboarding events, billing) ─────────
create table if not exists client_events (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references reps(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  created_at  timestamptz default now()
);

create index if not exists client_events_rep_created_idx on client_events(rep_id, created_at desc);

-- ── updated_at trigger ────────────────────────────────────────────────────
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

drop trigger if exists brain_items_set_updated_at on brain_items;
create trigger brain_items_set_updated_at
  before update on brain_items
  for each row execute function set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table reps           enable row level security;
alter table leads          enable row level security;
alter table agent_actions  enable row level security;
alter table agent_runs     enable row level security;
alter table brain_dumps    enable row level security;
alter table brain_items    enable row level security;
alter table client_events  enable row level security;

-- Service role bypasses RLS; no public policies by default.
