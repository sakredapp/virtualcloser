-- Partners migration — Suite CXO.
--
-- A partner is anyone an executive decides counts: a carrier rep, an agency
-- principal, a board member, a vendor, a key producer. The Partners page
-- lists them, shows who they are and what they are for, their next meeting
-- with us, and everything we have sent them. Every note, email, report or
-- task that goes out to a partner (from the page or from Mira) is a row in
-- cxo_partner_actions, so the partner's history is always on screen.
--
-- Idempotent. Run in the SuiteCXO Supabase project (ndschjbuyjmxtzqyjgyi).

create table if not exists cxo_partners (
  id               uuid primary key default gen_random_uuid(),
  rep_id           text not null references reps(id) on delete cascade,
  name             text not null,
  org              text,
  role             text,
  -- carrier | agency | board | vendor | producer | other
  kind             text not null default 'other',
  email            text,
  phone            text,
  notes            text,
  tags             text[] not null default '{}',
  owner_member_id  uuid references members(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint cxo_partners_kind_check
    check (kind in ('carrier', 'agency', 'board', 'vendor', 'producer', 'other'))
);

create index if not exists cxo_partners_rep_idx on cxo_partners (rep_id, kind, name);
create index if not exists cxo_partners_email_idx on cxo_partners (rep_id, lower(email));

create table if not exists cxo_partner_actions (
  id           uuid primary key default gen_random_uuid(),
  partner_id   uuid not null references cxo_partners(id) on delete cascade,
  rep_id       text not null references reps(id) on delete cascade,
  -- note | email | report | task
  kind         text not null,
  subject      text,
  body         text,
  -- draft | sent | done
  status       text not null default 'draft',
  sent_to      text,
  -- Which channel carried it (gmail | resend | none) and the provider id.
  channel      text,
  provider_id  text,
  created_by   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz,
  due_at       timestamptz,
  constraint cxo_partner_actions_kind_check
    check (kind in ('note', 'email', 'report', 'task', 'meeting')),
  constraint cxo_partner_actions_status_check
    check (status in ('draft', 'sent', 'done'))
);

create index if not exists cxo_partner_actions_partner_idx on cxo_partner_actions (partner_id, created_at desc);
create index if not exists cxo_partner_actions_rep_idx on cxo_partner_actions (rep_id, created_at desc);

-- Keep updated_at honest.
create or replace function cxo_partners_touch() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists cxo_partners_touch_trg on cxo_partners;
create trigger cxo_partners_touch_trg
  before update on cxo_partners
  for each row execute function cxo_partners_touch();

alter table cxo_partners enable row level security;
alter table cxo_partner_actions enable row level security;

-- All access is server-side through the service role. Tables created over a
-- direct postgres connection do NOT get Supabase's default grants, so state
-- them — and prove them, RAISE not WARN.
grant select, insert, update, delete on cxo_partners to service_role;
grant select, insert, update, delete on cxo_partner_actions to service_role;

do $$
begin
  if not has_table_privilege('service_role', 'cxo_partners', 'select, insert, update, delete') then
    raise exception 'cxo_partners grants missing for service_role';
  end if;
  if not has_table_privilege('service_role', 'cxo_partner_actions', 'select, insert, update, delete') then
    raise exception 'cxo_partner_actions grants missing for service_role';
  end if;
end $$;
