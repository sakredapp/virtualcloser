-- Exec assistant seats (owner 10-09): "each person can still have an assistant
-- on their thing". An assistant is a member with role 'assistant'; each link
-- below says which exec they work for. One assistant may serve several execs
-- (a switcher picks whose work they are doing). Removing = is_active false.
-- Service-role only, like every cxo table.

-- 1) Allow the role. Rebuilt from the live list so a role another migration
--    added (e.g. 'employee') is kept.
do $$
declare
  roles text[];
begin
  select coalesce(array_agg(distinct r), array['owner','admin','manager','rep','observer'])
    into roles
    from (
      select (regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''', 'g'))[1] as r
        from pg_constraint c
       where c.conrelid = 'public.members'::regclass and c.conname = 'members_role_check'
    ) x;
  if not ('assistant' = any(roles)) then
    roles := array_append(roles, 'assistant'::text);
  end if;
  execute 'alter table public.members drop constraint if exists members_role_check';
  execute format(
    'alter table public.members add constraint members_role_check check (role = any (%L::text[]))',
    roles
  );
end $$;

-- 2) Which exec each assistant works for.
create table if not exists cxo_exec_assistants (
  id                   uuid primary key default gen_random_uuid(),
  rep_id               text not null references reps(id) on delete cascade,
  exec_member_id       uuid not null references members(id) on delete cascade,
  assistant_member_id  uuid not null references members(id) on delete cascade,
  is_active            boolean not null default true,
  created_by           uuid references members(id) on delete set null,
  created_at           timestamptz not null default now(),
  removed_at           timestamptz,
  unique (exec_member_id, assistant_member_id),
  check (exec_member_id <> assistant_member_id)
);
create index if not exists cxo_exec_assistants_assistant_idx on cxo_exec_assistants (assistant_member_id) where is_active;
create index if not exists cxo_exec_assistants_exec_idx on cxo_exec_assistants (rep_id, exec_member_id);

-- 3) What an assistant did, for whom ("by Pat for Mike").
create table if not exists cxo_assistant_activity (
  id                   uuid primary key default gen_random_uuid(),
  rep_id               text not null references reps(id) on delete cascade,
  assistant_member_id  uuid not null references members(id) on delete cascade,
  exec_member_id       uuid not null references members(id) on delete cascade,
  area                 text not null check (area in ('boards', 'messages', 'todos', 'calendar', 'meetings')),
  action               text not null,
  summary              text not null default '',
  created_at           timestamptz not null default now()
);
create index if not exists cxo_assistant_activity_exec_idx on cxo_assistant_activity (rep_id, exec_member_id, created_at desc);
create index if not exists cxo_assistant_activity_assistant_idx on cxo_assistant_activity (assistant_member_id, created_at desc);

-- 4) Labels on the rows the app already shows.
alter table member_messages add column if not exists acted_by_member_id uuid references members(id) on delete set null;
alter table member_messages add column if not exists acted_by_name text;
alter table cxo_todos add column if not exists acted_by_member_id uuid references members(id) on delete set null;
alter table cxo_todos add column if not exists acted_by_name text;
alter table cxo_board_cards add column if not exists acted_by_member_id uuid references members(id) on delete set null;
alter table cxo_board_cards add column if not exists acted_by_name text;

alter table cxo_exec_assistants enable row level security;
alter table cxo_assistant_activity enable row level security;
revoke all on cxo_exec_assistants from anon, authenticated;
revoke all on cxo_assistant_activity from anon, authenticated;
grant select, insert, update, delete on cxo_exec_assistants to service_role;
grant select, insert, update, delete on cxo_assistant_activity to service_role;
notify pgrst, 'reload schema';
