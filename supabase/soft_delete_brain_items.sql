-- ============================================================================
-- Soft-delete for brain_items (task undo feature)
--
-- Instead of hard-deleting completed tasks, we now soft-delete them by
-- setting deleted_at = now() and status = 'done'. The Telegram "undo" command
-- can restore them within 10 minutes.
--
-- All queries that filter status = 'open' are unaffected (soft-deleted items
-- have status = 'done' so they're already excluded). The deleted_at column is
-- only used for the undo window lookup.
-- ============================================================================

alter table brain_items add column if not exists deleted_at timestamptz;

create index if not exists brain_items_deleted_recent_idx
  on brain_items(rep_id, owner_member_id, deleted_at desc)
  where deleted_at is not null;
