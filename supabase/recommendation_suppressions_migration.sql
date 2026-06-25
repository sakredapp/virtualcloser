-- Recommendation outcome learning: when the exec consistently dismisses a kind
-- of recommendation, the overseer learns to stop surfacing it. Suppressions
-- expire after 30 days (the engine ignores stale ones), so a kind gets
-- periodically re-tested rather than buried forever.

create table if not exists recommendation_suppressions (
  rep_id      text not null references reps(id) on delete cascade,
  kind        text not null,
  created_at  timestamptz default now(),
  primary key (rep_id, kind)
);
