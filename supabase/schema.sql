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
  build_fee         numeric default 2000,
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
alter table reps add column if not exists build_fee numeric default 2000;
alter table reps add column if not exists start_date date;
alter table reps add column if not exists onboarding_steps jsonb default '[]'::jsonb;
alter table reps add column if not exists build_notes text;
alter table reps add column if not exists integrations jsonb default '{}'::jsonb;
alter table reps add column if not exists password_hash text;
alter table reps add column if not exists last_login_at timestamptz;
alter table reps add column if not exists telegram_link_code text;
alter table reps add column if not exists stripe_customer_id text;
alter table reps add column if not exists payment_date date;
alter table reps add column if not exists timezone text default 'UTC';

-- Optional per-client branding (logo + colors). All optional; UI falls back to
-- standard Virtual Closer red when these are null. Useful for enterprise.
alter table reps add column if not exists logo_url text;
alter table reps add column if not exists brand_primary text;   -- hex e.g. '#0a66c2'
alter table reps add column if not exists brand_ink text;       -- hex e.g. '#0f0f0f'

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
  run_type          text not null check (run_type in ('morning_scan','dormant_check','hot_pulse','midday_pulse')),
  leads_processed   int default 0,
  actions_created   int default 0,
  status            text default 'success' check (status in ('success','error')),
  error             text,
  created_at        timestamptz default now()
);

-- Note: run_type check constraint is widened (and orphan rows scrubbed) further
-- down in the file — see the "Widen agent_runs.run_type to include coach pulses"
-- block. We don't re-add a narrower version here because doing so would fail
-- on rows that already use 'midday_pulse' or 'coach'.

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

-- ── Prospects (platform-level leads from Cal.com bookings, etc.) ──────────
create table if not exists prospects (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'cal.com',
  external_id   text,
  name          text,
  email         text,
  company       text,
  phone         text,
  tier_interest text,
  notes         text,
  booking_url   text,
  meeting_at    timestamptz,
  timezone      text,
  status        text default 'new' check (status in ('new','contacted','booked','won','lost','canceled')),
  payload       jsonb default '{}'::jsonb,
  rep_id        text references reps(id) on delete set null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create unique index if not exists prospects_source_external_idx
  on prospects(source, external_id) where external_id is not null;
-- Postgres can't infer a *partial* unique index for ON CONFLICT (which is what
-- upsertProspect uses with onConflict: 'source,external_id'). Add a real
-- (non-partial) unique constraint on the same pair so the upsert works.
-- Idempotent: only adds the constraint if it isn't already there.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'prospects'::regclass
       and conname  = 'prospects_source_external_uniq'
  ) then
    alter table prospects
      add constraint prospects_source_external_uniq
      unique (source, external_id);
  end if;
end $$;
create index if not exists prospects_created_idx on prospects(created_at desc);
create index if not exists prospects_status_idx  on prospects(status, created_at desc);
create index if not exists prospects_email_idx   on prospects(lower(email));

