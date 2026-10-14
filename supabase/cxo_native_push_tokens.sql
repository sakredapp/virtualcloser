-- ============================================================================
-- Suite CXO store app: one row per phone that allowed notifications.
--
-- Written by POST /api/native/push-token (service role only). Nothing reads
-- it yet; a push sender comes later. Applied on Suite CXO 2026-10-14.
-- A token belongs to one phone, so signing in as someone else on the same
-- phone moves the row to that member.
-- ============================================================================

create table if not exists cxo_native_push_tokens (
  token         text primary key,
  platform      text not null check (platform in ('ios', 'android')),
  rep_id        text not null references reps(id) on delete cascade,
  member_id     uuid not null references members(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists cxo_native_push_tokens_member_idx
  on cxo_native_push_tokens(rep_id, member_id);

alter table cxo_native_push_tokens enable row level security;
revoke all on cxo_native_push_tokens from anon, authenticated;

grant select, insert, update, delete on cxo_native_push_tokens to service_role;
