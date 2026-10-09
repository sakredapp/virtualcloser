-- Boards — Suite CXO (ported from crmbuilds native boards).
--
-- A board belongs to the workspace (rep_id): everyone on the account sees
-- every board ("Mine" filters to the ones you made). Lists are the columns,
-- cards move between them, a card can carry a stage colour, a horizon, tags,
-- a due date, a checklist, and assignees. An assignee is either a member of
-- the workspace (the exec: shows on Today) or one of the exec's partners
-- (cxo_partners: they are emailed when assigned).
--
-- All access goes through the app's API routes on the service-role key; RLS is
-- on with no policies so nothing reaches these tables from the browser.
-- Idempotent. Run in the SuiteCXO Supabase project (ndschjbuyjmxtzqyjgyi).

create table if not exists cxo_boards (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references reps(id) on delete cascade,
  name        text not null default 'Untitled board',
  position    integer not null default 0,
  created_by  uuid references members(id) on delete set null,
  imported_from text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cxo_boards_rep_idx on cxo_boards (rep_id, position, created_at);

create table if not exists cxo_board_lists (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references cxo_boards(id) on delete cascade,
  rep_id      text not null references reps(id) on delete cascade,
  title       text not null default 'New list',
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists cxo_board_lists_board_idx on cxo_board_lists (board_id, position);

create table if not exists cxo_board_cards (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references cxo_boards(id) on delete cascade,
  list_id     uuid not null references cxo_board_lists(id) on delete cascade,
  rep_id      text not null references reps(id) on delete cascade,
  title       text not null default '',
  notes       text,
  label_color text,
  due_date    date,
  urgency     text check (urgency in ('now', 'week', 'later')),
  tags        text[] not null default '{}',
  position    integer not null default 0,
  done_at     timestamptz,
  created_by  uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists cxo_board_cards_board_idx on cxo_board_cards (board_id, list_id, position);

create table if not exists cxo_board_card_assignees (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references cxo_board_cards(id) on delete cascade,
  board_id    uuid not null references cxo_boards(id) on delete cascade,
  rep_id      text not null references reps(id) on delete cascade,
  member_id   uuid references members(id) on delete cascade,
  partner_id  uuid references cxo_partners(id) on delete cascade,
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  constraint cxo_board_card_assignees_one check ((member_id is null) <> (partner_id is null))
);
create unique index if not exists cxo_board_card_assignees_member_uq on cxo_board_card_assignees (card_id, member_id) where member_id is not null;
create unique index if not exists cxo_board_card_assignees_partner_uq on cxo_board_card_assignees (card_id, partner_id) where partner_id is not null;
create index if not exists cxo_board_card_assignees_member_idx on cxo_board_card_assignees (rep_id, member_id);

create table if not exists cxo_board_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references cxo_board_cards(id) on delete cascade,
  board_id    uuid not null references cxo_boards(id) on delete cascade,
  rep_id      text not null references reps(id) on delete cascade,
  text        text not null,
  done        boolean not null default false,
  position    integer not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists cxo_board_checklist_card_idx on cxo_board_checklist_items (card_id, position);

create or replace function cxo_boards_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists cxo_boards_touch on cxo_boards;
create trigger cxo_boards_touch before update on cxo_boards for each row execute function cxo_boards_touch();
drop trigger if exists cxo_board_cards_touch on cxo_board_cards;
create trigger cxo_board_cards_touch before update on cxo_board_cards for each row execute function cxo_boards_touch();

alter table cxo_boards enable row level security;
alter table cxo_board_lists enable row level security;
alter table cxo_board_cards enable row level security;
alter table cxo_board_card_assignees enable row level security;
alter table cxo_board_checklist_items enable row level security;
grant select, insert, update, delete on cxo_boards, cxo_board_lists, cxo_board_cards, cxo_board_card_assignees, cxo_board_checklist_items to service_role;