-- ── Google OAuth tokens (one row per rep) ────────────────────────────────
create table if not exists google_tokens (
  rep_id         text primary key references reps(id) on delete cascade,
  access_token   text not null,
  refresh_token  text,
  expires_at     timestamptz not null,
  email          text,
  scope          text,
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

create index if not exists google_tokens_email_idx on google_tokens(lower(email));

-- ── Teams (Executive tier team rollups) ──────────────────────────────────
create table if not exists teams (
  id         uuid primary key default gen_random_uuid(),
  rep_id     text not null references reps(id) on delete cascade,
  name       text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists teams_rep_id_idx on teams(rep_id);

create table if not exists team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references teams(id) on delete cascade,
  rep_id     text not null references reps(id) on delete cascade,
  name       text not null,
  email      text,
  role       text check (role in ('manager','rep','fulfillment_partner','observer')) default 'rep',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists team_members_team_idx on team_members(team_id);
create index if not exists team_members_rep_idx on team_members(rep_id);

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

drop trigger if exists prospects_set_updated_at on prospects;
create trigger prospects_set_updated_at
  before update on prospects
  for each row execute function set_updated_at();

drop trigger if exists google_tokens_set_updated_at on google_tokens;
create trigger google_tokens_set_updated_at
  before update on google_tokens
  for each row execute function set_updated_at();

drop trigger if exists teams_set_updated_at on teams;
create trigger teams_set_updated_at
  before update on teams
  for each row execute function set_updated_at();

drop trigger if exists team_members_set_updated_at on team_members;
create trigger team_members_set_updated_at
  before update on team_members
  for each row execute function set_updated_at();

-- ── Call logs (conversations attached to leads) ──────────────────────────
create table if not exists call_logs (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  lead_id           uuid references leads(id) on delete set null,
  contact_name      text not null,
  summary           text not null,
  outcome           text check (outcome in ('positive','neutral','negative','no_answer','voicemail','booked','closed_won','closed_lost')),
  next_step         text,
  duration_minutes  int,
  occurred_at       timestamptz default now(),
  created_at        timestamptz default now()
);

create index if not exists call_logs_rep_idx       on call_logs(rep_id, occurred_at desc);
create index if not exists call_logs_lead_idx      on call_logs(lead_id);
create index if not exists call_logs_rep_outcome_idx on call_logs(rep_id, outcome);

-- Per-deal commission capture. When a rep logs a closed_won, the bot asks
-- "what's your expected commission on this deal?" and stores the number
-- here. Used by the commission napkin-math intent to project earnings.
alter table call_logs add column if not exists commission_amount   numeric;
alter table call_logs add column if not exists commission_currency text default 'USD';
create index if not exists call_logs_commission_idx
  on call_logs(rep_id, occurred_at desc) where commission_amount is not null;

-- ── Targets (measurable goals with progress) ─────────────────────────────
create table if not exists targets (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null references reps(id) on delete cascade,
  period_type   text not null check (period_type in ('day','week','month','quarter','year')),
  period_start  date not null,
  metric        text not null,            -- 'calls','conversations','meetings_booked','deals_closed','revenue','custom'
  target_value  numeric not null,
  current_value numeric default 0,
  notes         text,
  status        text default 'active' check (status in ('active','hit','missed','archived')),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index if not exists targets_rep_period_idx on targets(rep_id, period_type, period_start desc);
create index if not exists targets_rep_status_idx on targets(rep_id, status);

-- Target visibility: who actually sees this goal in their daily brief.
-- 'all' (default) — everyone in scope. 'managers' — managers/admins/owners only.
-- 'owners' — admins/owners only. Useful for revenue / forecast-style goals
-- leadership wants tracked but not surfaced to ICs.
alter table targets add column if not exists visibility text not null default 'all'
  check (visibility in ('all','managers','owners'));
create index if not exists targets_rep_visibility_idx on targets(rep_id, visibility);

drop trigger if exists targets_set_updated_at on targets;
create trigger targets_set_updated_at
  before update on targets
  for each row execute function set_updated_at();

-- Widen agent_runs.run_type to include coach pulses (idempotent).
-- Scrub any legacy rows whose run_type is no longer in the allowlist before
-- re-adding the constraint (otherwise older deployments fail with
-- 23514 "check constraint violated by some row"). agent_runs is an
-- observability log, so dropping orphan rows is safe.
delete from agent_runs
 where run_type is null
    or run_type not in ('morning_scan','dormant_check','hot_pulse','midday_pulse','coach');
alter table agent_runs drop constraint if exists agent_runs_run_type_check;
alter table agent_runs add constraint agent_runs_run_type_check
  check (run_type in ('morning_scan','dormant_check','hot_pulse','midday_pulse','coach'));

-- ============================================================================
-- Enterprise: members, teams, owner_member_id, audit log
-- Additive + idempotent. Existing single-user accounts auto-migrate via
-- ensure_owner_member() (creates one 'owner' member per rep, copying email
-- and password_hash so existing logins keep working).
-- ============================================================================

-- ── Members (humans inside an account) ───────────────────────────────────
create table if not exists members (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  email               text not null,
  display_name        text not null,
  role                text not null default 'rep'
                        check (role in ('owner','admin','manager','rep','observer')),
  password_hash       text,
  is_active           boolean default true,
  telegram_chat_id    text,
  telegram_link_code  text,
  timezone            text,
  last_login_at       timestamptz,
  invited_by          uuid references members(id) on delete set null,
  invited_at          timestamptz,
  accepted_at         timestamptz,
  settings            jsonb default '{}'::jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create unique index if not exists members_rep_email_idx on members(rep_id, lower(email));
create unique index if not exists members_telegram_link_code_idx on members(telegram_link_code) where telegram_link_code is not null;
create index if not exists members_rep_role_idx on members(rep_id, role);
create index if not exists members_telegram_chat_idx on members(telegram_chat_id) where telegram_chat_id is not null;

-- Per-rep slug (for /u/<slug> URLs inside the company subdomain).
alter table members add column if not exists slug text;
create unique index if not exists members_rep_slug_idx on members(rep_id, slug) where slug is not null;

-- Backfill slugs from email local-part (or display_name) for existing members.
-- Generates lowercased a-z0-9- only; collisions get a numeric suffix.
do $$
declare
  m record;
  base text;
  candidate text;
  n int;
begin
  for m in select id, rep_id, email, display_name from members where slug is null loop
    base := lower(coalesce(nullif(split_part(m.email, '@', 1), ''), m.display_name, 'member'));
    base := regexp_replace(base, '[^a-z0-9]+', '-', 'g');
    base := regexp_replace(base, '(^-+|-+$)', '', 'g');
    if base = '' then base := 'member'; end if;
    candidate := base;
    n := 1;
    while exists (select 1 from members where rep_id = m.rep_id and slug = candidate) loop
      n := n + 1;
      candidate := base || '-' || n::text;
    end loop;
    update members set slug = candidate where id = m.id;
  end loop;
end $$;

drop trigger if exists members_set_updated_at on members;
create trigger members_set_updated_at
  before update on members
  for each row execute function set_updated_at();

-- Backfill: every rep gets exactly one 'owner' member if they don't have one.
-- Copies the rep's email, password_hash, telegram link/chat so existing logins keep working.
insert into members (rep_id, email, display_name, role, password_hash, telegram_chat_id, telegram_link_code, timezone, accepted_at)
select r.id,
       coalesce(r.email, r.id || '@placeholder.local'),
       r.display_name,
       'owner',
       r.password_hash,
       r.telegram_chat_id,
       r.telegram_link_code,
       r.timezone,
       coalesce(r.created_at, now())
  from reps r
 where not exists (select 1 from members m where m.rep_id = r.id and m.role = 'owner');

-- Every member must have their own Telegram link code so each one connects
-- their own Telegram chat to their own dashboard. Backfill any null ones.
update members
   set telegram_link_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
 where telegram_link_code is null;

-- ── Teams: add manager pointer + member_id link on team_members ──────────
alter table teams add column if not exists manager_member_id uuid references members(id) on delete set null;
alter table team_members add column if not exists member_id uuid references members(id) on delete cascade;
create unique index if not exists team_members_team_member_idx on team_members(team_id, member_id) where member_id is not null;
create index if not exists team_members_member_idx on team_members(member_id);

-- Backfill team_members.member_id from the owner member (legacy rows where
-- only rep_id was set get attached to the account owner).
update team_members tm
   set member_id = m.id
  from members m
 where tm.member_id is null
   and m.rep_id = tm.rep_id
   and m.role = 'owner';

-- ── Stamp owner_member_id + team_id on data tables (additive, nullable) ──
alter table leads         add column if not exists owner_member_id uuid references members(id) on delete set null;
alter table leads         add column if not exists team_id uuid references teams(id) on delete set null;
alter table brain_dumps   add column if not exists owner_member_id uuid references members(id) on delete set null;
alter table brain_items   add column if not exists owner_member_id uuid references members(id) on delete set null;
alter table call_logs     add column if not exists owner_member_id uuid references members(id) on delete set null;
alter table call_logs     add column if not exists team_id uuid references teams(id) on delete set null;
alter table agent_actions add column if not exists owner_member_id uuid references members(id) on delete set null;
alter table targets       add column if not exists owner_member_id uuid references members(id) on delete set null;
alter table targets       add column if not exists team_id uuid references teams(id) on delete set null;
alter table targets       add column if not exists scope text not null default 'personal'
                              check (scope in ('personal','team','account'));

-- Backfill owner_member_id on existing rows to the owner member.
update leads l set owner_member_id = m.id
  from members m where l.owner_member_id is null and m.rep_id = l.rep_id and m.role = 'owner';
update brain_dumps b set owner_member_id = m.id
  from members m where b.owner_member_id is null and m.rep_id = b.rep_id and m.role = 'owner';
update brain_items b set owner_member_id = m.id
  from members m where b.owner_member_id is null and m.rep_id = b.rep_id and m.role = 'owner';
update call_logs c set owner_member_id = m.id
  from members m where c.owner_member_id is null and m.rep_id = c.rep_id and m.role = 'owner';
update agent_actions a set owner_member_id = m.id
  from members m where a.owner_member_id is null and m.rep_id = a.rep_id and m.role = 'owner';
update targets t set owner_member_id = m.id
  from members m where t.owner_member_id is null and t.scope = 'personal' and m.rep_id = t.rep_id and m.role = 'owner';

create index if not exists leads_owner_member_idx       on leads(rep_id, owner_member_id, status);
create index if not exists leads_team_idx               on leads(rep_id, team_id) where team_id is not null;
create index if not exists call_logs_owner_member_idx   on call_logs(rep_id, owner_member_id, occurred_at desc);
create index if not exists call_logs_team_idx           on call_logs(rep_id, team_id, occurred_at desc) where team_id is not null;
create index if not exists targets_owner_member_idx     on targets(rep_id, owner_member_id, period_start desc) where owner_member_id is not null;
create index if not exists targets_team_idx             on targets(rep_id, team_id, period_start desc) where team_id is not null;
create index if not exists agent_actions_owner_idx      on agent_actions(rep_id, owner_member_id);
create index if not exists brain_items_owner_idx        on brain_items(rep_id, owner_member_id);

-- ── Audit log ────────────────────────────────────────────────────────────
create table if not exists audit_events (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references reps(id) on delete cascade,
  member_id   uuid references members(id) on delete set null,
  action      text not null,        -- 'lead.update', 'member.invite', 'target.set', etc.
  entity_type text,
  entity_id   text,
  diff        jsonb,
  ip          text,
  user_agent  text,
  created_at  timestamptz default now()
);

create index if not exists audit_rep_created_idx on audit_events(rep_id, created_at desc);
create index if not exists audit_rep_member_idx on audit_events(rep_id, member_id, created_at desc);
create index if not exists audit_rep_action_idx on audit_events(rep_id, action, created_at desc);

alter table members      enable row level security;
alter table audit_events enable row level security;

-- ============================================================================
-- Voice memos (enterprise feedback nucleus)
-- Reps record a pitch on Telegram → bot stores the OGG in Supabase Storage
-- and creates a voice_memos row. Managers reply (voice or text) → stored as
-- a child memo (kind='feedback') and relayed back to the rep. Same data
-- powers the /dashboard/feedback queue + archive + search.
--
-- Storage bucket: create a *private* bucket named `voice-memos` in the
-- Supabase dashboard (Storage → New bucket → name: voice-memos, public: off).
-- The app uses signed URLs for in-dashboard playback.
-- ============================================================================

create table if not exists voice_memos (
  id                      uuid primary key default gen_random_uuid(),
  rep_id                  text not null references reps(id) on delete cascade,
  sender_member_id        uuid not null references members(id) on delete cascade,
  recipient_member_id     uuid references members(id) on delete set null,
  team_id                 uuid references teams(id) on delete set null,
  lead_id                 uuid references leads(id) on delete set null,
  parent_memo_id          uuid references voice_memos(id) on delete set null,
  kind                    text not null check (kind in ('pitch','feedback','note','coaching')),
  status                  text not null default 'pending'
                            check (status in ('pending','in_review','ready','needs_work','archived')),
  telegram_file_id        text,
  storage_path            text,
  duration_seconds        int,
  transcript              text,
  tg_relay_chat_id        text,
  tg_relay_message_id     bigint,
  reviewed_by_member_id   uuid references members(id) on delete set null,
  reviewed_at             timestamptz,
  notes                   text,
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

create index if not exists voice_memos_rep_status_idx     on voice_memos(rep_id, status, created_at desc);
create index if not exists voice_memos_recipient_idx     on voice_memos(recipient_member_id, status);
create index if not exists voice_memos_sender_idx        on voice_memos(sender_member_id, created_at desc);
create index if not exists voice_memos_relay_idx         on voice_memos(tg_relay_chat_id, tg_relay_message_id);
create index if not exists voice_memos_parent_idx        on voice_memos(parent_memo_id);
create index if not exists voice_memos_lead_idx          on voice_memos(lead_id) where lead_id is not null;

drop trigger if exists voice_memos_set_updated_at on voice_memos;
create trigger voice_memos_set_updated_at
  before update on voice_memos
  for each row execute function set_updated_at();

-- Idempotent: widen voice_memos.kind to include 'coaching' (objection-coach
-- requests routed from rep → manager).
alter table voice_memos drop constraint if exists voice_memos_kind_check;
alter table voice_memos add constraint voice_memos_kind_check
  check (kind in ('pitch','feedback','note','coaching'));

alter table voice_memos enable row level security;

-- Drop the legacy "ready to pitch" lead flag if a previous schema run added it.
-- We replaced this with the per-memo coaching loop; leadership doesn't gate
-- leads at the lead-level toggle, that was a made-up feature.
drop index if exists leads_pitch_ready_idx;
alter table leads drop column if exists pitch_ready;
alter table leads drop column if exists pitch_ready_at;
alter table leads drop column if exists pitch_ready_set_by;

-- Quick deal-value tracking + snooze. Lets reps say "Dana is a $12k MRR
-- opp" or "hide Ben for 2 weeks" over Telegram. Snoozed leads are still
-- in the CRM but skipped by triage / dormant checks until the timestamp
-- passes.
alter table leads add column if not exists deal_value     numeric;
alter table leads add column if not exists deal_currency  text default 'USD';
alter table leads add column if not exists snoozed_until  timestamptz;
create index if not exists leads_snoozed_idx on leads(rep_id, snoozed_until) where snoozed_until is not null;
create index if not exists leads_deal_value_idx on leads(rep_id, deal_value desc) where deal_value is not null;

-- ============================================================================
-- Roleplay suite (coming soon)
-- Managers seed product context + objection banks (text or transcribed voice
-- memos). Reps practice live with an AI voice that role-plays the prospect.
-- Every session is recorded turn-by-turn so leadership can review at scale.
-- Voice provider (TTS/STT) is left abstracted in app code so we can swap
-- ElevenLabs / Cartesia / OpenAI realtime once chosen.
-- ============================================================================

-- A scenario = "what we're practicing today" (product brief + persona +
-- objection bank). Built by a manager/owner, run by reps.
create table if not exists roleplay_scenarios (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  created_by_member_id  uuid references members(id) on delete set null,
  name                  text not null,
  product_brief         text,                 -- what the rep is selling, in plain English
  persona               text,                 -- who the AI is playing ("skeptical CFO", "trial user about to churn")
  difficulty            text default 'standard'
                          check (difficulty in ('easy','standard','hard','brutal')),
  objection_bank        jsonb default '[]'::jsonb,  -- [{text, source_voice_memo_id?, weight?}]
  source_voice_memo_ids uuid[],               -- transcribed leader memos that seeded the bank
  voice_provider        text,                 -- 'elevenlabs','cartesia','openai_realtime', null until chosen
  voice_id              text,                 -- provider-specific voice handle
  is_active             boolean default true,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists roleplay_scenarios_rep_idx       on roleplay_scenarios(rep_id, is_active, updated_at desc);
create index if not exists roleplay_scenarios_created_by_idx on roleplay_scenarios(created_by_member_id);

drop trigger if exists roleplay_scenarios_set_updated_at on roleplay_scenarios;
create trigger roleplay_scenarios_set_updated_at
  before update on roleplay_scenarios
  for each row execute function set_updated_at();

-- A session = one rep practicing one scenario, start to finish.
create table if not exists roleplay_sessions (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  scenario_id         uuid not null references roleplay_scenarios(id) on delete cascade,
  member_id           uuid not null references members(id) on delete cascade,  -- the rep practicing
  status              text not null default 'active'
                        check (status in ('active','completed','abandoned')),
  started_at          timestamptz default now(),
  completed_at        timestamptz,
  duration_seconds    int,
  ai_score            numeric,                -- 0-100 auto-eval after session ends
  ai_summary          text,                   -- post-session debrief
  ai_strengths        text,
  ai_weaknesses       text,
  transcript_full     text,                   -- denormalized full transcript for fast search
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index if not exists roleplay_sessions_rep_idx       on roleplay_sessions(rep_id, started_at desc);
create index if not exists roleplay_sessions_member_idx    on roleplay_sessions(member_id, started_at desc);
create index if not exists roleplay_sessions_scenario_idx  on roleplay_sessions(scenario_id, started_at desc);
create index if not exists roleplay_sessions_status_idx    on roleplay_sessions(rep_id, status, started_at desc);

drop trigger if exists roleplay_sessions_set_updated_at on roleplay_sessions;
create trigger roleplay_sessions_set_updated_at
  before update on roleplay_sessions
  for each row execute function set_updated_at();

-- Turn-by-turn record of who said what. Both sides transcribed; rep audio
-- stored in Supabase Storage for manager replay.
create table if not exists roleplay_turns (
  id                  uuid primary key default gen_random_uuid(),
  session_id          uuid not null references roleplay_sessions(id) on delete cascade,
  turn_index          int not null,
  speaker             text not null check (speaker in ('ai','rep')),
  transcript          text,
  audio_storage_path  text,                   -- path in 'roleplay-audio' private bucket
  duration_ms         int,
  created_at          timestamptz default now()
);

create unique index if not exists roleplay_turns_session_index_idx on roleplay_turns(session_id, turn_index);
create index if not exists roleplay_turns_session_idx on roleplay_turns(session_id, created_at);

-- Manager / leader review of a recorded session. One reviewer, one rating.
create table if not exists roleplay_reviews (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references roleplay_sessions(id) on delete cascade,
  reviewer_member_id    uuid not null references members(id) on delete cascade,
  rating                int check (rating between 1 and 5),
  verdict               text check (verdict in ('ready','needs_work','escalate')),
  notes                 text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create unique index if not exists roleplay_reviews_session_reviewer_idx on roleplay_reviews(session_id, reviewer_member_id);
create index if not exists roleplay_reviews_reviewer_idx on roleplay_reviews(reviewer_member_id, created_at desc);

drop trigger if exists roleplay_reviews_set_updated_at on roleplay_reviews;
create trigger roleplay_reviews_set_updated_at
  before update on roleplay_reviews
  for each row execute function set_updated_at();

alter table roleplay_scenarios enable row level security;
alter table roleplay_sessions  enable row level security;
alter table roleplay_turns     enable row level security;
alter table roleplay_reviews   enable row level security;

-- Storage bucket: create a *private* bucket named `roleplay-audio` in the
-- Supabase dashboard once the feature is wired up. Uses signed URLs.

-- ============================================================================
-- Rooms (assistant-mediated channels)
-- People never read each other's messages directly. When a manager "posts to
-- the managers room", their assistant relays the post 1:1 over Telegram to
-- every other member of that audience. Replies thread back the same way.
-- The dashboard surfaces the audit log of the room (who said what, who saw
-- it) but the live experience is always 1:1 with your assistant.
-- Audience values: 'managers' (managers + admins + owners),
--                  'owners'   (admins + owners),
--                  'team:<uuid>' (one team's members + their managers).
-- ============================================================================
create table if not exists room_messages (
  id                 uuid primary key default gen_random_uuid(),
  rep_id             text not null references reps(id) on delete cascade,
  audience           text not null,
  sender_member_id   uuid references members(id) on delete set null,
  parent_message_id  uuid references room_messages(id) on delete set null,
  body               text,
  kind               text not null default 'text' check (kind in ('text','voice','system')),
  telegram_file_id   text,
  transcript         text,
  delivered_count    int default 0,
  created_at         timestamptz default now()
);
-- Lock audience values to known shapes (managers, owners, or team:<uuid>).
-- Using alter+drop+add so re-runs stay idempotent if the constraint name exists.
alter table room_messages drop constraint if exists room_messages_audience_check;
alter table room_messages add constraint room_messages_audience_check
  check (audience in ('managers','owners') or audience like 'team:%');
create index if not exists room_msgs_rep_aud_idx on room_messages(rep_id, audience, created_at desc);
create index if not exists room_msgs_parent_idx  on room_messages(parent_message_id);
create index if not exists room_msgs_sender_idx  on room_messages(sender_member_id, created_at desc);
alter table room_messages enable row level security;

-- One row per recipient per relayed message. Used to thread replies back
-- (we look up the message via tg_chat_id + tg_message_id when someone hits
-- "Reply" on the bot's relay) and to show "delivered to N / acknowledged
-- by N" in the dashboard.
create table if not exists room_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid not null references room_messages(id) on delete cascade,
  recipient_member_id uuid not null references members(id) on delete cascade,
  tg_chat_id          text,
  tg_message_id       bigint,
  delivered_at        timestamptz,
  acknowledged_at     timestamptz,
  created_at          timestamptz default now()
);
create unique index if not exists room_deliveries_unique on room_deliveries(message_id, recipient_member_id);
create index if not exists room_deliveries_relay_idx on room_deliveries(tg_chat_id, tg_message_id);
alter table room_deliveries enable row level security;

-- Shared todos visible only to a room's audience. Lets owners run a private
-- exec to-do list / managers run a leadership punch list.
create table if not exists room_todos (
  id                 uuid primary key default gen_random_uuid(),
  rep_id             text not null references reps(id) on delete cascade,
  audience           text not null,
  created_by         uuid references members(id) on delete set null,
  assigned_to        uuid references members(id) on delete set null,
  body               text not null,
  status             text not null default 'open' check (status in ('open','done','archived')),
  due_at             timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);
create index if not exists room_todos_rep_aud_idx on room_todos(rep_id, audience, status, created_at desc);
create index if not exists room_todos_assigned_idx on room_todos(assigned_to, status);
alter table room_todos enable row level security;
alter table room_todos drop constraint if exists room_todos_audience_check;
alter table room_todos add constraint room_todos_audience_check
  check (audience in ('managers','owners') or audience like 'team:%');
drop trigger if exists room_todos_set_updated_at on room_todos;
create trigger room_todos_set_updated_at
  before update on room_todos
  for each row execute function set_updated_at();

-- ============================================================================
-- Roleplay management layer (assignments, training docs, quotas, activity)
-- Sits on top of the roleplay_scenarios / sessions / turns / reviews tables.
--
-- Doc isolation rules (HARD REQUIREMENT):
--   - scope='personal' rows MUST set owner_member_id and are only used by
--     that single member's AI prospect.
--   - scope='account' rows MUST leave owner_member_id null and are used by
--     every member of that rep_id (the enterprise account).
-- We never mix the two: a personal salesperson's product brief never feeds
-- another rep's bot, and an enterprise account's training never leaks across
-- accounts. Reads always filter by both rep_id AND the right scope.
-- ============================================================================

-- Training docs uploaded by a rep (personal) or by a manager/owner (account).
-- Powers the AI prospect's brain. Stored either as plain text in this table
-- or as a file in Supabase Storage (`roleplay-training` bucket) with the path
-- recorded here. Either way, scope + ownership is enforced.
create table if not exists roleplay_training_docs (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  scope               text not null check (scope in ('personal','account')),
  owner_member_id     uuid references members(id) on delete cascade,
  uploaded_by_member_id uuid references members(id) on delete set null,
  doc_kind            text not null default 'reference'
                        check (doc_kind in ('product_brief','script','objection_list','case_study','training','reference')),
  title               text not null,
  body                text,                 -- inline text content (paste-in)
  storage_path        text,                 -- path in 'roleplay-training' bucket
  source_voice_memo_id uuid references voice_memos(id) on delete set null,
  is_active           boolean default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

-- Hard guarantee: personal docs MUST have an owner_member_id; account docs
-- MUST NOT. Anyone trying to mix them gets rejected at write time.
alter table roleplay_training_docs drop constraint if exists roleplay_training_docs_scope_owner_check;
alter table roleplay_training_docs add constraint roleplay_training_docs_scope_owner_check
  check (
    (scope = 'personal' and owner_member_id is not null)
    or (scope = 'account' and owner_member_id is null)
  );

create index if not exists roleplay_docs_rep_scope_idx on roleplay_training_docs(rep_id, scope, is_active, updated_at desc);
create index if not exists roleplay_docs_owner_idx on roleplay_training_docs(owner_member_id, is_active, updated_at desc) where owner_member_id is not null;

drop trigger if exists roleplay_training_docs_set_updated_at on roleplay_training_docs;
create trigger roleplay_training_docs_set_updated_at
  before update on roleplay_training_docs
  for each row execute function set_updated_at();

-- A scenario's training "diet": which docs feed the AI when this scenario
-- runs. Keeps the wiring explicit so a manager can tell at a glance what
-- the bot knows.
create table if not exists roleplay_scenario_docs (
  scenario_id  uuid not null references roleplay_scenarios(id) on delete cascade,
  doc_id       uuid not null references roleplay_training_docs(id) on delete cascade,
  weight       numeric default 1,
  created_at   timestamptz default now(),
  primary key (scenario_id, doc_id)
);
create index if not exists roleplay_scenario_docs_doc_idx on roleplay_scenario_docs(doc_id);

-- Manager assigns a scenario to a member (or to a whole team) with a
-- deadline + required count. Reps see this in their dashboard + Telegram.
create table if not exists roleplay_assignments (
  id                   uuid primary key default gen_random_uuid(),
  rep_id               text not null references reps(id) on delete cascade,
  scenario_id          uuid not null references roleplay_scenarios(id) on delete cascade,
  assigned_by_member_id uuid references members(id) on delete set null,
  assignee_member_id   uuid references members(id) on delete cascade,
  team_id              uuid references teams(id) on delete cascade,
  required_count       int not null default 1 check (required_count > 0),
  due_at               timestamptz,
  status               text not null default 'open'
                         check (status in ('open','completed','expired','canceled')),
  notes                text,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- Either assignee_member_id or team_id must be set; not both null.
alter table roleplay_assignments drop constraint if exists roleplay_assignments_target_check;
alter table roleplay_assignments add constraint roleplay_assignments_target_check
  check (assignee_member_id is not null or team_id is not null);

create index if not exists roleplay_assignments_rep_status_idx on roleplay_assignments(rep_id, status, due_at);
create index if not exists roleplay_assignments_assignee_idx on roleplay_assignments(assignee_member_id, status, due_at) where assignee_member_id is not null;
create index if not exists roleplay_assignments_team_idx on roleplay_assignments(team_id, status, due_at) where team_id is not null;

drop trigger if exists roleplay_assignments_set_updated_at on roleplay_assignments;
create trigger roleplay_assignments_set_updated_at
  before update on roleplay_assignments
  for each row execute function set_updated_at();

-- Optional: an account-wide quota ("every rep does at least 2 sessions per
-- week"). Daily cron checks against rollups + auto-creates assignments for
-- anyone behind. Null = no quota set.
create table if not exists roleplay_quotas (
  id              uuid primary key default gen_random_uuid(),
  rep_id          text not null references reps(id) on delete cascade,
  team_id         uuid references teams(id) on delete cascade,
  cadence         text not null check (cadence in ('daily','weekly','monthly')),
  required_count  int not null default 2 check (required_count > 0),
  is_active       boolean default true,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create unique index if not exists roleplay_quotas_one_per_scope_idx
  on roleplay_quotas(rep_id, coalesce(team_id::text, 'account'), cadence)
  where is_active = true;

drop trigger if exists roleplay_quotas_set_updated_at on roleplay_quotas;
create trigger roleplay_quotas_set_updated_at
  before update on roleplay_quotas
  for each row execute function set_updated_at();

-- Denormalized per-member-per-day rollup. Powers the leaderboard + manager
-- digest without scanning sessions every read. Updated by a trigger on
-- roleplay_sessions when status flips to 'completed'.
create table if not exists roleplay_daily_activity (
  rep_id            text not null references reps(id) on delete cascade,
  member_id         uuid not null references members(id) on delete cascade,
  day               date not null,
  sessions_count    int not null default 0,
  minutes_practiced int not null default 0,
  avg_score         numeric,
  best_score        numeric,
  updated_at        timestamptz default now(),
  primary key (rep_id, member_id, day)
);
create index if not exists roleplay_daily_rep_day_idx on roleplay_daily_activity(rep_id, day desc);

-- Recompute one (rep, member, day) row from roleplay_sessions. Called by the
-- session-completed trigger and by the leaderboard backfill.
create or replace function recompute_roleplay_daily(
  p_rep_id text,
  p_member_id uuid,
  p_day date
) returns void as $$
begin
  insert into roleplay_daily_activity (rep_id, member_id, day, sessions_count, minutes_practiced, avg_score, best_score)
  select p_rep_id,
         p_member_id,
         p_day,
         count(*),
         coalesce(sum(coalesce(duration_seconds, 0)), 0) / 60,
         avg(ai_score),
         max(ai_score)
    from roleplay_sessions
   where rep_id = p_rep_id
     and member_id = p_member_id
     and status = 'completed'
     and (completed_at at time zone 'UTC')::date = p_day
  on conflict (rep_id, member_id, day) do update
    set sessions_count = excluded.sessions_count,
        minutes_practiced = excluded.minutes_practiced,
        avg_score = excluded.avg_score,
        best_score = excluded.best_score,
        updated_at = now();
end;
$$ language plpgsql;

create or replace function trg_roleplay_session_completed() returns trigger as $$
begin
  if new.status = 'completed' and new.completed_at is not null then
    perform recompute_roleplay_daily(
      new.rep_id,
      new.member_id,
      (new.completed_at at time zone 'UTC')::date
    );
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists roleplay_sessions_completed_rollup on roleplay_sessions;
create trigger roleplay_sessions_completed_rollup
  after insert or update of status, completed_at on roleplay_sessions
  for each row execute function trg_roleplay_session_completed();

alter table roleplay_training_docs enable row level security;
alter table roleplay_scenario_docs enable row level security;
alter table roleplay_assignments   enable row level security;
alter table roleplay_quotas        enable row level security;
alter table roleplay_daily_activity enable row level security;

-- ============================================================================
-- Add-on entitlements (per-account + per-member)
-- Roleplay is a paid add-on on Salesperson AND Enterprise. NOT included in
-- any base tier. We track:
--   - rep_addons:    which add-ons an account has unlocked + how many seats
--                    purchased (for enterprise)
--   - member_addons: which specific members have a seat (so a manager can
--                    enable roleplay only for the reps they want to pay for)
-- App code checks both before showing the live roleplay surface.
-- ============================================================================
create table if not exists rep_addons (
  rep_id      text not null references reps(id) on delete cascade,
  addon_key   text not null check (addon_key in ('roleplay')),
  seats       int not null default 1 check (seats >= 0),
  is_active   boolean not null default true,
  activated_at timestamptz default now(),
  notes       text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  primary key (rep_id, addon_key)
);
create index if not exists rep_addons_active_idx on rep_addons(rep_id, addon_key) where is_active = true;
drop trigger if exists rep_addons_set_updated_at on rep_addons;
create trigger rep_addons_set_updated_at
  before update on rep_addons
  for each row execute function set_updated_at();

create table if not exists member_addons (
  rep_id      text not null references reps(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  addon_key   text not null check (addon_key in ('roleplay')),
  is_active   boolean not null default true,
  granted_by_member_id uuid references members(id) on delete set null,
  granted_at  timestamptz default now(),
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  primary key (rep_id, member_id, addon_key)
);
create index if not exists member_addons_active_idx on member_addons(rep_id, addon_key) where is_active = true;
drop trigger if exists member_addons_set_updated_at on member_addons;
create trigger member_addons_set_updated_at
  before update on member_addons
  for each row execute function set_updated_at();

alter table rep_addons    enable row level security;
alter table member_addons enable row level security;

-- ============================================================================
-- Deferred items ("remind me later" inbox)
-- The nucleus walkie-talkie can drop fire-and-forget messages between members.
-- This table is the OTHER side: things a manager (or anyone) said "remind me
-- about this later" or that bubbled up from a rep and the manager parked.
-- It stays SEPARATE from brain_items so a manager's personal goals/tasks
-- don't get polluted with team-relayed asks. Source tracking is mandatory:
-- every row records WHERE it came from + WHO it's from + WHEN it should
-- resurface.
-- ============================================================================
create table if not exists deferred_items (
  id                 uuid primary key default gen_random_uuid(),
  rep_id             text not null references reps(id) on delete cascade,
  owner_member_id    uuid not null references members(id) on delete cascade, -- whose inbox this lives in
  source             text not null check (source in (
                       'walkie',         -- walkie-talkie message from a teammate
                       'voice_memo',     -- voice memo (pitch/feedback/coaching)
                       'room',           -- room message (managers/owners/team:*)
                       'lead',           -- something tied to a CRM lead
                       'roleplay',       -- a session that needs review later
                       'self'            -- manager said "remind me about X tomorrow"
                     )),
  source_member_id   uuid references members(id) on delete set null,        -- who it came from (null = self)
  source_memo_id     uuid references voice_memos(id) on delete set null,
  source_room_message_id uuid references room_messages(id) on delete set null,
  source_lead_id     uuid references leads(id) on delete set null,
  source_session_id  uuid references roleplay_sessions(id) on delete set null,
  title              text not null,
  body               text,
  remind_at          timestamptz,                                            -- when to resurface (null = manual review)
  status             text not null default 'open'
                       check (status in ('open','snoozed','done','dismissed')),
  completed_at       timestamptz,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create index if not exists deferred_owner_status_idx on deferred_items(owner_member_id, status, remind_at);
create index if not exists deferred_rep_status_idx on deferred_items(rep_id, status, created_at desc);
create index if not exists deferred_source_idx on deferred_items(rep_id, source, status, created_at desc);
create index if not exists deferred_remind_idx on deferred_items(remind_at) where status in ('open','snoozed') and remind_at is not null;

drop trigger if exists deferred_items_set_updated_at on deferred_items;
create trigger deferred_items_set_updated_at
  before update on deferred_items
  for each row execute function set_updated_at();

alter table deferred_items enable row level security;

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table reps           enable row level security;
alter table leads          enable row level security;
alter table agent_actions  enable row level security;
alter table agent_runs     enable row level security;
alter table brain_dumps    enable row level security;
alter table brain_items    enable row level security;
alter table client_events  enable row level security;
alter table prospects      enable row level security;
alter table google_tokens  enable row level security;
alter table teams          enable row level security;
alter table team_members   enable row level security;
alter table call_logs      enable row level security;
alter table targets        enable row level security;

-- Service role bypasses RLS; no public policies by default.
-- (App enforces tenant isolation via explicit rep_id filtering on every query.)
