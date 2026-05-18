-- outbound_messages dedupe: partial unique on (rep_id, external_id).
--
-- Background: BlueBubbles (and probably other inbound channels) occasionally
-- retry the same webhook delivery, which used to double-insert the same
-- message. The BlueBubbles webhook now short-circuits if it sees an existing
-- row with the same external_id, but a concurrent retry could still race
-- between the SELECT and the INSERT. This index makes that race race-safe:
-- the second INSERT trips a 23505 unique violation, which the webhook
-- handler converts into a "deduped" 200.
--
-- Partial because external_id is nullable (outbound sends sometimes don't
-- have an external id yet — those rows must still be allowed without
-- collision).

create unique index if not exists outbound_messages_rep_external_idx
  on public.outbound_messages (rep_id, external_id)
  where external_id is not null;
