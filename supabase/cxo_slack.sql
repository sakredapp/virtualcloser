-- Ciao in Slack (Suite CXO). Idempotent; safe to run more than once.
--
-- 1) cxo_slack_installs: one Slack workspace per company. The bot token is
--    AES-256-GCM encrypted (lib/slack/shared slackSecretKey, same scheme as
--    the Google tokens). One workspace belongs to one company only.
-- 2) cxo_slack_threads: a short history per Slack thread so follow-ups work.
-- 3) cxo_mira_approvals gains reason 'slack_hold': something asked for in
--    Slack that sends or changes something waits for the asker's own yes in
--    the app.

create table if not exists public.cxo_slack_installs (
  rep_id text primary key,
  team_id text not null,
  team_name text,
  bot_user_id text not null,
  bot_token_enc text not null,
  installed_by uuid references public.members(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cxo_slack_installs_team_uq on public.cxo_slack_installs (team_id);
alter table public.cxo_slack_installs enable row level security;
revoke all on public.cxo_slack_installs from anon, authenticated;
grant select, insert, update, delete on public.cxo_slack_installs to service_role;

create table if not exists public.cxo_slack_threads (
  rep_id text not null,
  team_id text not null,
  channel text not null,
  thread_ts text not null,
  member_id uuid not null references public.members(id) on delete cascade,
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (team_id, channel, thread_ts, member_id)
);
create index if not exists cxo_slack_threads_rep_idx on public.cxo_slack_threads (rep_id, updated_at desc);
alter table public.cxo_slack_threads enable row level security;
revoke all on public.cxo_slack_threads from anon, authenticated;
grant select, insert, update, delete on public.cxo_slack_threads to service_role;

do $$
begin
  if to_regclass('public.cxo_mira_approvals') is not null then
    alter table public.cxo_mira_approvals drop constraint if exists cxo_mira_approvals_reason_check;
    alter table public.cxo_mira_approvals add constraint cxo_mira_approvals_reason_check
      check (reason in ('outside_send', 'others_work', 'slack_hold'));
  end if;
end $$;

notify pgrst, 'reload schema';
