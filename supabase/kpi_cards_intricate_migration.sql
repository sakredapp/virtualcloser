-- KPI cards — richer per-card configuration.
--
-- The original kpi_cards row stored only label/period/goal_value. Reps asked
-- for a real "create KPI" form: a description, a starting progress value
-- so they don't lose history when they pin a metric mid-cycle, an explicit
-- goal target date (so "5K by Friday" actually has a deadline), and an
-- opt-in reminder cadence so Telegram nags them on the schedule THEY
-- pick — daily, weekdays only, or weekly on a chosen day at a chosen time.
--
-- All columns are nullable / have defaults so existing cards survive.
-- Safe to run multiple times (idempotent).

alter table kpi_cards
  add column if not exists description       text,
  add column if not exists starting_value    numeric,
  add column if not exists target_date       date,
  add column if not exists reminder_cadence  text
    not null default 'none'
    check (reminder_cadence in ('none','daily','weekdays','weekly')),
  -- 24h "HH:MM" in the rep's local timezone (resolved at send time from
  -- members.timezone). Null = use the rep's morning-scan time.
  add column if not exists reminder_time     text,
  -- 0=Sun … 6=Sat. Only consulted when reminder_cadence='weekly'.
  add column if not exists reminder_dow      smallint
    check (reminder_dow is null or (reminder_dow >= 0 and reminder_dow <= 6));

-- Reminder lookup index for the cron job — only scan cards that opted in.
create index if not exists kpi_cards_reminder_idx
  on kpi_cards(rep_id, reminder_cadence)
  where reminder_cadence <> 'none' and archived_at is null;
