-- Lead activity tracking: link brain_items to leads so follow-up tasks
-- created via Telegram show up on the per-lead detail page.
alter table brain_items
  add column if not exists lead_id uuid references leads(id) on delete set null;

create index if not exists brain_items_lead_idx
  on brain_items(rep_id, lead_id)
  where lead_id is not null;

-- GHL contact sync: store the GHL contact ID on a lead so updates go to
-- the right contact without re-searching by email every time.
alter table leads
  add column if not exists crm_contact_id text;

create index if not exists leads_crm_contact_id_idx
  on leads(rep_id, crm_contact_id)
  where crm_contact_id is not null;
