-- Suite CXO employee ops layer (10-10): follow-up notices, recurring reports,
-- the approvals queue and Mira's audit log. All four are service-role only:
-- RLS on, no policies, anon/authenticated revoked. The app and the Hetzner
-- worker read and write them with the service role, always scoped by rep_id.
-- Nothing runs for a tenant unless reps.settings.cxo_employee_ops = true.

-- 1) Follow-up notices: what Mira told someone in-app, and the idempotency
--    ledger. One row per (rep_id, key); a key that exists is never sent again.
create table if not exists public.cxo_followup_notices (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  key text not null,
  kind text not null check (kind in ('nudge', 'escalate', 'close', 'report', 'approval', 'approval_result')),
  item_kind text check (item_kind is null or item_kind in ('request', 'card', 'meeting', 'report', 'approval')),
  item_id text,
  title text not null check (char_length(title) between 1 and 300),
  body text check (body is null or char_length(body) <= 8000),
  href text,
  due_date date,
  read_at timestamptz,
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists cxo_followup_notices_key_uq on public.cxo_followup_notices (rep_id, key);
create index if not exists cxo_followup_notices_member_idx on public.cxo_followup_notices (rep_id, member_id, created_at desc);
create index if not exists cxo_followup_notices_item_idx on public.cxo_followup_notices (rep_id, item_id);
alter table public.cxo_followup_notices enable row level security;
revoke all on public.cxo_followup_notices from anon, authenticated;
grant select, insert, update, delete on public.cxo_followup_notices to service_role;

-- 2) Recurring reports an exec sets up by asking Mira ("every Monday send me
--    open requests by person"). Run by the Hetzner worker; delivered in-app
--    plus email to that member only.
create table if not exists public.cxo_report_jobs (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  kind text not null check (kind in ('open_by_person', 'overdue', 'waiting_on', 'my_open')),
  cadence text not null default 'weekly' check (cadence in ('daily', 'weekly')),
  weekday smallint check (weekday is null or weekday between 0 and 6),
  hour smallint not null default 8 check (hour between 0 and 23),
  paused boolean not null default false,
  next_run_at timestamptz not null,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cxo_report_jobs_due_idx on public.cxo_report_jobs (next_run_at) where paused = false;
create index if not exists cxo_report_jobs_member_idx on public.cxo_report_jobs (rep_id, member_id);
alter table public.cxo_report_jobs enable row level security;
revoke all on public.cxo_report_jobs from anon, authenticated;
grant select, insert, update, delete on public.cxo_report_jobs to service_role;

-- 3) Approvals queue: a Mira action that sends outside the company or
--    changes someone else's work, waiting for an executive's OK.
create table if not exists public.cxo_mira_approvals (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  requested_by uuid not null references public.members(id) on delete cascade,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  summary text not null,
  reason text not null check (reason in ('outside_send', 'others_work')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined', 'executed', 'failed')),
  decided_by uuid references public.members(id) on delete set null,
  decided_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists cxo_mira_approvals_pending_idx on public.cxo_mira_approvals (rep_id, status, created_at desc);
alter table public.cxo_mira_approvals enable row level security;
revoke all on public.cxo_mira_approvals from anon, authenticated;
grant select, insert, update, delete on public.cxo_mira_approvals to service_role;

-- 4) Audit log: one row per Mira action. Employees see their own rows,
--    executives see their company's (enforced in lib/ops/audit.ts).
create table if not exists public.cxo_mira_audit (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  member_id uuid references public.members(id) on delete set null,
  tool text not null,
  args_summary jsonb not null default '{}'::jsonb,
  result text not null check (result in ('ok', 'not_done', 'error', 'refused', 'queued')),
  approved boolean,
  action_id uuid references public.cxo_mira_approvals(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cxo_mira_audit_rep_idx on public.cxo_mira_audit (rep_id, created_at desc);
create index if not exists cxo_mira_audit_member_idx on public.cxo_mira_audit (rep_id, member_id, created_at desc);
alter table public.cxo_mira_audit enable row level security;
revoke all on public.cxo_mira_audit from anon, authenticated;
grant select, insert, update, delete on public.cxo_mira_audit to service_role;
