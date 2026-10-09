-- Storage (owner 10-09): the mirror keeps only the Airtable fields the
-- rollups, the Team people stats and the dedupe/sweep actually read. Every
-- insert/update is trimmed by a trigger, so no code path can store the full
-- blob again. To use a new field: add it here, then force a full sync
-- (/api/cron/pinnacle-sync?force=1) so existing rows pick it up.
create or replace function pinnacle_field_whitelist() returns text[]
language sql immutable as $$
  select array[
    -- policies
    'Policy Number','Effective Date','Pinnacle Recording Date','Annual Premium','Summary Status',
    'Carrier','Product Name','State','Pinnacle Team Member','Created','Last Modified',
    -- names / teams (all bases)
    'Agency','Agent','Agent Name','Full Name','First Name','Last Name','Name','NPN',
    'Team','Team Name','Team (Parsed)','Team (parsed)','Team (Parsed for Score)',
    -- directory people stats
    'Agent Created On:','Agent Status','Last Agent Status Change','First Sale?',
    'First Sale Status Change','First $5K in Sales','First $10K in Sales',
    -- directory contact, for the Call / Draft email action on an agent to-do
    'Phone','Phone Number','Mobile','Mobile Phone','Cell','Cell Phone','Email','Email Address'
  ]
$$;

create or replace function pinnacle_trim_fields() returns trigger
language plpgsql as $$
begin
  new.fields := coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(new.fields) as e(k, v)
    where k = any (pinnacle_field_whitelist())
  ), '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists pinnacle_trim_fields on pinnacle_airtable_records;
create trigger pinnacle_trim_fields before insert or update of fields on pinnacle_airtable_records
for each row execute function pinnacle_trim_fields();
