-- Exec-to-exec messages through Mira (10-09). Members of the same org
-- (rep_id) message each other; never across orgs (enforced by trigger).
-- Text only. A 'request' also puts a linked to-do on the recipient's list.
create table if not exists member_messages (
  id uuid primary key default gen_random_uuid(),
  rep_id text not null,
  from_member_id uuid not null references members(id) on delete cascade,
  to_member_id uuid not null references members(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  kind text not null default 'message' check (kind in ('message', 'request', 'question', 'note')),
  deliver_at timestamptz not null default now(),
  read_at timestamptz,
  replied_to_id uuid references member_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (from_member_id <> to_member_id)
);
create index if not exists member_messages_to_idx on member_messages (to_member_id, deliver_at desc);
create index if not exists member_messages_from_idx on member_messages (from_member_id, created_at desc);
create index if not exists member_messages_reply_idx on member_messages (replied_to_id);
alter table member_messages enable row level security;
grant select, insert, update, delete on member_messages to service_role;

create or replace function member_messages_same_org() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from members where id = new.from_member_id and rep_id = new.rep_id)
     or not exists (select 1 from members where id = new.to_member_id and rep_id = new.rep_id) then
    raise exception 'member_messages: sender and recipient must both belong to org %', new.rep_id;
  end if;
  return new;
end;
$$;
drop trigger if exists member_messages_same_org on member_messages;
create trigger member_messages_same_org before insert or update of rep_id, from_member_id, to_member_id
  on member_messages for each row execute function member_messages_same_org();

-- Requests land on the recipient's to-do list, linked back to the message.
alter table cxo_todos drop constraint if exists cxo_todos_source_check;
alter table cxo_todos add constraint cxo_todos_source_check check (source = any (array['manual', 'meeting', 'partner', 'mira', 'message']));
alter table cxo_todos drop constraint if exists cxo_todos_link_kind_check;
alter table cxo_todos add constraint cxo_todos_link_kind_check check (link_kind is null or link_kind = any (array['partner', 'agent', 'meeting', 'card', 'message']));
