-- Enterprise WAVV attribution.
-- Adds owner_member_id to voice_calls so per-rep WAVV KPIs work.
-- The webhook route sets this from ?member=<memberId> in the URL.
-- All existing rows get NULL (unattributed), which is fine — the dashboard
-- falls back to account-level rollups when the column is null.

alter table voice_calls
  add column if not exists owner_member_id uuid references members(id) on delete set null;

create index if not exists voice_calls_owner_member_idx
  on voice_calls(rep_id, owner_member_id)
  where owner_member_id is not null;
