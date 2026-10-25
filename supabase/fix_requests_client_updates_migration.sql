-- Suite CXO: client updates on a member's own "report an issue" (fix_requests).
-- started_at = when the team said it started; last_client_update_at paces
-- progress updates (lib/feedback/fixRequestUpdates.ts). Idempotent.
alter table fix_requests
  add column if not exists started_at timestamptz,
  add column if not exists last_client_update_at timestamptz;
