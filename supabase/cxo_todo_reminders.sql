-- Timed to-do reminders for Ciao (Suite CXO, QA gap 9, 2026-10-18).
-- "Remind me at 2:30 to call Dana" / "remind me every Monday at 9 to send the
-- numbers": the Hetzner worker (lib/followups/todoReminders) pings the owner
-- in-app (cxo_followup_notices, plus email when they turned it on) at
-- remind_at. A one-off then gets reminded_at; a repeat (remind_rule) moves
-- remind_at to its next time. Idempotent: safe to run again.

alter table public.cxo_todos add column if not exists remind_at timestamptz;
alter table public.cxo_todos add column if not exists remind_rule text;
alter table public.cxo_todos add column if not exists reminded_at timestamptz;

alter table public.cxo_todos drop constraint if exists cxo_todos_remind_rule_check;
alter table public.cxo_todos add constraint cxo_todos_remind_rule_check
  check (remind_rule is null or remind_rule in ('daily', 'weekdays', 'weekly'));

-- The worker's one read: due and not yet sent.
create index if not exists cxo_todos_remind_due_idx on public.cxo_todos (remind_at)
  where remind_at is not null and reminded_at is null and deleted_at is null;
