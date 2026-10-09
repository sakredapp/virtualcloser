-- Partners → shared contact directory — Suite CXO.
--
-- The Partners page becomes the exec team's one address book: executive
-- partners first (flag the ones who are on Suite CXO too), then carrier reps,
-- vendors and everyone else. Extends cxo_partners in place (additive only);
-- every existing partner feature (threads, meetings, compose, actions) keeps
-- reading the same rows. Contacts are shared org-wide: rep_id is the org.
--
--   email          = primary email      phone            = mobile phone
--   email_secondary, email_support      phone_office (+ phone_office_ext)
--   website, address, tags (carrier name, product line), notes
--
-- search_text is one lowercased blob of name, company, role, every email and
-- every phone (as typed and digits only) plus tags, kept by a trigger, so the
-- directory search is a single server-side ILIKE per word.
--
-- Idempotent. Run in the SuiteCXO Supabase project (ndschjbuyjmxtzqyjgyi).

alter table cxo_partners add column if not exists on_platform      boolean not null default false;
alter table cxo_partners add column if not exists email_secondary  text;
alter table cxo_partners add column if not exists email_support    text;
alter table cxo_partners add column if not exists phone_office     text;
alter table cxo_partners add column if not exists phone_office_ext text;
alter table cxo_partners add column if not exists website          text;
alter table cxo_partners add column if not exists address          text;
alter table cxo_partners add column if not exists search_text      text not null default '';

-- New type 'executive' (Executive partner). The older kinds stay valid; the
-- page files agency/board/producer under "Other".
alter table cxo_partners drop constraint if exists cxo_partners_kind_check;
alter table cxo_partners add constraint cxo_partners_kind_check
  check (kind in ('executive', 'carrier', 'agency', 'board', 'vendor', 'producer', 'other'));

create or replace function cxo_partners_search_text() returns trigger
language plpgsql as $$
begin
  new.search_text := lower(
    coalesce(new.name, '') || ' ' || coalesce(new.org, '') || ' ' || coalesce(new.role, '') || ' ' ||
    coalesce(new.email, '') || ' ' || coalesce(new.email_secondary, '') || ' ' || coalesce(new.email_support, '') || ' ' ||
    coalesce(new.phone, '') || ' ' || coalesce(new.phone_office, '') || ' ' ||
    regexp_replace(coalesce(new.phone, ''), '\D', '', 'g') || ' ' ||
    regexp_replace(coalesce(new.phone_office, ''), '\D', '', 'g') || ' ' ||
    coalesce(array_to_string(new.tags, ' '), '')
  );
  return new;
end $$;

drop trigger if exists cxo_partners_search_trg on cxo_partners;
create trigger cxo_partners_search_trg
  before insert or update on cxo_partners
  for each row execute function cxo_partners_search_text();

-- Backfill rows that predate the trigger.
update cxo_partners set search_text = search_text where search_text = '';

-- Import dedupe on name + company (email already has cxo_partners_email_idx).
create index if not exists cxo_partners_name_org_idx on cxo_partners (rep_id, lower(name), lower(coalesce(org, '')));
-- Row counts were 0 at ship (10-09); add a pg_trgm GIN on search_text if an
-- org ever passes ~5k contacts.

grant select, insert, update, delete on cxo_partners to service_role;
do $$
begin
  if not has_table_privilege('service_role', 'cxo_partners', 'select, insert, update, delete') then
    raise exception 'cxo_partners grants missing for service_role';
  end if;
end $$;
