-- Plaud Agent Guidance migration — the unified "self-learning" store.
--
-- The daily planner already learns from plan 👍/👎 (plaud_plan_feedback). This
-- generalizes that idea to EVERY Plaud LLM call: when Spencer dismisses a
-- proposed action with a reason, or corrects one (edits the recipient/body),
-- that signal is distilled into a durable one-line RULE and stored here. Both
-- the per-note action agent (lib/plaud/agentTick.ts) and the daily planner
-- (lib/plaud/dailyPlan.ts) read the active rules back into their system prompts,
-- so the assistant stops repeating the same mistakes.
--
-- This is preference memory, not retraining. Rules are visible and editable in
-- the dashboard ("What your assistant has learned"), so Spencer stays in
-- control of the learned state.

create table if not exists plaud_agent_guidance (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null references reps(id) on delete cascade,
  -- Which LLM call(s) this rule conditions:
  --   note_agent = the per-note action proposer
  --   planner    = the morning daily-plan overseer
  --   both       = injected into both (default)
  scope         text not null default 'both'
    check (scope in ('note_agent','planner','both')),
  -- The shape of the rule, for ordering/labeling in the UI:
  --   avoid      = don't do this (most dismissals)
  --   prefer     = do more of this
  --   correction = a fix to apply (wrong recipient/email, format)
  --   fact       = a durable fact (e.g. "Maria's email is maria@x.com")
  kind          text not null default 'avoid'
    check (kind in ('avoid','prefer','correction','fact')),
  -- The durable, human-readable rule injected into prompts. One sentence.
  rule          text not null,
  -- Where the rule came from, for provenance + dedupe.
  source        text not null default 'action'
    check (source in ('action','plan','manual')),
  -- Free-text context label (e.g. the plaud action kind, or 'plan').
  source_kind   text,
  -- The originating action/plan id (no FK — points at two possible tables).
  source_ref    uuid,
  -- Bumped when the same rule is reinforced, so the prompt can weight it.
  weight        int not null default 1,
  -- Soft on/off so Spencer can mute a rule without losing the history.
  active        boolean not null default true,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- The hot path: load active rules for a rep filtered by scope.
create index if not exists plaud_agent_guidance_rep_active_idx
  on plaud_agent_guidance (rep_id, active, scope);
create index if not exists plaud_agent_guidance_rep_created_idx
  on plaud_agent_guidance (rep_id, created_at desc);
