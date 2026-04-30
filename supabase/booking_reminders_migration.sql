-- Reminder tracking for booker confirmation emails.
-- Timestamps are set when each email fires so the cron can skip already-sent rows.
alter table prospects add column if not exists reminder_24h_sent_at timestamptz;
alter table prospects add column if not exists reminder_1h_sent_at  timestamptz;

-- Index so the reminder cron query (filter on status + meeting_at + sent_at nulls) is fast.
create index if not exists prospects_reminder_idx
  on prospects(status, meeting_at)
  where email is not null and meeting_at is not null;
