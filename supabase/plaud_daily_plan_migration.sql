-- Plaud Daily Plan migration.
--
-- Adds the "overseer" layer on top of the per-note Plaud agent: once each
-- morning, a planner rolls up everything new (triaged recordings + open tasks +
-- pending agent actions) into ONE prioritized "get-things-done" plan with
-- reasoning per item. Spencer reviews it on the Command Center and gives 👍/👎
-- + an optional "why" — at the plan level and per item. That feedback is stored
-- durably and read back into the next morning's planner prompt, so the plan
-- sharpens over time (preference memory, not retraining).
--
-- Tables:
--   plaud_daily_plans   one row per (rep_id, plan_date) — the generated plan
--   plaud_plan_feedback 👍/👎 + reason, at plan or item level; doubles as the
--                       learning store the planner reads back.

-- ── plaud_daily_plans: the morning briefing ──────────────────────────────
create table if not exists plaud_daily_plans (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  -- Whose plan this is. Null = rep-wide (single-seat accounts like Spencer).
  owner_member_id   uuid references members(id) on delete set null,
  -- Rep-local calendar date the plan is for (one plan per rep per day).
  plan_date         date not null,
  timezone          text,
  status            text not null default 'pending_review'
    check (status in ('pending_review','reviewed')),
  -- One-line framing of the day.
  intro             text,
  -- Ordered plan items. Each item:
  --   { title, detail, reasoning, priority: 'high'|'normal'|'low',
  --     category: 'follow_up'|'task'|'message'|'reminder'|'decision'|'other',
  --     source }   (source = short human label of which recording/task it came from)
  items             jsonb not null default '[]'::jsonb,
  -- {notes, open_tasks, pending_actions} — what fed this plan, for debugging.
  source_counts     jsonb,
  model             text,
  created_at        timestamptz default now(),
  reviewed_at       timestamptz,
  updated_at        timestamptz default now()
);

-- One plan per rep per day. The planner tick relies on this to stay idempotent
-- (it checks for an existing row before spending tokens, and the unique index
-- is the backstop against a race between two ticks).
create unique index if not exists plaud_daily_plans_rep_date_idx
  on plaud_daily_plans (rep_id, plan_date);
create index if not exists plaud_daily_plans_rep_created_idx
  on plaud_daily_plans (rep_id, created_at desc);

-- ── plaud_plan_feedback: the learning store ──────────────────────────────
create table if not exists plaud_plan_feedback (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references plaud_daily_plans(id) on delete cascade,
  rep_id            text not null references reps(id) on delete cascade,
  member_id         uuid references members(id) on delete set null,
  -- Null = feedback on the whole plan; otherwise the 0-based item index.
  item_index        int,
  -- Snapshot of the item title at feedback time, so the planner can read back
  -- "Spencer disliked X — because Y" without re-joining to a mutable plan.
  item_title        text,
  verdict           text not null check (verdict in ('up','down')),
  reason            text,
  created_at        timestamptz default now()
);

create index if not exists plaud_plan_feedback_rep_created_idx
  on plaud_plan_feedback (rep_id, created_at desc);
create index if not exists plaud_plan_feedback_plan_idx
  on plaud_plan_feedback (plan_id);
