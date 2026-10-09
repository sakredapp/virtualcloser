-- Several Google accounts per person.
--
-- Executives have more than one calendar: two Google accounts, or Google plus
-- a shared mailbox. google_tokens used to allow ONE row per (rep_id, member_id)
-- via two partial unique indexes. This migration turns that into a list: one
-- row per Google account, told apart by email.
--
-- Backward compatible: existing rows are untouched, lib/google.ts still reads
-- the oldest row for a (rep_id, member_id) when no account is named, and the
-- OAuth callback updates the row with the same email instead of adding one.
-- Until this runs, lib/google.ts keeps today's one-account behaviour and
-- "Add another calendar" reports the limit instead of overwriting.

drop index if exists google_tokens_rep_tenant_unique;
drop index if exists google_tokens_rep_member_unique;

-- One row per Google account per person. member_id null = the owner slot.
create unique index if not exists google_tokens_rep_member_email_unique
  on google_tokens(rep_id, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(coalesce(email, '')));

create index if not exists google_tokens_rep_member_created_idx
  on google_tokens(rep_id, member_id, created_at);
