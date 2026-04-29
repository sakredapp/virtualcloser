-- Track add-on requests from reps so admin sees them in one place.
--
-- Why a separate table (vs. status='requested' on client_addons)? Because
-- client_addons rows require monthly_price_cents + cap_unit at insert time
-- (NOT NULL), and we don't lock those numbers until admin confirms. Putting
-- requests in their own table also keeps the billing rollups clean.

create table if not exists addon_requests (
  id            uuid primary key default gen_random_uuid(),
  rep_id        text not null references reps(id) on delete cascade,
  member_id     uuid references members(id) on delete set null,
  addon_key     text not null,
  status        text not null default 'pending'
                check (status in ('pending','approved','rejected')),
  notes         text,
  created_at    timestamptz default now(),
  resolved_at   timestamptz,
  resolved_by   text
);

-- Surfaces "what's on the queue" cheaply for the admin dashboard.
create index if not exists addon_requests_pending_idx
  on addon_requests(rep_id, addon_key)
  where status = 'pending';
