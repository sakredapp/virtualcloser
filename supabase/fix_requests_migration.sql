-- Fix-requests migration — the "needs a human code fix" feedback loop.
--
-- The self-learning loop (plaud_agent_guidance) handles feedback the AI can
-- adapt to itself. This is the OTHER half: feedback that needs a code change —
-- "this is broken", "I want it to work this way" — captured from an explicit
-- "request a change" box AND auto-routed from dismissals the AI classifies as
-- product issues. A daily cron (/api/cron/fix-digest) emails the full,
-- untruncated breakdown to the developer so it can be fixed in code.

create table if not exists fix_requests (
  id              uuid primary key default gen_random_uuid(),
  -- Whose workspace it came from (nullable: some sources are workspace-wide).
  rep_id          text references reps(id) on delete cascade,
  member_id       uuid references members(id) on delete set null,
  -- Where it came from:
  --   manual  = the "request a change" box
  --   dismiss = auto-routed from an action dismissal the AI flagged as a fix
  --   plan    = auto-routed from daily-plan 👎 feedback
  --   auto    = any other automated source
  source          text not null default 'manual'
    check (source in ('manual','dismiss','plan','auto')),
  -- Optional area label (e.g. 'pinnacle', 'plaud', 'billing').
  area            text,
  -- The request itself — what's broken / the desired behavior. Full text.
  body            text not null,
  severity        text not null default 'normal' check (severity in ('low','normal','high')),
  -- new = not yet sent in a digest; sent = included; resolved/dismissed by hand.
  status          text not null default 'new' check (status in ('new','sent','resolved','dismissed')),
  -- Display name of who filed it, for the digest.
  created_by      text,
  digest_sent_at  timestamptz,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists fix_requests_status_created_idx
  on fix_requests (status, created_at desc);
create index if not exists fix_requests_rep_idx
  on fix_requests (rep_id, created_at desc);
