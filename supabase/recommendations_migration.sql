-- Recommendations migration — the proactive "overseer" surface.
--
-- Beyond the recording-based daily plan, the assistant watches live business
-- signals (deals gone quiet, drafts piling up, unanswered threads) and surfaces
-- persistent, trackable recommendations on the dashboard. Each can be acted on
-- or dismissed-with-reason; dismissals feed the same learning + fix-digest loops
-- so the overseer stops suggesting things the exec doesn't want.

create table if not exists recommendations (
  id                uuid primary key default gen_random_uuid(),
  rep_id            text not null references reps(id) on delete cascade,
  -- Stable per (rep, underlying signal), so regeneration refreshes one row
  -- instead of piling up duplicates — and a dismissed rec isn't resurrected.
  dedupe_key        text not null,
  kind              text not null,   -- quiet_deal | drafts_backlog | unanswered_threads | revenue_pace | ...
  title             text not null,
  detail            text,
  reasoning         text,
  priority          text not null default 'normal' check (priority in ('low','normal','high')),
  status            text not null default 'open' check (status in ('open','acted','dismissed','stale')),
  signal            jsonb,           -- the raw numbers behind it, for debugging
  dismissed_reason  text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  unique (rep_id, dedupe_key)
);

create index if not exists recommendations_rep_status_idx
  on recommendations (rep_id, status, created_at desc);
