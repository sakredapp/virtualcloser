-- Roleplay suite — the tables lib/roleplay.ts has been waiting on.
--
-- Creates:
--   1. roleplay_scenarios     — manager-built: product brief + persona + objections
--   2. roleplay_sessions      — one rep practicing one scenario, start to finish
--   3. roleplay_turns         — turn-by-turn transcript + audio for replay
--   4. roleplay_reviews       — manager rating + verdict on a finished session
--   5. roleplay_training_docs — scope-isolated docs that feed the AI prospect
--   6. roleplay_assignments   — manager → rep practice assignments
--   7. roleplay_daily_activity— denormalized rollup that feeds the leaderboard
--   8. rep_addons / member_addons — the 2-key entitlement lock lib/roleplay.ts
--      already checks (account has the add-on AND the member has a seat)
--
-- Run this in the Supabase SQL editor (same as every *_migration.sql here).
-- All access goes through the service-role key server-side; RLS is enabled
-- with no anon policies, matching the rest of the schema.

-- ── 1. Scenarios ────────────────────────────────────────────────────────────
create table if not exists roleplay_scenarios (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  created_by_member_id  uuid references members(id) on delete set null,
  name                  text not null,
  product_brief         text,
  persona               text,
  difficulty            text not null default 'standard'
                        check (difficulty in ('easy','standard','hard','brutal')),
  objection_bank        jsonb not null default '[]'::jsonb,
  source_voice_memo_ids jsonb,
  voice_provider        text,
  voice_id              text,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists roleplay_scenarios_rep_idx
  on roleplay_scenarios(rep_id, is_active, updated_at desc);
alter table roleplay_scenarios enable row level security;

-- ── 2. Sessions ─────────────────────────────────────────────────────────────
-- scenario_key is set for built-in platform personas (the four RevRing
-- trainer agents); scenario_id for tenant-built scenarios. One of the two.
create table if not exists roleplay_sessions (
  id               uuid primary key default gen_random_uuid(),
  rep_id           text not null references reps(id) on delete cascade,
  scenario_id      uuid references roleplay_scenarios(id) on delete set null,
  scenario_key     text,
  member_id        uuid not null references members(id) on delete cascade,
  status           text not null default 'active'
                   check (status in ('active','completed','abandoned')),
  transport        text not null default 'browser',
  agent_id         text,
  agent_number     text,
  -- Provider call binding. UNIQUE: one provider call grades exactly one
  -- session — the DB-level backstop against a cross-account transcript
  -- landing under the wrong rep when two sessions race for one call.
  provider_call_id text unique,
  bind_note        text,
  requested_at     timestamptz not null default now(),
  dialed_at        timestamptz,
  started_at       timestamptz not null default now(),
  completed_at     timestamptz,
  duration_seconds integer,
  ai_score         numeric,
  ai_summary       text,
  ai_strengths     text,
  ai_weaknesses    text,
  transcript_full  text
);
create index if not exists roleplay_sessions_rep_member_idx
  on roleplay_sessions(rep_id, member_id, started_at desc);
create index if not exists roleplay_sessions_rep_idx
  on roleplay_sessions(rep_id, started_at desc);
alter table roleplay_sessions enable row level security;

-- ── 3. Turns ────────────────────────────────────────────────────────────────
create table if not exists roleplay_turns (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references roleplay_sessions(id) on delete cascade,
  turn_index         integer not null,
  speaker            text not null check (speaker in ('ai','rep')),
  transcript         text,
  audio_storage_path text,
  duration_ms        integer,
  created_at         timestamptz not null default now(),
  unique (session_id, turn_index)
);
alter table roleplay_turns enable row level security;

-- ── 4. Reviews ──────────────────────────────────────────────────────────────
create table if not exists roleplay_reviews (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null references roleplay_sessions(id) on delete cascade,
  reviewer_member_id uuid not null references members(id) on delete cascade,
  rating             integer check (rating between 1 and 5),
  verdict            text check (verdict in ('ready','needs_work','escalate')),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (session_id, reviewer_member_id)
);
alter table roleplay_reviews enable row level security;

-- ── 5. Training docs ────────────────────────────────────────────────────────
create table if not exists roleplay_training_docs (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  scope                 text not null default 'account'
                        check (scope in ('personal','account')),
  owner_member_id       uuid references members(id) on delete cascade,
  uploaded_by_member_id uuid references members(id) on delete set null,
  doc_kind              text not null default 'reference'
                        check (doc_kind in ('product_brief','script','objection_list','case_study','training','reference')),
  title                 text not null,
  body                  text,
  storage_path          text,
  source_voice_memo_id  uuid,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists roleplay_training_docs_rep_idx
  on roleplay_training_docs(rep_id, is_active, updated_at desc);
alter table roleplay_training_docs enable row level security;

-- ── 6. Assignments ──────────────────────────────────────────────────────────
create table if not exists roleplay_assignments (
  id                    uuid primary key default gen_random_uuid(),
  rep_id                text not null references reps(id) on delete cascade,
  scenario_id           uuid references roleplay_scenarios(id) on delete cascade,
  assigned_by_member_id uuid references members(id) on delete set null,
  assignee_member_id    uuid references members(id) on delete cascade,
  team_id               uuid,
  required_count        integer not null default 1,
  due_at                timestamptz,
  status                text not null default 'open'
                        check (status in ('open','completed','expired','canceled')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists roleplay_assignments_assignee_idx
  on roleplay_assignments(rep_id, assignee_member_id, status);
alter table roleplay_assignments enable row level security;

-- ── 7. Daily activity rollup (leaderboard) ──────────────────────────────────
create table if not exists roleplay_daily_activity (
  rep_id            text not null references reps(id) on delete cascade,
  member_id         uuid not null references members(id) on delete cascade,
  day               date not null,
  sessions_count    integer not null default 0,
  minutes_practiced integer not null default 0,
  avg_score         numeric,
  best_score        numeric,
  primary key (rep_id, member_id, day)
);
alter table roleplay_daily_activity enable row level security;

-- ── 8. Entitlements (2-key lock: account addon + member seat) ───────────────
create table if not exists rep_addons (
  id         uuid primary key default gen_random_uuid(),
  rep_id     text not null references reps(id) on delete cascade,
  addon_key  text not null,
  is_active  boolean not null default true,
  seats      integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rep_id, addon_key)
);
alter table rep_addons enable row level security;

create table if not exists member_addons (
  id         uuid primary key default gen_random_uuid(),
  rep_id     text not null references reps(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  addon_key  text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rep_id, member_id, addon_key)
);
alter table member_addons enable row level security;
