-- Seat caps for enterprise tenants.
--
-- The super-admin (platform owner) sets max_seats per tenant as the billing
-- lever for how many reps an enterprise can invite. NULL = no cap (legacy /
-- individual tier — not enforced).
--
-- AI dialer minutes and roleplay minutes are NOT duplicated here; those caps
-- already live in client_addons.cap_value with usage tracked via usage_events.
-- Seat count is the one thing that doesn't fit the per-addon model since it
-- gates *invitation* (org-shape) rather than per-period consumption.

alter table reps
  add column if not exists max_seats int default null;

comment on column reps.max_seats is
  'Max member seats the tenant can invite. NULL = no cap. Set by super-admin only.';
