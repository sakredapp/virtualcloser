-- Per-member Google Calendar tokens.
--
-- Today google_tokens has a single row per tenant (rep_id is PK). For
-- enterprise we need each member to connect their own Google account so the
-- AI assistant, AI dialer, and dashboard calendar all read/write the right
-- person's calendar.
--
-- After this migration:
--   - member_id NULL  → tenant-level token (legacy, individual tier)
--   - member_id NOT NULL → per-member token (enterprise)
--
-- Lookup order in lib/google.ts: try (rep_id, member_id) first, fall back to
-- (rep_id, NULL). Existing single-tenant accounts keep working untouched.

alter table google_tokens
  add column if not exists member_id uuid references members(id) on delete cascade;

-- Drop the old PK on rep_id (we now allow many rows per rep_id) and add a
-- surrogate id PK so future ON CONFLICT clauses have something to anchor to.
alter table google_tokens
  add column if not exists id uuid default gen_random_uuid();

update google_tokens set id = gen_random_uuid() where id is null;

alter table google_tokens
  alter column id set not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'google_tokens_pkey' and conrelid = 'google_tokens'::regclass
  ) then
    alter table google_tokens drop constraint google_tokens_pkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'google_tokens_id_pkey' and conrelid = 'google_tokens'::regclass
  ) then
    alter table google_tokens add constraint google_tokens_id_pkey primary key (id);
  end if;
end $$;

-- At most one tenant-level token per rep
create unique index if not exists google_tokens_rep_tenant_unique
  on google_tokens(rep_id) where member_id is null;

-- At most one token per (rep_id, member_id)
create unique index if not exists google_tokens_rep_member_unique
  on google_tokens(rep_id, member_id) where member_id is not null;

create index if not exists google_tokens_member_idx
  on google_tokens(member_id) where member_id is not null;
