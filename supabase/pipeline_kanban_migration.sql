-- ============================================================================
-- Pipeline / Kanban migration.
--
-- One unified deal pipeline where a single prospects row tracks the deal
-- from first booking through paid sub. Adds:
--
--   pipeline_stage     — explicit Kanban column (admin-controlled + auto)
--   admin_notes        — Jace's own notes per deal
--   cart_id            — links a prospect to the cart they configured on the
--                        offer page (when "Book a call with this quote" is
--                        clicked OR when they go through Begin Build)
--   kickoff_call_at    — when the kickoff is scheduled
--   pipeline_position  — sort order within a column (for manual reordering)
--   stage_changed_at   — timestamp of last stage transition (for time-in-stage)
--
-- Stages (left → right on the board):
--   lead              — captured email, no booking yet
--   call_booked       — Cal.com booking landed
--   plan_generated    — Fathom call recorded + AI build plan generated
--   quote_sent        — clicked "Book a call with this quote" — cart attached
--   payment_made      — paid the build fee (rep_id set, billing_status=pending_activation)
--   kickoff_scheduled — kickoff call booked (kickoff_call_at set)
--   building          — admin marked build in progress
--   active            — subscription activated (billing_status=active)
--   lost              — deal lost / canceled
--
-- Idempotent.
-- ============================================================================

alter table prospects add column if not exists pipeline_stage text;
alter table prospects drop constraint if exists prospects_pipeline_stage_check;
alter table prospects add constraint prospects_pipeline_stage_check
  check (pipeline_stage in (
    'lead',
    'call_booked',
    'plan_generated',
    'quote_sent',
    'payment_made',
    'kickoff_scheduled',
    'building',
    'active',
    'lost'
  ));

alter table prospects add column if not exists admin_notes text;
alter table prospects add column if not exists cart_id uuid references carts(id) on delete set null;
alter table prospects add column if not exists kickoff_call_at timestamptz;
alter table prospects add column if not exists pipeline_position int default 0;
alter table prospects add column if not exists stage_changed_at timestamptz default now();

create index if not exists prospects_pipeline_stage_idx
  on prospects(pipeline_stage, pipeline_position) where pipeline_stage is not null;
create index if not exists prospects_cart_idx on prospects(cart_id) where cart_id is not null;

-- Backfill pipeline_stage for existing rows.
-- Rules in priority order:
--   rep is canceled/past_due → lost
--   rep billing_status='active' → active
--   rep billing_status='building' → building
--   rep has kickoff_call_at → kickoff_scheduled
--   rep has billing_status='pending_activation' or build_fee_paid_at → payment_made
--   prospect has cart_id → quote_sent
--   prospect has build_plan → plan_generated
--   prospect has meeting_at → call_booked
--   else → lead
update prospects p
set pipeline_stage = case
  when r.billing_status in ('canceled','past_due') then 'lost'
  when r.billing_status = 'active' then 'active'
  when r.billing_status = 'building' then 'building'
  when p.kickoff_call_at is not null and r.billing_status = 'pending_activation' then 'kickoff_scheduled'
  when r.billing_status = 'pending_activation' or r.build_fee_paid_at is not null then 'payment_made'
  when p.cart_id is not null then 'quote_sent'
  when p.build_plan is not null then 'plan_generated'
  when p.meeting_at is not null then 'call_booked'
  else 'lead'
end,
stage_changed_at = coalesce(stage_changed_at, p.updated_at, p.created_at, now())
from reps r
where p.rep_id = r.id and p.pipeline_stage is null;

-- For prospects with no rep, just use prospect-only signals.
update prospects
set pipeline_stage = case
  when status = 'lost' or status = 'canceled' then 'lost'
  when cart_id is not null then 'quote_sent'
  when build_plan is not null then 'plan_generated'
  when meeting_at is not null then 'call_booked'
  else 'lead'
end,
stage_changed_at = coalesce(stage_changed_at, updated_at, created_at, now())
where pipeline_stage is null;

-- Default for any future inserts without an explicit stage.
alter table prospects alter column pipeline_stage set default 'lead';

-- Touch trigger that bumps stage_changed_at whenever pipeline_stage changes.
create or replace function bump_stage_changed_at() returns trigger as $$
begin
  if new.pipeline_stage is distinct from old.pipeline_stage then
    new.stage_changed_at = now();
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists prospects_stage_changed_touch on prospects;
create trigger prospects_stage_changed_touch
  before update on prospects
  for each row execute function bump_stage_changed_at();
