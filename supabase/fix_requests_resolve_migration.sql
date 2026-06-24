-- Notify-on-ship: track when a fix-request was resolved + the user-facing note.
-- When the dev marks a fix-request resolved, the bot tells whoever flagged it
-- that it's live and clears the matching "known limitation" from the brain.

alter table fix_requests
  add column if not exists resolved_at        timestamptz,
  add column if not exists resolution_message text;
