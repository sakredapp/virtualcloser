-- GHL contact ID migration
-- Adds crm_contact_id to leads so we can distinguish the GHL *contact* ID
-- (the person record) from crm_object_id (the opportunity/deal record).
-- In GHL, contacts and opportunities are separate entities with different IDs.
-- The crm_contact_id is needed to: add notes, send SMS via conversations API,
-- enroll contacts in workflows. crm_object_id is only used for stage moves.
--
-- mirrorLeadToGHL (lib/crm-sync.ts) already tries to write this column —
-- those writes were silently no-op'd until this migration runs.
--
-- Safe to run multiple times (idempotent).

alter table leads
  add column if not exists crm_contact_id text;

create index if not exists leads_crm_contact_idx
  on leads(rep_id, crm_source, crm_contact_id)
  where crm_contact_id is not null;
