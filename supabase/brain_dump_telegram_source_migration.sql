-- ============================================================================
-- Widen brain_dumps.source to include 'plaud' and 'telegram'
--
-- The original schema.sql constraint only had ('mic','manual','import').
-- Production already had 'plaud' added but 'telegram' was still missing,
-- causing every Telegram-originated brain dump to silently fail with a
-- constraint violation. This migration consolidates the full allowed set.
-- Safe to run multiple times (idempotent).
-- ============================================================================

alter table brain_dumps drop constraint if exists brain_dumps_source_check;

alter table brain_dumps add constraint brain_dumps_source_check
  check (source in ('mic', 'manual', 'import', 'plaud', 'telegram'));
