-- Personal Mira memory for employee logins (Suite CXO, owner 10-10).
--
-- Execs keep the org-wide memory in plaud_agent_guidance. An employee's
-- "remember / forget / what have you learned" lives here instead, one row per
-- rule, keyed by tenant AND member, so it never reaches a coworker or the
-- exec-level org memory. The app reads and writes it with the service role
-- and always filters by rep_id + member_id.

create table if not exists public.agent_member_memory (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references public.reps(id) on delete cascade,
  member_id   uuid not null references public.members(id) on delete cascade,
  rule        text not null check (char_length(rule) between 1 and 500),
  kind        text not null default 'prefer' check (kind in ('avoid', 'prefer', 'correction', 'fact')),
  subject     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists agent_member_memory_member_idx
  on public.agent_member_memory (rep_id, member_id, active, created_at desc);

create or replace function public.agent_member_memory_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists agent_member_memory_touch on public.agent_member_memory;
create trigger agent_member_memory_touch before update on public.agent_member_memory
  for each row execute function public.agent_member_memory_touch();

alter table public.agent_member_memory enable row level security;
grant all on public.agent_member_memory to service_role;
