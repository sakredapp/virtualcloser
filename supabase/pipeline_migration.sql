-- ============================================================================
-- Pipeline (Kanban) feature migration
-- Apply this to your Supabase project via the SQL editor or CLI.
-- Adds:
--   • pipelines       — named kanban boards (one or more per tenant)
--   • pipeline_stages — user-configurable columns inside a pipeline
--   • leads.pipeline_id / leads.pipeline_stage_id — nullable FKs
-- ============================================================================

-- Helper trigger function (safe to re-create)
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── pipelines ──────────────────────────────────────────────────────────────

create table if not exists pipelines (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references reps(id) on delete cascade,
  name        text not null default 'My Pipeline',
  -- Optional CRM mirror. When set, this pipeline reflects a CRM pipeline.
  -- crm_source: 'ghl' | 'hubspot' | null
  -- crm_pipeline_id: the CRM's native pipeline ID (GHL pipelineId, HubSpot pipelineId)
  -- crm_last_synced_at: when we last pulled from the CRM
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

-- ── pipeline_stages ────────────────────────────────────────────────────────

create table if not exists pipeline_stages (
  id           uuid primary key default gen_random_uuid(),
  pipeline_id  uuid not null references pipelines(id) on delete cascade,
  rep_id       text not null references reps(id) on delete cascade,
  name         text not null,
  position     int  not null default 0,
  color        text not null default '#94a3b8',
  -- Maps this stage to the CRM's stage ID so moves push back automatically
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

-- ── leads: add nullable FKs ────────────────────────────────────────────────

alter table leads
  add column if not exists pipeline_id       uuid references pipelines(id) on delete set null,
  add column if not exists pipeline_stage_id uuid references pipeline_stages(id) on delete set null,
  -- crm_source mirrors pipelines.crm_source for fast lookups without joins
  add column if not exists crm_source        text,
  -- crm_object_id: the CRM's deal/opportunity/contact ID for this lead
  -- (same concept as leads.external_id but explicit — external_id may already
  --  be in use by other integrations so we keep them separate)
  add column if not exists crm_object_id     text;

create index if not exists leads_pipeline_stage_idx
  on leads(rep_id, pipeline_id, pipeline_stage_id);

create index if not exists leads_crm_object_idx
  on leads(rep_id, crm_source, crm_object_id) where crm_object_id is not null;
