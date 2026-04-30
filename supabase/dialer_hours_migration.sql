-- AI Dialer "hire-an-SDR" hour packaging.
--
-- Concept: tenants buy a weekly hour package (20/30/40/50/60 hrs/wk).
-- Hours flow through a 3-level hierarchy on enterprise:
--
--   tenant pool ─→ owner can grant to manager OR direct to rep
--                  manager ─→ can grant their pool to reps
--                             rep ─→ allocates their pool across dialer modes
--
-- Each row in dialer_hour_grants is one "this person gives this person this
-- many seconds for this week." Effective rep budget = sum(grants TO rep) -
-- any sub-grants FROM rep. Effective manager pool = grants TO them minus
-- whatever they passed down.
--
-- Mode allocations live in a separate table because the rep owns that split
-- regardless of who funded the grant. Shifts are a third layer — they say
-- WHEN within the week the dialer should run, regardless of mode budget.

-- ── Hour grants ─────────────────────────────────────────────────────────
create table if not exists dialer_hour_grants (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  -- ISO week start (Monday 00:00 in tenant timezone). Stored as a date so
  -- both rep budget calc and shift schedules can key on it.
  week_start          date not null,
  -- NULL granter = direct from tenant pool (owner action).
  -- Non-null granter = a manager passing hours down from their own pool.
  granter_member_id   uuid references members(id) on delete set null,
  -- Recipient. Always a member.
  grantee_member_id   uuid not null references members(id) on delete cascade,
  granted_seconds     integer not null check (granted_seconds >= 0),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  -- One row per (week, grantee, granter). Updates overwrite the count.
  unique (rep_id, week_start, grantee_member_id, granter_member_id)
);

create index if not exists dialer_hour_grants_rep_week_idx
  on dialer_hour_grants(rep_id, week_start);
create index if not exists dialer_hour_grants_grantee_week_idx
  on dialer_hour_grants(grantee_member_id, week_start);
create index if not exists dialer_hour_grants_granter_week_idx
  on dialer_hour_grants(granter_member_id, week_start)
  where granter_member_id is not null;

-- ── Mode allocations ────────────────────────────────────────────────────
-- The rep decides how to split their weekly budget across modes.
-- mode is the same enum as dialerSettings.DialerMode.
create table if not exists dialer_mode_allocations (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  member_id           uuid not null references members(id) on delete cascade,
  week_start          date not null,
  mode                text not null check (
    mode in ('concierge','appointment_setter','live_transfer','pipeline')
  ),
  allocated_seconds   integer not null check (allocated_seconds >= 0),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  unique (rep_id, member_id, week_start, mode)
);

create index if not exists dialer_mode_alloc_member_week_idx
  on dialer_mode_allocations(member_id, week_start);

-- ── Shifts ──────────────────────────────────────────────────────────────
-- Recurring weekly shift template. The dialer cron only places calls when
-- "now" (in the tenant's timezone) falls inside an active shift for that
-- member + mode. Mode null = the rep's choice based on remaining budget.
create table if not exists dialer_shifts (
  id                  uuid primary key default gen_random_uuid(),
  rep_id              text not null references reps(id) on delete cascade,
  member_id           uuid not null references members(id) on delete cascade,
  -- 0 = Monday, 6 = Sunday (ISO).
  weekday             smallint not null check (weekday between 0 and 6),
  start_minute        smallint not null check (start_minute between 0 and 1439),
  end_minute          smallint not null check (end_minute between 1 and 1440),
  mode                text check (
    mode is null or mode in ('concierge','appointment_setter','live_transfer','pipeline')
  ),
  is_active           boolean default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  check (end_minute > start_minute)
);

create index if not exists dialer_shifts_member_idx
  on dialer_shifts(member_id) where is_active = true;
create index if not exists dialer_shifts_rep_idx
  on dialer_shifts(rep_id) where is_active = true;

-- ── Weekly period support on usage_events ───────────────────────────────
-- Existing usage_events tracks period_year_month (YYYY-MM). The hour-pool
-- model is weekly, so we add a denormalized ISO week string.
alter table usage_events
  add column if not exists period_year_week text;

create index if not exists usage_events_rep_addon_week_idx
  on usage_events(rep_id, addon_key, period_year_week)
  where period_year_week is not null;

-- ── Pool mode + tenant timezone-aware Monday start ──────────────────────
alter table reps
  add column if not exists dialer_pool_mode text default 'per_rep'
    check (dialer_pool_mode in ('shared','per_rep'));

comment on column reps.dialer_pool_mode is
  'shared = any rep can dial against the tenant pool; per_rep = owner/manager grants explicit weekly hours to each rep. Default per_rep — most enterprise owners want this.';

-- ── Touch triggers ─────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'touch_updated_at') then
    create function touch_updated_at() returns trigger as $body$
    begin
      new.updated_at = now();
      return new;
    end;
    $body$ language plpgsql;
  end if;
end $$;

drop trigger if exists dialer_hour_grants_touch on dialer_hour_grants;
create trigger dialer_hour_grants_touch
  before update on dialer_hour_grants
  for each row execute function touch_updated_at();

drop trigger if exists dialer_mode_allocations_touch on dialer_mode_allocations;
create trigger dialer_mode_allocations_touch
  before update on dialer_mode_allocations
  for each row execute function touch_updated_at();

drop trigger if exists dialer_shifts_touch on dialer_shifts;
create trigger dialer_shifts_touch
  before update on dialer_shifts
  for each row execute function touch_updated_at();
