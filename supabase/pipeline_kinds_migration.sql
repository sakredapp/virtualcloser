-- ============================================================================
-- Pipeline kinds + generic items
-- Self-bootstrapping: if pipeline_migration.sql hasn't been applied, this
-- creates the base pipelines + pipeline_stages tables too. Safe to re-run.
--
-- WHY: The original pipelines feature was sales-only (cards = leads). Reps
-- asked us to support recruiting boards, team boards, project boards, and
-- arbitrary custom kanbans. We do that without forcing leads to absorb non-
-- sales data:
--
--   • pipelines.kind        — what kind of board this is
--   • pipelines.description — optional one-liner shown in dashboard
--   • pipelines.owner_member_id — who owns this board (null = account-shared)
--
-- For kind='sales' the cards keep coming from `leads` (legacy + CRM mirror).
-- For every other kind, cards come from the new generic `pipeline_items`
-- table — so a manager's recruiting pipeline never pollutes the sales CRM.
-- ============================================================================

-- Helper trigger function (safe to re-create) — used by every table below.
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── base pipelines table (idempotent — created by pipeline_migration.sql) ──
create table if not exists pipelines (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references reps(id) on delete cascade,
  name        text not null default 'My Pipeline',
  crm_source          text,
  crm_pipeline_id     text,
  crm_last_synced_at  timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists pipelines_rep_idx
  on pipelines(rep_id, created_at desc);

drop trigger if exists pipelines_set_updated_at on pipelines;
create trigger pipelines_set_updated_at
  before update on pipelines
  for each row execute function set_updated_at();

alter table pipelines enable row level security;

-- ── base pipeline_stages table (idempotent) ───────────────────────────────
create table if not exists pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references pipelines(id) on delete cascade,
  rep_id       text not null references reps(id) on delete cascade,
  name         text not null,
  position     int  not null default 0,
  color        text not null default '#94a3b8',
  crm_stage_id text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create index if not exists pipeline_stages_pipeline_idx
  on pipeline_stages(pipeline_id, position);
create index if not exists pipeline_stages_rep_idx
  on pipeline_stages(rep_id);

drop trigger if exists pipeline_stages_set_updated_at on pipeline_stages;
create trigger pipeline_stages_set_updated_at
  before update on pipeline_stages
  for each row execute function set_updated_at();

alter table pipeline_stages enable row level security;

-- ── leads: nullable FKs (idempotent) ──────────────────────────────────────
alter table leads
  add column if not exists pipeline_id       uuid references pipelines(id) on delete set null,
  add column if not exists pipeline_stage_id uuid references pipeline_stages(id) on delete set null,
  add column if not exists crm_source        text,
  add column if not exists crm_object_id     text;

create index if not exists leads_pipeline_stage_idx
  on leads(rep_id, pipeline_id, pipeline_stage_id);
create index if not exists leads_crm_object_idx
  on leads(rep_id, crm_source, crm_object_id) where crm_object_id is not null;

-- ── pipeline kinds + ownership ────────────────────────────────────────────

alter table pipelines add column if not exists kind text not null default 'sales';
alter table pipelines drop constraint if exists pipelines_kind_check;
alter table pipelines add constraint pipelines_kind_check
  check (kind in ('sales','recruiting','team','project','custom'));

alter table pipelines add column if not exists description text;
alter table pipelines add column if not exists owner_member_id uuid references members(id) on delete set null;

create index if not exists pipelines_rep_kind_idx on pipelines(rep_id, kind, created_at desc);
create index if not exists pipelines_owner_idx
  on pipelines(rep_id, owner_member_id) where owner_member_id is not null;

-- Generic kanban cards. Used for every pipeline kind EXCEPT 'sales' (which
-- still reads from `leads`). Title is required; everything else is optional.
-- `metadata` is a free-form jsonb for kind-specific fields (e.g. recruiting
-- might stamp `current_role`, team might stamp `start_date`, etc.).
create table if not exists pipeline_items (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  pipeline_id       uuid not null references pipelines(id) on delete cascade,
  pipeline_stage_id uuid references pipeline_stages(id) on delete set null,
  owner_member_id   uuid references members(id) on delete set null,
  title             text not null,
  subtitle          text,
  notes             text,
  value             numeric,
  value_currency    text default 'USD',
  status            text default 'open' check (status in ('open','active','blocked','done','archived')),
  metadata          jsonb default '{}'::jsonb,
  position          int default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists pipeline_items_rep_idx on pipeline_items(rep_id, pipeline_id);
create index if not exists pipeline_items_stage_idx on pipeline_items(pipeline_stage_id);
create index if not exists pipeline_items_owner_idx on pipeline_items(owner_member_id) where owner_member_id is not null;
create index if not exists pipeline_items_updated_idx on pipeline_items(rep_id, pipeline_id, updated_at desc);

drop trigger if exists pipeline_items_set_updated_at on pipeline_items;
create trigger pipeline_items_set_updated_at
  before update on pipeline_items
  for each row execute function set_updated_at();

alter table pipeline_items enable row level security;
