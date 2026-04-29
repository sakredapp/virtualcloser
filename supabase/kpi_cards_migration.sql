-- User-defined KPI cards for the dashboard.
--
-- Reps tell Telegram "I made 100 dials, 25 convos, 5 sets today" and the
-- bot logs entries here + (after a YES confirmation) creates a card so the
-- metric becomes a permanent widget on /dashboard.
--
-- Why a separate table from dialer_kpis: dialer_kpis is a fixed-shape
-- rollup auto-fed by the WAVV dialer webhook. kpi_cards are arbitrary,
-- user-defined widgets — anything the rep wants to track daily (door knocks,
-- emails sent, demos given, push-ups, whatever) without us having to ship a
-- column for it.

create table if not exists kpi_cards (
  id          uuid primary key default gen_random_uuid(),
  rep_id      text not null references reps(id) on delete cascade,
  member_id   uuid references members(id) on delete cascade,
  metric_key  text not null,
  label       text not null,
  unit        text,
  period      text not null default 'day' check (period in ('day','week','month')),
  goal_value  numeric,
  sort_order  int default 0,
  archived_at timestamptz,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- One active card per (member, metric, period). NULL member_id means an
-- account-level card; we treat it as a distinct slot via coalesce.
create unique index if not exists kpi_cards_member_metric_idx
  on kpi_cards(rep_id, coalesce(member_id, '00000000-0000-0000-0000-000000000000'::uuid), metric_key, period)
  where archived_at is null;

create index if not exists kpi_cards_rep_active_idx
  on kpi_cards(rep_id) where archived_at is null;

create table if not exists kpi_entries (
  id           uuid primary key default gen_random_uuid(),
  kpi_card_id  uuid not null references kpi_cards(id) on delete cascade,
  rep_id       text not null references reps(id) on delete cascade,
  member_id    uuid references members(id) on delete cascade,
  day          date not null,
  value        numeric not null default 0,
  note         text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

create unique index if not exists kpi_entries_card_day_idx
  on kpi_entries(kpi_card_id, day);

create index if not exists kpi_entries_member_day_idx
  on kpi_entries(rep_id, member_id, day desc);

-- Feature requests captured by the bot ("you should add X", "feature
-- request: Y") and emailed to the admin. Stored here so admins can also
-- see them inside the app later.
create table if not exists feature_requests (
  id         uuid primary key default gen_random_uuid(),
  rep_id     text not null references reps(id) on delete cascade,
  member_id  uuid references members(id) on delete set null,
  source     text not null default 'telegram',
  summary    text not null,
  context    text,
  status     text not null default 'new'
                check (status in ('new','triaged','planned','shipped','wont_do')),
  created_at timestamptz default now()
);

create index if not exists feature_requests_rep_idx
  on feature_requests(rep_id, created_at desc);
