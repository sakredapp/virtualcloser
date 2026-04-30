-- Org chart dashboard support.
--
-- teams.manager_member_id and team_members.member_id already exist (schema.sql:486-489).
-- This migration adds the one missing index (manager lookups) and ensures
-- any teams that were created before the manager_member_id column exist cleanly.

-- Fast lookup: find which teams a manager owns
create index if not exists teams_manager_member_idx
  on teams(manager_member_id) where manager_member_id is not null;

-- Fast lookup: all members that are NOT yet assigned to any team
-- (used by the org chart available-members dropdowns)
create index if not exists team_members_member_id_idx
  on team_members(member_id) where member_id is not null;
