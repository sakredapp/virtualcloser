-- Suite CXO baseline schema for a self-hosted box: the live Suite CXO database's
-- public schema (tables, constraints, functions, indexes, triggers, RLS), SCHEMA
-- ONLY, no rows. Generated 2026-10-22 from the system catalogs (read-only query
-- through the Supabase Management API) because supabase/*.sql is not a full
-- history: some live tables (plaud_notes, onboarding_tokens, lead_events, ...)
-- were never created by a file in the repo.
--
-- selfhost/db/migrate.sh applies this on a fresh box, marks every migration
-- listed above the "# baseline" line in migrations.txt as covered, and then
-- applies only the files listed after it. Regenerate it with
-- selfhost/db/baseline-generate.sql when the live schema moves on.
set check_function_bodies = off;

create sequence if not exists public.pinnacle_maintenance_log_id_seq;

create sequence if not exists public.pinnacle_sync_table_runs_id_seq;

create table if not exists public.addon_requests (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  addon_key text not null,
  status text default 'pending'::text not null,
  notes text,
  created_at timestamp with time zone default now(),
  resolved_at timestamp with time zone,
  resolved_by text
);

create table if not exists public.agent_actions (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid,
  action_type text not null,
  content text,
  status text default 'pending'::text,
  created_at timestamp with time zone default now(),
  owner_member_id uuid
);

create table if not exists public.agent_billing (
  id uuid default gen_random_uuid() not null,
  member_id uuid not null,
  rep_id text not null,
  payer_model text default 'self'::text not null,
  stripe_customer_id text,
  stripe_payment_method_id text,
  stripe_subscription_id text,
  card_brand text,
  card_last4 text,
  card_exp_month smallint,
  card_exp_year smallint,
  status text default 'pending_setup'::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  weekly_hours_quota integer default 0,
  overflow_enabled boolean default false not null,
  volume_tier text default 't1'::text,
  cancel_at_week_end boolean default false not null,
  current_week_start timestamp with time zone,
  current_week_end timestamp with time zone
);

create table if not exists public.agent_billing_event (
  id uuid default gen_random_uuid() not null,
  stripe_event_id text not null,
  event_type text not null,
  member_id uuid,
  rep_id text,
  payload jsonb default '{}'::jsonb not null,
  processed_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

create table if not exists public.agent_billing_week (
  id uuid default gen_random_uuid() not null,
  member_id uuid not null,
  rep_id text not null,
  iso_week text not null,
  week_start timestamp with time zone not null,
  week_end timestamp with time zone not null,
  planned_hours numeric(8,2) default 0 not null,
  consumed_seconds integer default 0 not null,
  overage_hours numeric(8,2) default 0 not null,
  status text default 'open'::text not null,
  stripe_invoice_id text,
  invoice_paid_at timestamp with time zone,
  overage_pushed_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.agent_history (
  id uuid default gen_random_uuid() not null,
  member_id uuid not null,
  rep_id text not null,
  role text not null,
  content text not null,
  listed_tasks jsonb,
  created_at timestamp with time zone default now(),
  conversation_id uuid,
  answer_check jsonb
);

create table if not exists public.agent_member_memory (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  rule text not null,
  kind text default 'prefer'::text not null,
  subject text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.agent_runs (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  run_type text not null,
  leads_processed integer default 0,
  actions_created integer default 0,
  status text default 'success'::text,
  error text,
  created_at timestamp with time zone default now()
);

create table if not exists public.agent_usage (
  rep_id text not null,
  member_id uuid not null,
  day date not null,
  requests integer default 0 not null,
  input_tokens integer default 0 not null,
  output_tokens integer default 0 not null,
  tool_calls integer default 0 not null,
  errors integer default 0 not null,
  updated_at timestamp with time zone default now(),
  model text,
  est_cost_usd numeric(12,6) default 0 not null
);

create table if not exists public.ai_salespeople (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text not null,
  status text default 'draft'::text not null,
  product_category text,
  assigned_member_id uuid,
  appointment_type text default 'phone'::text,
  appointment_duration_min integer default 30,
  product_intent jsonb default '{}'::jsonb,
  voice_persona jsonb default '{}'::jsonb,
  call_script jsonb default '{}'::jsonb,
  sms_scripts jsonb default '{}'::jsonb,
  email_templates jsonb default '{}'::jsonb,
  objection_responses jsonb default '[]'::jsonb,
  schedule jsonb default '{}'::jsonb,
  calendar jsonb default '{}'::jsonb,
  crm_push jsonb default '{}'::jsonb,
  phone_number text,
  phone_provider text,
  created_by_member_id uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  archived_at timestamp with time zone,
  sms_ai_enabled boolean default false not null,
  sms_daily_cap integer default 50 not null
);

create table if not exists public.ai_salesperson_campaigns (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  ai_salesperson_id uuid not null,
  name text not null,
  source text,
  opt_in_confirmed boolean default false,
  notes text,
  created_by_member_id uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.ai_salesperson_followups (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  ai_salesperson_id uuid not null,
  lead_id uuid,
  queue_id uuid,
  source_call_id uuid,
  due_at timestamp with time zone not null,
  channel text not null,
  reason text,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  context jsonb
);

create table if not exists public.ai_wallet_ledger (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  kind text not null,
  amount_cents integer not null,
  session_id uuid,
  note text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.ai_wallets (
  rep_id text not null,
  balance_cents integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.app_errors (
  id uuid default gen_random_uuid() not null,
  occurred_at timestamp with time zone default now() not null,
  severity text default 'error'::text not null,
  source text not null,
  rep_id text,
  member_id uuid,
  error_type text not null,
  message text not null,
  stack text,
  context jsonb default '{}'::jsonb not null
);

create table if not exists public.audit_events (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  action text not null,
  entity_type text,
  entity_id text,
  diff jsonb,
  ip text,
  user_agent text,
  created_at timestamp with time zone default now()
);

create table if not exists public.billing_audit (
  id uuid default gen_random_uuid() not null,
  actor_kind text not null,
  actor_id text,
  action text not null,
  rep_id text,
  member_id uuid,
  stripe_object_id text,
  amount_cents integer,
  before jsonb,
  after jsonb,
  notes text,
  created_at timestamp with time zone default now(),
  whop_object_id text
);

create table if not exists public.billing_change_requests (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  requested_by uuid not null,
  target_member_id uuid,
  kind text not null,
  payload jsonb default '{}'::jsonb not null,
  status text default 'open'::text not null,
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.billing_periods (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  period_year_month text not null,
  status text default 'open'::text not null,
  total_revenue_cents integer default 0 not null,
  total_our_cost_cents integer default 0 not null,
  total_margin_cents integer default 0 not null,
  addon_usage jsonb default '{}'::jsonb not null,
  cap_overrides jsonb default '{}'::jsonb,
  closed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.brain_dumps (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  raw_text text not null,
  summary text,
  source text default 'mic'::text,
  created_at timestamp with time zone default now(),
  owner_member_id uuid,
  title text
);

create table if not exists public.brain_items (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  brain_dump_id uuid,
  item_type text not null,
  content text not null,
  priority text default 'normal'::text,
  horizon text,
  due_date date,
  status text default 'open'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  owner_member_id uuid,
  deleted_at timestamp with time zone,
  lead_id uuid,
  search_tsv tsvector generated always as (to_tsvector('english'::regconfig, COALESCE(content, ''::text))) stored
);

create table if not exists public.call_logs (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid,
  contact_name text not null,
  summary text not null,
  outcome text,
  next_step text,
  duration_minutes integer,
  occurred_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  owner_member_id uuid,
  team_id uuid,
  commission_amount numeric,
  commission_currency text default 'USD'::text
);

create table if not exists public.carts (
  id uuid default gen_random_uuid() not null,
  email text,
  display_name text,
  company text,
  phone text,
  tier text default 'individual'::text not null,
  rep_count integer default 1 not null,
  weekly_hours integer default 0 not null,
  trainer_weekly_hours integer default 0 not null,
  overflow_enabled boolean default false not null,
  addons jsonb default '[]'::jsonb not null,
  computed_total_cents integer,
  metadata jsonb default '{}'::jsonb not null,
  expires_at timestamp with time zone default (now() + '24:00:00'::interval) not null,
  checkout_session_id text,
  converted_rep_id text,
  converted_member_id uuid,
  converted_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.ciao_chat_folders (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  name text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.ciao_conversations (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  started_at timestamp with time zone default now() not null,
  last_at timestamp with time zone default now() not null,
  title text,
  pinned_at timestamp with time zone,
  folder_id uuid,
  deleted_at timestamp with time zone
);

create table if not exists public.client_addons (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  addon_key text not null,
  status text default 'active'::text not null,
  monthly_price_cents integer not null,
  cap_value integer,
  cap_unit text not null,
  source text default 'admin_cart'::text not null,
  locked_price_until timestamp with time zone,
  activated_at timestamp with time zone default now(),
  paused_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.client_events (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  kind text not null,
  title text not null,
  body text,
  created_at timestamp with time zone default now()
);

create table if not exists public.client_integrations (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  key text not null,
  label text not null,
  kind text not null,
  config jsonb default '{}'::jsonb,
  is_active boolean default true,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.commission_entries (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  agent_name text,
  client_name text,
  carrier text,
  product text,
  premium numeric default 0,
  commission_amount numeric default 0,
  commission_rate numeric,
  status text default 'expected'::text not null,
  deposit_id uuid,
  sale_date date,
  paid_on date,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.cxo_activity (
  rep_id text not null,
  member_id uuid not null,
  day date not null,
  path text not null,
  count integer default 1 not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_allowance_tiers (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  year integer not null,
  carrier text not null,
  period text default 'quarter'::text not null,
  threshold numeric not null,
  unlocks text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_assistant_activity (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  assistant_member_id uuid not null,
  exec_member_id uuid not null,
  area text not null,
  action text not null,
  summary text default ''::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_behind_watch (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  employee_id uuid not null,
  behind boolean default false not null,
  notified_items text[] default '{}'::text[] not null,
  notified_worst numeric,
  last_week text,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_board_card_assignees (
  id uuid default gen_random_uuid() not null,
  card_id uuid not null,
  board_id uuid not null,
  rep_id text not null,
  member_id uuid,
  partner_id uuid,
  notified_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_board_cards (
  id uuid default gen_random_uuid() not null,
  board_id uuid not null,
  list_id uuid not null,
  rep_id text not null,
  title text default ''::text not null,
  notes text,
  label_color text,
  due_date date,
  urgency text,
  tags text[] default '{}'::text[] not null,
  "position" integer default 0 not null,
  done_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  acted_by_member_id uuid,
  acted_by_name text,
  search_tsv tsvector generated always as ((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(notes, ''::text)), 'B'::"char"))) stored
);

create table if not exists public.cxo_board_checklist_items (
  id uuid default gen_random_uuid() not null,
  card_id uuid not null,
  board_id uuid not null,
  rep_id text not null,
  text text not null,
  done boolean default false not null,
  "position" integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_board_lists (
  id uuid default gen_random_uuid() not null,
  board_id uuid not null,
  rep_id text not null,
  title text default 'New list'::text not null,
  "position" integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_board_updates (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  month text not null,
  sections jsonb default '{}'::jsonb not null,
  draft_text text default ''::text not null,
  body text default ''::text not null,
  status text default 'draft'::text not null,
  edited boolean default false not null,
  generated_at timestamp with time zone default now() not null,
  generated_by uuid,
  edited_at timestamp with time zone,
  edited_by uuid,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_boards (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text default 'Untitled board'::text not null,
  "position" integer default 0 not null,
  created_by uuid,
  imported_from text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_book_policies (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  producer_id uuid not null,
  carrier text,
  line text default 'Life'::text not null,
  product text,
  submitted_on date not null,
  annual_premium numeric default 0 not null,
  status text default 'submitted'::text not null,
  issued_on date,
  lapsed_on date,
  external_id text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_book_producers (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text not null,
  agency text,
  upline text,
  state text,
  status text default 'active'::text not null,
  contracted_at date,
  external_id text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_ciao_pending (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  conversation_id uuid,
  actions jsonb not null,
  proposal text not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_comp_rates (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  product text default ''::text not null,
  carrier text default ''::text not null,
  agency_rate numeric not null,
  payout_rate numeric,
  payout_level text,
  agent_levels jsonb default '[]'::jsonb not null,
  upload_id uuid,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_comp_tiers (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  employee_id uuid not null,
  kpi_id uuid,
  period text default 'month'::text not null,
  attain_pct numeric not null,
  bonus numeric default 0 not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_daily_queue_items (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  source_key text not null,
  kind text not null,
  day date not null,
  title text not null,
  body text default ''::text not null,
  payload jsonb default '{}'::jsonb not null,
  needs_tap boolean default true not null,
  status text default 'open'::text not null,
  via text default 'app'::text not null,
  created_at timestamp with time zone default now() not null,
  resolved_at timestamp with time zone
);

create table if not exists public.cxo_daily_queue_runs (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  day date not null,
  via text default 'app'::text not null,
  counts jsonb default '{}'::jsonb not null,
  report jsonb default '{}'::jsonb not null,
  model_calls integer default 0 not null,
  est_cost_usd numeric(10,5) default 0 not null,
  ran_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_decisions (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  note_id uuid not null,
  idx integer not null,
  text text not null,
  decided_by text,
  decided_at timestamp with time zone not null,
  meeting_title text,
  topic text default ''::text not null,
  reverses_id uuid,
  reversed_by_id uuid,
  reversal_reason text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_due_digests (
  member_id uuid not null,
  day date not null,
  rep_id text not null,
  cards integer default 0 not null,
  status text default 'sent'::text not null,
  sent_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_due_reminders (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  card_id uuid not null,
  member_id uuid not null,
  kind text not null,
  due_date date not null,
  days_left integer not null,
  in_app boolean default true not null,
  read_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_employee_kpis (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  employee_id uuid not null,
  name text not null,
  unit text default 'count'::text not null,
  target numeric default 0 not null,
  period text default 'month'::text not null,
  weight numeric default 1 not null,
  lower_is_better boolean default false not null,
  sort integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  quota_type text default 'custom'::text not null,
  actual_source text default 'manual'::text not null
);

create table if not exists public.cxo_employee_time_off (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  employee_id uuid not null,
  start_date date not null,
  end_date date not null,
  days numeric default 1 not null,
  kind text default 'vacation'::text not null,
  note text,
  source text default 'entered'::text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_employees (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text not null,
  title text,
  department text default ''::text not null,
  manager_id uuid,
  start_date date,
  email text,
  base_salary numeric,
  pay_frequency text default 'biweekly'::text not null,
  member_id uuid,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  hourly_rate numeric,
  hours_per_week numeric,
  pto_allowed_days numeric,
  pto_balance_days numeric,
  book_match text,
  book_dim text,
  qbo_employee_id text
);

create table if not exists public.cxo_exec_assistants (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  exec_member_id uuid not null,
  assistant_member_id uuid not null,
  is_active boolean default true not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  removed_at timestamp with time zone
);

create table if not exists public.cxo_followup_notices (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  key text not null,
  kind text not null,
  item_kind text,
  item_id text,
  title text not null,
  body text,
  href text,
  due_date date,
  read_at timestamp with time zone,
  emailed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_goals (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  employee_id uuid not null,
  title text not null,
  unit text default 'count'::text not null,
  target numeric not null,
  current numeric default 0 not null,
  due_date date,
  status text default 'active'::text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_ics_feeds (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  url text not null,
  label text default 'Apple calendar'::text not null,
  events jsonb default '[]'::jsonb not null,
  fetched_at timestamp with time zone,
  last_error text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_kpi_actuals (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  kpi_id uuid not null,
  employee_id uuid not null,
  period_key text not null,
  actual numeric default 0 not null,
  source text default 'entered'::text not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_meeting_agendas (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  series_id text not null,
  event_id text not null,
  title text default ''::text not null,
  starts_at timestamp with time zone not null,
  organizer_email text,
  attendee_emails text[] default '{}'::text[] not null,
  sections jsonb default '{}'::jsonb not null,
  body text default ''::text not null,
  raised jsonb default '[]'::jsonb not null,
  prior_note_id uuid,
  drafted_at timestamp with time zone,
  edited_at timestamp with time zone,
  edited_by uuid,
  added_at timestamp with time zone,
  added_by uuid,
  held_note_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_meeting_series (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  series_id text not null,
  title text default ''::text not null,
  choice text default 'leadership'::text not null,
  marked_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_mira_approvals (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  requested_by uuid not null,
  tool text not null,
  args jsonb default '{}'::jsonb not null,
  summary text not null,
  reason text not null,
  status text default 'pending'::text not null,
  decided_by uuid,
  decided_at timestamp with time zone,
  result jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_mira_audit (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  tool text not null,
  args_summary jsonb default '{}'::jsonb not null,
  result text not null,
  approved boolean,
  action_id uuid,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_mira_corrections (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  kind text not null,
  item text not null,
  detail text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_native_push_tokens (
  token text not null,
  platform text not null,
  rep_id text not null,
  member_id uuid not null,
  created_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_onboarding (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  joined_at timestamp with time zone,
  started_at timestamp with time zone default now() not null,
  backfilled boolean default false not null,
  welcomed_at timestamp with time zone,
  abilities_seen_at timestamp with time zone,
  completed_at timestamp with time zone,
  manager_notified_at timestamp with time zone,
  manager_member_id uuid,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_one_on_one_items (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  one_on_one_id uuid not null,
  kind text not null,
  body text not null,
  author_member_id uuid,
  author_name text,
  owner_member_id uuid,
  owner_name text,
  todo_id uuid,
  done_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_one_on_ones (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  employee_id uuid not null,
  manager_member_id uuid,
  manager_name text,
  cadence text default 'biweekly'::text not null,
  next_date date,
  last_date date,
  calendar_event_id text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_partner_actions (
  id uuid default gen_random_uuid() not null,
  partner_id uuid not null,
  rep_id text not null,
  kind text not null,
  subject text,
  body text,
  status text default 'draft'::text not null,
  sent_to text,
  channel text,
  provider_id text,
  draft_id text,
  from_account text,
  thread_id text,
  created_by text,
  created_at timestamp with time zone default now() not null,
  sent_at timestamp with time zone,
  due_at timestamp with time zone
);

create table if not exists public.cxo_partners (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text not null,
  org text,
  role text,
  kind text default 'other'::text not null,
  email text,
  phone text,
  notes text,
  tags text[] default '{}'::text[] not null,
  owner_member_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  on_platform boolean default false not null,
  email_secondary text,
  email_support text,
  phone_office text,
  phone_office_ext text,
  website text,
  address text,
  search_text text default ''::text not null
);

create table if not exists public.cxo_payout_periods (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  period_key text not null,
  approved_at timestamp with time zone default now() not null,
  approved_by uuid,
  approved_by_name text,
  total numeric default 0 not null,
  lines jsonb default '[]'::jsonb not null
);

create table if not exists public.cxo_plan_targets (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  year integer not null,
  month integer not null,
  product text default ''::text not null,
  carrier text default ''::text not null,
  premium numeric default 0 not null,
  policies integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_plan_unit_econ (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  year integer not null,
  product text default ''::text not null,
  carrier text default ''::text not null,
  commission_pct numeric,
  avg_premium numeric,
  override_pct numeric,
  acquisition_cost numeric,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_plan_uploads (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  kind text not null,
  year integer,
  filename text default ''::text not null,
  source text default 'file'::text not null,
  rows_saved integer default 0 not null,
  carriers integer default 0 not null,
  products integer default 0 not null,
  read_by text default 'rules'::text not null,
  ai_cost_usd numeric,
  member_id uuid,
  member_name text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_praise (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  from_member_id uuid,
  from_name text not null,
  to_employee_id uuid not null,
  value text,
  body text not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_qbo_connections (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  realm_id text not null,
  company_name text,
  environment text default 'production'::text not null,
  access_token_enc text not null,
  refresh_token_enc text not null,
  access_expires_at timestamp with time zone not null,
  refresh_expires_at timestamp with time zone,
  connected_by_member uuid,
  connected_by_name text,
  needs_reconnect boolean default false not null,
  last_sync_at timestamp with time zone,
  last_sync_ok boolean,
  last_sync_error text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_qbo_employees (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  qbo_id text not null,
  display_name text not null,
  given_name text,
  family_name text,
  title text,
  email text,
  phone text,
  employee_number text,
  active boolean default true not null,
  hired_date date,
  released_date date,
  billable_time boolean,
  bill_rate numeric,
  cost_rate numeric,
  qbo_updated_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_qbo_expense_monthly (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  month text not null,
  category text not null,
  amount numeric default 0 not null,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_qbo_pnl_monthly (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  month text not null,
  income numeric default 0 not null,
  cogs numeric default 0 not null,
  gross_profit numeric default 0 not null,
  expenses numeric default 0 not null,
  other_income numeric default 0 not null,
  other_expenses numeric default 0 not null,
  net_income numeric default 0 not null,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_qbo_revenue_breakdown (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  month text not null,
  dimension text not null,
  name text not null,
  amount numeric default 0 not null,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_qbo_time_activity (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  qbo_id text not null,
  txn_date date not null,
  name_of text,
  employee_qbo_id text,
  employee_name text,
  vendor_name text,
  customer_name text,
  class_name text,
  item_name text,
  hours numeric default 0 not null,
  billable_status text,
  hourly_rate numeric,
  cost_rate numeric,
  description text,
  qbo_updated_at timestamp with time zone,
  synced_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_report_jobs (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  kind text not null,
  cadence text default 'weekly'::text not null,
  weekday smallint,
  hour smallint default 8 not null,
  paused boolean default false not null,
  next_run_at timestamp with time zone not null,
  last_run_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_reviews (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  employee_id uuid not null,
  period_type text not null,
  period_key text not null,
  overall integer,
  kpi_ratings jsonb default '{}'::jsonb not null,
  notes text,
  reviewer_id uuid,
  reviewer_name text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_slack_installs (
  rep_id text not null,
  team_id text not null,
  team_name text,
  bot_user_id text not null,
  bot_token_enc text not null,
  installed_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_slack_threads (
  rep_id text not null,
  team_id text not null,
  channel text not null,
  thread_ts text not null,
  member_id uuid not null,
  history jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_todo_note_scans (
  note_id uuid not null,
  rep_id text not null,
  scanned_at timestamp with time zone default now() not null,
  items integer default 0 not null
);

create table if not exists public.cxo_todos (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  body text not null,
  source text default 'manual'::text not null,
  note_id uuid,
  meeting_title text,
  meeting_at timestamp with time zone,
  partner_id uuid,
  partner_name text,
  thread_id text,
  source_key text,
  "position" integer default 0 not null,
  done_at timestamp with time zone,
  deleted_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  mentions integer default 1 not null,
  source_label text,
  kind text default 'task'::text not null,
  priority text default 'normal'::text not null,
  due_date date,
  assignee_partner_id uuid,
  assignee_name text,
  link_kind text,
  link_id text,
  link_label text,
  link_url text,
  link_phone text,
  link_email text,
  acted_by_member_id uuid,
  acted_by_name text,
  search_tsv tsvector generated always as ((setweight(to_tsvector('english'::regconfig, COALESCE(body, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, ((COALESCE(meeting_title, ''::text) || ' '::text) || COALESCE(partner_name, ''::text))), 'B'::"char"))) stored,
  remind_at timestamp with time zone,
  remind_rule text,
  reminded_at timestamp with time zone
);

create table if not exists public.cxo_weekly_status (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  week text not null,
  moved text[] default '{}'::text[] not null,
  next text[] default '{}'::text[] not null,
  blockers text[] default '{}'::text[] not null,
  prefill jsonb default '{}'::jsonb not null,
  asked_at timestamp with time zone default now() not null,
  confirmed_at timestamp with time zone,
  edited boolean default false not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.cxo_whop_webhook_events (
  id text not null,
  type text not null,
  outcome text not null,
  rep_id text,
  resource_id text,
  detail jsonb,
  received_at timestamp with time zone default now() not null
);

create table if not exists public.deferred_items (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  owner_member_id uuid not null,
  source text not null,
  source_member_id uuid,
  source_memo_id uuid,
  source_room_message_id uuid,
  source_lead_id uuid,
  source_session_id uuid,
  title text not null,
  body text,
  remind_at timestamp with time zone,
  status text default 'open'::text not null,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.dialer_hour_grants (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  week_start date not null,
  granter_member_id uuid,
  grantee_member_id uuid not null,
  granted_seconds integer not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.dialer_kpis (
  rep_id text not null,
  day date not null,
  dials integer default 0 not null,
  connects integer default 0 not null,
  conversations integer default 0 not null,
  appointments_set integer default 0 not null,
  voicemails integer default 0 not null,
  no_answers integer default 0 not null,
  dial_time_seconds integer default 0 not null,
  cost_cents integer default 0 not null,
  updated_at timestamp with time zone default now()
);

create table if not exists public.dialer_mode_allocations (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  week_start date not null,
  mode text not null,
  allocated_seconds integer not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.dialer_queue (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  owner_member_id uuid,
  workflow_rule_id uuid,
  lead_id uuid,
  meeting_id uuid,
  dialer_mode text not null,
  status text default 'pending'::text not null,
  priority integer default 10 not null,
  scheduled_for timestamp with time zone,
  attempt_count integer default 0 not null,
  max_attempts integer default 2 not null,
  next_retry_at timestamp with time zone,
  last_outcome text,
  phone text,
  context jsonb default '{}'::jsonb,
  source_kind text default 'manual'::text not null,
  source_ref text,
  provider text,
  provider_call_id text,
  live_transfer_status text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ai_salesperson_id uuid,
  campaign_id uuid,
  import_batch_id uuid
);

create table if not exists public.dialer_queue_events (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  queue_id uuid,
  workflow_rule_id uuid,
  member_id uuid,
  event_type text not null,
  outcome text,
  reason text,
  payload jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.dialer_shifts (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  weekday smallint not null,
  start_minute smallint not null,
  end_minute smallint not null,
  mode text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.dialer_transfer_availability (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  day_of_week integer not null,
  start_local time without time zone not null,
  end_local time without time zone not null,
  timezone text,
  accepts_live_transfer boolean default true not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.dialer_workflow_rules (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  created_by_member_id uuid,
  owner_member_id uuid,
  scope text default 'personal'::text not null,
  team_id uuid,
  name text not null,
  is_active boolean default true not null,
  dialer_mode text not null,
  trigger_kind text not null,
  trigger_config jsonb default '{}'::jsonb not null,
  script_profile text,
  max_attempts integer default 2 not null,
  retry_delay_min integer default 30 not null,
  max_daily_calls integer,
  business_hours_only boolean default false not null,
  timezone text,
  priority integer default 10 not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.email_drafts (
  id uuid default gen_random_uuid() not null,
  thread_id uuid not null,
  rep_id text not null,
  owner_member_id uuid,
  subject text,
  body text not null,
  model_used text,
  status text default 'pending'::text not null,
  edited_by_human boolean default false,
  feedback text,
  created_at timestamp with time zone default now(),
  sent_at timestamp with time zone,
  gmail_message_id text
);

create table if not exists public.email_messages (
  id uuid default gen_random_uuid() not null,
  thread_id uuid not null,
  gmail_message_id text not null,
  direction text,
  from_address text,
  to_addresses text[],
  cc_addresses text[],
  subject text,
  body_text text,
  body_html text,
  sent_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create table if not exists public.email_threads (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  owner_member_id uuid,
  gmail_thread_id text not null,
  gmail_history_id text,
  subject text,
  from_address text,
  from_name text,
  snippet text,
  last_message_at timestamp with time zone,
  message_count integer default 1,
  priority text,
  category text,
  needs_reply boolean default false,
  reasoning text,
  status text default 'new'::text not null,
  snoozed_until timestamp with time zone,
  lead_id uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.feature_requests (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  source text default 'telegram'::text not null,
  summary text not null,
  context text,
  status text default 'new'::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.fix_requests (
  id uuid default gen_random_uuid() not null,
  rep_id text,
  member_id uuid,
  source text default 'manual'::text not null,
  area text,
  body text not null,
  severity text default 'normal'::text not null,
  status text default 'new'::text not null,
  created_by text,
  digest_sent_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.gmail_sync_state (
  rep_id text not null,
  member_id uuid,
  last_history_id text,
  last_synced_at timestamp with time zone,
  last_error text,
  consecutive_errors integer default 0,
  id uuid default gen_random_uuid() not null
);

create table if not exists public.google_tokens (
  rep_id text not null,
  access_token text not null,
  refresh_token text,
  expires_at timestamp with time zone not null,
  email text,
  scope text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  member_id uuid,
  id uuid default gen_random_uuid() not null,
  needs_reconnect boolean default false not null,
  reconnect_reason text,
  broken_at timestamp with time zone,
  oauth_source text,
  oauth_client_id text,
  calendar_only boolean default false not null
);

create table if not exists public.import_batches (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  ai_salesperson_id uuid,
  file_name text,
  source text default 'csv'::text not null,
  vendor_name text,
  cost_per_lead numeric(10,4),
  total_count integer default 0 not null,
  inserted_count integer default 0 not null,
  duplicate_count integer default 0 not null,
  failed_count integer default 0 not null,
  enrolled_count integer default 0 not null,
  status text default 'pending'::text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.invoices (
  id text not null,
  stripe_customer_id text not null,
  rep_id text,
  member_id uuid,
  scope text not null,
  status text not null,
  amount_due_cents integer default 0 not null,
  amount_paid_cents integer default 0 not null,
  amount_remaining_cents integer default 0 not null,
  currency text default 'usd'::text not null,
  hosted_invoice_url text,
  invoice_pdf_url text,
  number text,
  iso_week text,
  period_start timestamp with time zone,
  period_end timestamp with time zone,
  collection_method text,
  attempt_count integer default 0,
  next_payment_attempt timestamp with time zone,
  finalized_at timestamp with time zone,
  paid_at timestamp with time zone,
  voided_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.job_runs (
  id uuid default gen_random_uuid() not null,
  job text not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  ok boolean,
  error text,
  meta jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.kpi_cards (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  metric_key text not null,
  label text not null,
  unit text,
  period text default 'day'::text not null,
  goal_value numeric,
  sort_order integer default 0,
  archived_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  description text,
  starting_value numeric,
  target_date date,
  reminder_cadence text default 'none'::text not null,
  reminder_time text,
  reminder_dow smallint
);

create table if not exists public.kpi_entries (
  id uuid default gen_random_uuid() not null,
  kpi_card_id uuid not null,
  rep_id text not null,
  member_id uuid,
  day date not null,
  value numeric default 0 not null,
  note text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.lead_activities (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid not null,
  type text not null,
  body text,
  occurred_at timestamp with time zone default now() not null,
  author_member_id uuid,
  payload jsonb default '{}'::jsonb not null,
  source text default 'manual'::text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.lead_campaign_events (
  id uuid default gen_random_uuid() not null,
  campaign_id uuid not null,
  rep_id text not null,
  lead_id text not null,
  step integer not null,
  action_type text not null,
  channel_ref_id text,
  outcome text,
  ai_reasoning text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.lead_campaigns (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  ai_salesperson_id uuid,
  lead_id text not null,
  template_key text not null,
  status text default 'active'::text not null,
  current_step integer default 0 not null,
  max_steps integer default 7 not null,
  next_action_at timestamp with time zone,
  last_action_at timestamp with time zone,
  last_action_type text,
  last_outcome text,
  paused_until timestamp with time zone,
  context jsonb default '{}'::jsonb not null,
  stop_reason text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.lead_events (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid not null,
  event_label text not null,
  from_disposition text,
  to_disposition text,
  member_id uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.lead_notes (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid not null,
  content text not null,
  author_id uuid,
  created_at timestamp with time zone default now()
);

create table if not exists public.leads (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text not null,
  email text,
  company text,
  status text default 'cold'::text,
  last_contact timestamp with time zone,
  notes text,
  source text,
  external_id text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  owner_member_id uuid,
  team_id uuid,
  deal_value numeric,
  deal_currency text default 'USD'::text,
  snoozed_until timestamp with time zone,
  pipeline_id uuid,
  pipeline_stage_id uuid,
  crm_source text,
  crm_object_id text,
  crm_contact_id text,
  phone text,
  ai_salesperson_id uuid,
  disposition text,
  product_intent text,
  product_intent_locked boolean default false,
  sms_consent boolean default false,
  sms_consent_date timestamp with time zone,
  next_followup_at timestamp with time zone,
  last_contacted_at timestamp with time zone,
  ai_discovery_summary jsonb,
  import_batch_id uuid,
  disposition_changed_at timestamp with time zone,
  lead_date timestamp with time zone,
  campaign_notes text,
  do_not_call boolean default false not null,
  street text,
  city text,
  state text,
  zip text
);

create table if not exists public.liability_agreements (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid not null,
  agreement_version text not null,
  signature_name text not null,
  agreement_text text not null,
  pdf_storage_path text,
  signed_at timestamp with time zone default now() not null,
  signed_ip inet,
  signed_user_agent text,
  created_at timestamp with time zone default now()
);

create table if not exists public.local_presence_numbers (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  e164 text not null,
  area_code text not null,
  state text,
  provider text default 'telnyx'::text not null,
  trunk_sid text,
  active boolean default true not null,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.mcp_tokens (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  member_id uuid,
  label text default 'My AI'::text not null,
  token_hash text not null,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone
);

create table if not exists public.meeting_inbound_tokens (
  token text not null,
  rep_id text not null,
  member_id uuid not null,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.meetings (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid,
  prospect_id uuid,
  source text not null,
  source_event_id text,
  attendee_name text,
  attendee_email text,
  phone text,
  scheduled_at timestamp with time zone not null,
  duration_min integer default 30,
  timezone text,
  title text,
  description text,
  meeting_url text,
  status text default 'scheduled'::text not null,
  confirmation_attempts integer default 0 not null,
  last_call_id uuid,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.member_addons (
  rep_id text not null,
  member_id uuid not null,
  addon_key text not null,
  is_active boolean default true not null,
  granted_by_member_id uuid,
  granted_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.member_message_triage (
  message_id uuid not null,
  rep_id text not null,
  to_member_id uuid not null,
  category text not null,
  reason text default ''::text not null,
  rank integer default 0 not null,
  suggestion text default 'reply'::text not null,
  draft text,
  outcome text,
  outcome_at timestamp with time zone,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.member_messages (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  from_member_id uuid not null,
  to_member_id uuid not null,
  body text not null,
  kind text default 'message'::text not null,
  deliver_at timestamp with time zone default now() not null,
  read_at timestamp with time zone,
  replied_to_id uuid,
  created_at timestamp with time zone default now() not null,
  acted_by_member_id uuid,
  acted_by_name text,
  search_tsv tsvector generated always as (to_tsvector('english'::regconfig, COALESCE(body, ''::text))) stored
);

create table if not exists public.members (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  email text not null,
  display_name text not null,
  role text default 'rep'::text not null,
  password_hash text,
  is_active boolean default true,
  telegram_chat_id text,
  telegram_link_code text,
  timezone text,
  last_login_at timestamp with time zone,
  invited_by uuid,
  invited_at timestamp with time zone,
  accepted_at timestamp with time zone,
  settings jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  slug text,
  password_reset_token text,
  password_reset_expires_at timestamp with time zone,
  phone text,
  home_subdomain text,
  login_link_sent_at timestamp with time zone
);

create table if not exists public.onboarding_tokens (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  token text not null,
  build_fee_cents integer default 0 not null,
  checkout_url text,
  stripe_session_id text,
  signature_name text,
  signed_at timestamp with time zone,
  paid_at timestamp with time zone,
  welcome_sent_at timestamp with time zone,
  expires_at timestamp with time zone default (now() + '7 days'::interval) not null,
  created_at timestamp with time zone default now() not null,
  signed_ip text,
  signed_user_agent text,
  whop_checkout_id text
);

create table if not exists public.org_billing_week (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  iso_week text not null,
  week_start timestamp with time zone not null,
  week_end timestamp with time zone not null,
  planned_hours numeric(8,2) default 0 not null,
  consumed_seconds integer default 0 not null,
  overage_hours numeric(8,2) default 0 not null,
  status text default 'open'::text not null,
  stripe_invoice_id text,
  invoice_paid_at timestamp with time zone,
  overage_pushed_at timestamp with time zone,
  closed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.outbound_messages (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid,
  channel text default 'imessage'::text not null,
  direction text default 'outbound'::text not null,
  to_address text not null,
  body text not null,
  status text default 'sent'::text,
  external_id text,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

create table if not exists public.payroll_deposits (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  carrier text,
  amount numeric default 0,
  deposited_on date,
  matched boolean default false,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.payroll_settings (
  rep_id text not null,
  workflow_notes text,
  updated_at timestamp with time zone default now()
);

create table if not exists public.pinnacle_agent_dir (
  id text not null,
  name text not null,
  team text default ''::text not null,
  created date,
  status text,
  status_changed date,
  leaving boolean default false not null
);

create table if not exists public.pinnacle_agent_writes (
  agent text not null,
  line text not null,
  wrote date not null,
  ap numeric default 0 not null
);

create table if not exists public.pinnacle_airtable_records (
  base_id text not null,
  table_name text not null,
  record_id text not null,
  fields jsonb default '{}'::jsonb not null,
  airtable_created timestamp with time zone,
  last_modified_at timestamp with time zone,
  fetched_at timestamp with time zone default now() not null
);

create table if not exists public.pinnacle_airtable_snapshots (
  base_id text not null,
  snapshot_date date not null,
  revenue_total numeric,
  apps_submitted integer,
  apps_approved integer,
  apps_funded integer,
  metrics jsonb default '{}'::jsonb not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.pinnacle_airtable_sync_runs (
  id uuid default gen_random_uuid() not null,
  started_at timestamp with time zone default now() not null,
  finished_at timestamp with time zone,
  ok boolean,
  tables jsonb,
  error text
);

create table if not exists public.pinnacle_daily_rollup (
  base_id text not null,
  d date not null,
  line text not null,
  premium numeric default 0,
  policies bigint default 0,
  funded_premium numeric default 0,
  funded_policies bigint default 0
);

create table if not exists public.pinnacle_dim_rollup (
  d date not null,
  line text not null,
  dim text not null,
  label text not null,
  team text default ''::text not null,
  premium numeric default 0 not null,
  funded numeric default 0 not null,
  policies bigint default 0 not null,
  paid bigint default 0 not null,
  declined bigint default 0 not null,
  lapsed bigint default 0 not null
);

create table if not exists public.pinnacle_dim_rollup_month (
  m date not null,
  line text not null,
  dim text not null,
  label text not null,
  team text default ''::text not null,
  premium numeric default 0 not null,
  funded numeric default 0 not null,
  policies bigint default 0 not null,
  paid bigint default 0 not null,
  declined bigint default 0 not null,
  lapsed bigint default 0 not null
);

create table if not exists public.pinnacle_maintenance_log (
  id bigint default nextval('pinnacle_maintenance_log_id_seq'::regclass) not null,
  at timestamp with time zone default now(),
  note text,
  result jsonb
);

create table if not exists public.pinnacle_name_map (
  record_id text not null,
  name text not null,
  source_table text
);

create table if not exists public.pinnacle_people_rollup (
  id integer default 1 not null,
  data jsonb not null,
  computed_at timestamp with time zone default now() not null
);

create table if not exists public.pinnacle_rollup_cache (
  tenant_id text not null,
  payload jsonb not null,
  computed_at timestamp with time zone default now() not null,
  computing_since timestamp with time zone
);

create table if not exists public.pinnacle_status_rollup (
  d date not null,
  line text not null,
  total bigint default 0,
  paid bigint default 0,
  declined bigint default 0,
  lapsed bigint default 0,
  submitted bigint default 0
);

create table if not exists public.pinnacle_sync_cursor (
  base_id text not null,
  table_name text not null,
  run_start timestamp with time zone,
  airtable_offset text,
  fetched integer default 0 not null,
  completed_at timestamp with time zone,
  last_error text,
  updated_at timestamp with time zone default now() not null,
  last_full_at timestamp with time zone,
  run_since timestamp with time zone,
  last_ok_start timestamp with time zone
);

create table if not exists public.pinnacle_sync_state (
  id integer default 1 not null,
  warmed_at timestamp with time zone,
  sync_lock_until timestamp with time zone
);

create table if not exists public.pinnacle_sync_table_runs (
  id bigint default nextval('pinnacle_sync_table_runs_id_seq'::regclass) not null,
  base_id text not null,
  table_name text not null,
  started_at timestamp with time zone not null,
  completed_at timestamp with time zone default now() not null,
  fetched integer default 0 not null,
  swept_at timestamp with time zone,
  swept bigint,
  incremental boolean default false not null,
  clean boolean default true not null,
  sweep_skipped text
);

create table if not exists public.pipeline_items (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  pipeline_id uuid not null,
  pipeline_stage_id uuid,
  owner_member_id uuid,
  title text not null,
  subtitle text,
  notes text,
  value numeric,
  value_currency text default 'USD'::text,
  status text default 'open'::text,
  metadata jsonb default '{}'::jsonb,
  "position" integer default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.pipeline_stages (
  id uuid default gen_random_uuid() not null,
  pipeline_id uuid not null,
  rep_id text not null,
  name text not null,
  "position" integer default 0 not null,
  color text default '#94a3b8'::text not null,
  crm_stage_id text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.pipelines (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text default 'My Pipeline'::text not null,
  crm_source text,
  crm_pipeline_id text,
  crm_last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  kind text default 'sales'::text not null,
  description text,
  owner_member_id uuid
);

create table if not exists public.plaud_actions (
  id uuid default gen_random_uuid() not null,
  note_id uuid not null,
  rep_id text not null,
  owner_member_id uuid,
  kind text not null,
  payload jsonb default '{}'::jsonb not null,
  target_member_id uuid,
  target_contact_id uuid,
  target_email text,
  status text default 'pending'::text not null,
  auto_executed boolean default false,
  result jsonb,
  reasoning text,
  error text,
  created_at timestamp with time zone default now(),
  approved_at timestamp with time zone,
  executed_at timestamp with time zone,
  updated_at timestamp with time zone default now()
);

create table if not exists public.plaud_agent_guidance (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  scope text default 'both'::text not null,
  kind text default 'avoid'::text not null,
  rule text not null,
  source text default 'action'::text not null,
  source_kind text,
  source_ref uuid,
  weight integer default 1 not null,
  active boolean default true not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  subject text
);

create table if not exists public.plaud_daily_plans (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  owner_member_id uuid,
  plan_date date not null,
  timezone text,
  status text default 'pending_review'::text not null,
  intro text,
  items jsonb default '[]'::jsonb not null,
  source_counts jsonb,
  model text,
  created_at timestamp with time zone default now(),
  reviewed_at timestamp with time zone,
  updated_at timestamp with time zone default now()
);

create table if not exists public.plaud_notes (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  title text default 'Plaud note'::text not null,
  transcript text,
  summary text,
  action_items text[] default '{}'::text[] not null,
  occurred_at timestamp with time zone default now() not null,
  created_at timestamp with time zone default now(),
  triage_class text,
  triage_reasoning text,
  triage_model text,
  triaged_at timestamp with time zone,
  duration_seconds integer,
  owner_member_id uuid,
  source text,
  calendar_event_id text,
  attendees jsonb,
  mira_digest jsonb,
  search_tsv tsvector generated always as (((setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char") || setweight(to_tsvector('english'::regconfig, COALESCE(summary, ''::text)), 'B'::"char")) || setweight(to_tsvector('english'::regconfig, "left"(COALESCE(transcript, ''::text), 200000)), 'C'::"char"))) stored
);

create table if not exists public.plaud_plan_feedback (
  id uuid default gen_random_uuid() not null,
  plan_id uuid not null,
  rep_id text not null,
  member_id uuid,
  item_index integer,
  item_title text,
  verdict text not null,
  reason text,
  created_at timestamp with time zone default now()
);

create table if not exists public.plaud_settings (
  rep_id text not null,
  training_folder_id text,
  exec_folder_id text,
  action_folder_id text,
  resource_folder_id text,
  auto_send_email boolean default false,
  auto_send_calendar boolean default false,
  updated_at timestamp with time zone default now()
);

create table if not exists public.project_sections (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  rep_id text not null,
  title text not null,
  subtitle text,
  "position" integer default 0 not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.project_task_steps (
  id uuid default gen_random_uuid() not null,
  task_id uuid not null,
  project_id uuid not null,
  rep_id text not null,
  content text not null,
  done boolean default false not null,
  "position" integer default 0 not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.project_tasks (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  section_id uuid,
  rep_id text not null,
  title text not null,
  description text,
  owner_hint text,
  assigned_to uuid,
  time_estimate text,
  status text default 'todo'::text not null,
  "position" integer default 0 not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.projects (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  owner_member_id uuid,
  name text not null,
  description text,
  source_kind text default 'prompt'::text not null,
  source_text text,
  status text default 'active'::text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.prospects (
  id uuid default gen_random_uuid() not null,
  source text default 'cal.com'::text not null,
  external_id text,
  name text,
  email text,
  company text,
  phone text,
  tier_interest text,
  notes text,
  booking_url text,
  meeting_at timestamp with time zone,
  timezone text,
  status text default 'new'::text,
  payload jsonb default '{}'::jsonb,
  rep_id text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  build_brief text,
  build_plan text,
  build_summary text,
  build_cost_estimate numeric,
  maintenance_estimate numeric,
  plan_generated_at timestamp with time zone,
  selected_features jsonb default '[]'::jsonb,
  selected_addons jsonb default '[]'::jsonb,
  reminder_24h_sent_at timestamp with time zone,
  reminder_1h_sent_at timestamp with time zone,
  pipeline_stage text default 'lead'::text,
  admin_notes text,
  cart_id uuid,
  kickoff_call_at timestamp with time zone,
  pipeline_position integer default 0,
  stage_changed_at timestamp with time zone default now()
);

create table if not exists public.rate_limit_buckets (
  key text not null,
  count integer default 0 not null,
  window_start timestamp with time zone default now() not null
);

create table if not exists public.recommendation_suppressions (
  rep_id text not null,
  kind text not null,
  created_at timestamp with time zone default now()
);

create table if not exists public.recommendations (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  dedupe_key text not null,
  kind text not null,
  title text not null,
  detail text,
  reasoning text,
  priority text default 'normal'::text not null,
  status text default 'open'::text not null,
  signal jsonb,
  dismissed_reason text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.rep_addons (
  rep_id text not null,
  addon_key text not null,
  seats integer default 1 not null,
  is_active boolean default true not null,
  activated_at timestamp with time zone default now(),
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.rep_api_keys (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  key_hash text not null,
  label text not null,
  created_at timestamp with time zone default now() not null,
  last_used_at timestamp with time zone,
  revoked_at timestamp with time zone
);

create table if not exists public.rep_contacts (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  display_name text not null,
  aliases text[] default '{}'::text[],
  email text,
  phone text,
  role text,
  member_id uuid,
  notes text,
  source text,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.reps (
  id text not null,
  slug text not null,
  display_name text not null,
  company text,
  email text,
  claude_api_key text,
  telegram_chat_id text,
  hubspot_token text,
  settings jsonb default '{}'::jsonb,
  is_active boolean default true,
  tier text default 'individual'::text,
  monthly_fee numeric default 50,
  build_fee numeric default 1500,
  start_date date,
  onboarding_steps jsonb default '[]'::jsonb,
  build_notes text,
  integrations jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  password_hash text,
  last_login_at timestamp with time zone,
  telegram_link_code text,
  stripe_customer_id text,
  payment_date date,
  timezone text default 'UTC'::text,
  logo_url text,
  brand_primary text,
  brand_ink text,
  max_seats integer,
  dialer_pool_mode text default 'per_rep'::text,
  stripe_subscription_id text,
  billing_status text default 'none'::text not null,
  current_week_start timestamp with time zone,
  current_week_end timestamp with time zone,
  cancel_at_week_end boolean default false not null,
  weekly_hours_quota integer default 0,
  overflow_enabled boolean default false not null,
  volume_tier text default 't1'::text,
  default_payment_method_id text,
  card_brand text,
  card_last4 text,
  card_exp_month smallint,
  card_exp_year smallint,
  pending_payment_method_id text,
  pending_plan jsonb,
  prospect_id uuid,
  build_fee_paid_at timestamp with time zone,
  build_fee_paid_cents integer,
  build_fee_payment_intent_id text,
  subscription_activated_at timestamp with time zone,
  subscription_activated_by text,
  pricing_overrides jsonb default '{}'::jsonb,
  revring_cost_per_minute_cents integer,
  client_display_rate_per_minute_cents integer,
  hipaa_mode boolean default false not null,
  brand text default 'virtualcloser'::text not null,
  host_aliases text[] default '{}'::text[] not null,
  whop_membership_id text,
  whop_last_payment_id text,
  whop_checkout_url text,
  comped_at timestamp with time zone,
  comped_reason text,
  comped_cents integer
);

create table if not exists public.roleplay_assignments (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  scenario_id uuid not null,
  assigned_by_member_id uuid,
  assignee_member_id uuid,
  team_id uuid,
  required_count integer default 1 not null,
  due_at timestamp with time zone,
  status text default 'open'::text not null,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.roleplay_daily_activity (
  rep_id text not null,
  member_id uuid not null,
  day date not null,
  sessions_count integer default 0 not null,
  minutes_practiced integer default 0 not null,
  avg_score numeric,
  best_score numeric,
  updated_at timestamp with time zone default now()
);

create table if not exists public.roleplay_quotas (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  team_id uuid,
  cadence text not null,
  required_count integer default 2 not null,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.roleplay_reviews (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  reviewer_member_id uuid not null,
  rating integer,
  verdict text,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.roleplay_scenario_docs (
  scenario_id uuid not null,
  doc_id uuid not null,
  weight numeric default 1,
  created_at timestamp with time zone default now()
);

create table if not exists public.roleplay_scenarios (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  created_by_member_id uuid,
  name text not null,
  product_brief text,
  persona text,
  difficulty text default 'standard'::text,
  objection_bank jsonb default '[]'::jsonb,
  source_voice_memo_ids uuid[],
  voice_provider text,
  voice_id text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.roleplay_sessions (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  scenario_id uuid,
  member_id uuid not null,
  status text default 'active'::text not null,
  started_at timestamp with time zone default now(),
  completed_at timestamp with time zone,
  duration_seconds integer,
  ai_score numeric,
  ai_summary text,
  ai_strengths text,
  ai_weaknesses text,
  transcript_full text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  scenario_key text,
  transport text default 'browser'::text not null,
  agent_id text,
  agent_number text,
  provider_call_id text,
  bind_note text,
  requested_at timestamp with time zone default now() not null,
  dialed_at timestamp with time zone
);

create table if not exists public.roleplay_training_docs (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  scope text not null,
  owner_member_id uuid,
  uploaded_by_member_id uuid,
  doc_kind text default 'reference'::text not null,
  title text not null,
  body text,
  storage_path text,
  source_voice_memo_id uuid,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ai_salesperson_id uuid
);

create table if not exists public.roleplay_turns (
  id uuid default gen_random_uuid() not null,
  session_id uuid not null,
  turn_index integer not null,
  speaker text not null,
  transcript text,
  audio_storage_path text,
  duration_ms integer,
  created_at timestamp with time zone default now()
);

create table if not exists public.room_deliveries (
  id uuid default gen_random_uuid() not null,
  message_id uuid not null,
  recipient_member_id uuid not null,
  tg_chat_id text,
  tg_message_id bigint,
  delivered_at timestamp with time zone,
  acknowledged_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

create table if not exists public.room_messages (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  audience text not null,
  sender_member_id uuid,
  parent_message_id uuid,
  body text,
  kind text default 'text'::text not null,
  telegram_file_id text,
  transcript text,
  delivered_count integer default 0,
  created_at timestamp with time zone default now()
);

create table if not exists public.room_todos (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  audience text not null,
  created_by uuid,
  assigned_to uuid,
  body text not null,
  status text default 'open'::text not null,
  due_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.sms_ai_sessions (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  ai_salesperson_id uuid,
  lead_id uuid,
  phone text not null,
  state text default 'context_confirmed'::text not null,
  discovery jsonb default '{}'::jsonb not null,
  engagement_score text default 'low'::text not null,
  appointment_likelihood integer default 0 not null,
  last_sentiment text,
  buying_signal_count integer default 0 not null,
  attempt_count integer default 1 not null,
  ai_paused boolean default false not null,
  escalation_reason text,
  last_contact_at timestamp with time zone,
  last_response_at timestamp with time zone,
  first_response_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists public.sms_messages (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  lead_id uuid,
  session_id uuid,
  direction text not null,
  body text not null,
  from_phone text,
  to_phone text,
  status text default 'queued'::text not null,
  is_ai_reply boolean default false not null,
  provider_message_id text,
  error_message text,
  created_at timestamp with time zone default now() not null
);

create table if not exists public.stripe_events (
  id text not null,
  type text not null,
  livemode boolean default false not null,
  api_version text,
  payload jsonb,
  received_at timestamp with time zone default now(),
  processed_at timestamp with time zone,
  error text
);

create table if not exists public.targets (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  period_type text not null,
  period_start date not null,
  metric text not null,
  target_value numeric not null,
  current_value numeric default 0,
  notes text,
  status text default 'active'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  owner_member_id uuid,
  team_id uuid,
  scope text default 'personal'::text not null,
  visibility text default 'all'::text not null
);

create table if not exists public.team_members (
  id uuid default gen_random_uuid() not null,
  team_id uuid not null,
  rep_id text not null,
  name text not null,
  email text,
  role text default 'rep'::text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  member_id uuid
);

create table if not exists public.teams (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  name text not null,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  manager_member_id uuid
);

create table if not exists public.usage_events (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  addon_key text not null,
  event_type text not null,
  quantity numeric default 1 not null,
  unit text not null,
  cost_cents_estimate integer default 0 not null,
  source_table text,
  source_id uuid,
  occurred_at timestamp with time zone default now() not null,
  period_year_month text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  period_year_week text
);

create table if not exists public.voice_calls (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  meeting_id uuid,
  lead_id uuid,
  provider text not null,
  provider_call_id text,
  direction text default 'outbound_confirm'::text not null,
  to_number text,
  from_number text,
  status text default 'queued'::text not null,
  outcome text,
  dtmf_input text,
  recording_url text,
  transcript text,
  duration_sec integer,
  cost_cents integer,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  raw jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  ai_summary text,
  ai_next_action text,
  summary text,
  hangup_cause text,
  error_message text,
  call_variables jsonb default '{}'::jsonb,
  call_metrics jsonb default '{}'::jsonb,
  dialer_mode text default 'concierge'::text,
  ai_salesperson_id uuid,
  owner_member_id uuid,
  crm_appointment_id text,
  final_disposition text,
  disposition_confidence numeric(3,2),
  disposition_reasoning text
);

create table if not exists public.voice_memos (
  id uuid default gen_random_uuid() not null,
  rep_id text not null,
  sender_member_id uuid not null,
  recipient_member_id uuid,
  team_id uuid,
  lead_id uuid,
  parent_memo_id uuid,
  kind text not null,
  status text default 'pending'::text not null,
  telegram_file_id text,
  storage_path text,
  duration_seconds integer,
  transcript text,
  tg_relay_chat_id text,
  tg_relay_message_id bigint,
  reviewed_by_member_id uuid,
  reviewed_at timestamp with time zone,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.worker_health (
  worker text not null,
  last_tick_at timestamp with time zone not null,
  tick_count bigint default 0,
  consecutive_errors integer default 0,
  last_summary text,
  alerted_at timestamp with time zone,
  updated_at timestamp with time zone default now()
);

alter sequence public.pinnacle_maintenance_log_id_seq owned by public.pinnacle_maintenance_log.id;

alter sequence public.pinnacle_sync_table_runs_id_seq owned by public.pinnacle_sync_table_runs.id;

alter table public.addon_requests add constraint addon_requests_pkey PRIMARY KEY (id);

alter table public.agent_actions add constraint agent_actions_pkey PRIMARY KEY (id);

alter table public.agent_billing add constraint agent_billing_member_id_key UNIQUE (member_id);

alter table public.agent_billing add constraint agent_billing_pkey PRIMARY KEY (id);

alter table public.agent_billing_event add constraint agent_billing_event_pkey PRIMARY KEY (id);

alter table public.agent_billing_event add constraint agent_billing_event_stripe_event_id_key UNIQUE (stripe_event_id);

alter table public.agent_billing_week add constraint agent_billing_week_member_id_iso_week_key UNIQUE (member_id, iso_week);

alter table public.agent_billing_week add constraint agent_billing_week_pkey PRIMARY KEY (id);

alter table public.agent_history add constraint agent_history_pkey PRIMARY KEY (id);

alter table public.agent_member_memory add constraint agent_member_memory_pkey PRIMARY KEY (id);

alter table public.agent_runs add constraint agent_runs_pkey PRIMARY KEY (id);

alter table public.agent_usage add constraint agent_usage_pkey PRIMARY KEY (rep_id, member_id, day);

alter table public.ai_salespeople add constraint ai_salespeople_pkey PRIMARY KEY (id);

alter table public.ai_salesperson_campaigns add constraint ai_salesperson_campaigns_pkey PRIMARY KEY (id);

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_pkey PRIMARY KEY (id);

alter table public.ai_wallet_ledger add constraint ai_wallet_ledger_pkey PRIMARY KEY (id);

alter table public.ai_wallets add constraint ai_wallets_pkey PRIMARY KEY (rep_id);

alter table public.app_errors add constraint app_errors_pkey PRIMARY KEY (id);

alter table public.audit_events add constraint audit_events_pkey PRIMARY KEY (id);

alter table public.billing_audit add constraint billing_audit_pkey PRIMARY KEY (id);

alter table public.billing_change_requests add constraint billing_change_requests_pkey PRIMARY KEY (id);

alter table public.billing_periods add constraint billing_periods_pkey PRIMARY KEY (id);

alter table public.billing_periods add constraint billing_periods_rep_id_period_year_month_key UNIQUE (rep_id, period_year_month);

alter table public.brain_dumps add constraint brain_dumps_pkey PRIMARY KEY (id);

alter table public.brain_items add constraint brain_items_pkey PRIMARY KEY (id);

alter table public.call_logs add constraint call_logs_pkey PRIMARY KEY (id);

alter table public.carts add constraint carts_pkey PRIMARY KEY (id);

alter table public.ciao_chat_folders add constraint ciao_chat_folders_pkey PRIMARY KEY (id);

alter table public.ciao_conversations add constraint ciao_conversations_pkey PRIMARY KEY (id);

alter table public.client_addons add constraint client_addons_pkey PRIMARY KEY (id);

alter table public.client_addons add constraint client_addons_rep_id_addon_key_key UNIQUE (rep_id, addon_key);

alter table public.client_events add constraint client_events_pkey PRIMARY KEY (id);

alter table public.client_integrations add constraint client_integrations_pkey PRIMARY KEY (id);

alter table public.client_integrations add constraint client_integrations_rep_id_key_key UNIQUE (rep_id, key);

alter table public.commission_entries add constraint commission_entries_pkey PRIMARY KEY (id);

alter table public.cxo_activity add constraint cxo_activity_pkey PRIMARY KEY (member_id, day, path);

alter table public.cxo_allowance_tiers add constraint cxo_allowance_tiers_pkey PRIMARY KEY (id);

alter table public.cxo_assistant_activity add constraint cxo_assistant_activity_pkey PRIMARY KEY (id);

alter table public.cxo_behind_watch add constraint cxo_behind_watch_pkey PRIMARY KEY (id);

alter table public.cxo_board_card_assignees add constraint cxo_board_card_assignees_pkey PRIMARY KEY (id);

alter table public.cxo_board_cards add constraint cxo_board_cards_pkey PRIMARY KEY (id);

alter table public.cxo_board_checklist_items add constraint cxo_board_checklist_items_pkey PRIMARY KEY (id);

alter table public.cxo_board_lists add constraint cxo_board_lists_pkey PRIMARY KEY (id);

alter table public.cxo_board_updates add constraint cxo_board_updates_pkey PRIMARY KEY (id);

alter table public.cxo_boards add constraint cxo_boards_pkey PRIMARY KEY (id);

alter table public.cxo_book_policies add constraint cxo_book_policies_pkey PRIMARY KEY (id);

alter table public.cxo_book_producers add constraint cxo_book_producers_pkey PRIMARY KEY (id);

alter table public.cxo_ciao_pending add constraint cxo_ciao_pending_pkey PRIMARY KEY (id);

alter table public.cxo_comp_rates add constraint cxo_comp_rates_pkey PRIMARY KEY (id);

alter table public.cxo_comp_rates add constraint cxo_comp_rates_rep_id_product_carrier_key UNIQUE (rep_id, product, carrier);

alter table public.cxo_comp_tiers add constraint cxo_comp_tiers_pkey PRIMARY KEY (id);

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_pkey PRIMARY KEY (id);

alter table public.cxo_daily_queue_runs add constraint cxo_daily_queue_runs_pkey PRIMARY KEY (id);

alter table public.cxo_decisions add constraint cxo_decisions_pkey PRIMARY KEY (id);

alter table public.cxo_due_digests add constraint cxo_due_digests_pkey PRIMARY KEY (member_id, day);

alter table public.cxo_due_reminders add constraint cxo_due_reminders_card_id_member_id_kind_key UNIQUE (card_id, member_id, kind);

alter table public.cxo_due_reminders add constraint cxo_due_reminders_pkey PRIMARY KEY (id);

alter table public.cxo_employee_kpis add constraint cxo_employee_kpis_pkey PRIMARY KEY (id);

alter table public.cxo_employee_time_off add constraint cxo_employee_time_off_pkey PRIMARY KEY (id);

alter table public.cxo_employees add constraint cxo_employees_pkey PRIMARY KEY (id);

alter table public.cxo_exec_assistants add constraint cxo_exec_assistants_exec_member_id_assistant_member_id_key UNIQUE (exec_member_id, assistant_member_id);

alter table public.cxo_exec_assistants add constraint cxo_exec_assistants_pkey PRIMARY KEY (id);

alter table public.cxo_followup_notices add constraint cxo_followup_notices_pkey PRIMARY KEY (id);

alter table public.cxo_goals add constraint cxo_goals_pkey PRIMARY KEY (id);

alter table public.cxo_ics_feeds add constraint cxo_ics_feeds_member_id_url_key UNIQUE (member_id, url);

alter table public.cxo_ics_feeds add constraint cxo_ics_feeds_pkey PRIMARY KEY (id);

alter table public.cxo_kpi_actuals add constraint cxo_kpi_actuals_kpi_id_period_key_key UNIQUE (kpi_id, period_key);

alter table public.cxo_kpi_actuals add constraint cxo_kpi_actuals_pkey PRIMARY KEY (id);

alter table public.cxo_meeting_agendas add constraint cxo_meeting_agendas_pkey PRIMARY KEY (id);

alter table public.cxo_meeting_series add constraint cxo_meeting_series_pkey PRIMARY KEY (id);

alter table public.cxo_mira_approvals add constraint cxo_mira_approvals_pkey PRIMARY KEY (id);

alter table public.cxo_mira_audit add constraint cxo_mira_audit_pkey PRIMARY KEY (id);

alter table public.cxo_mira_corrections add constraint cxo_mira_corrections_pkey PRIMARY KEY (id);

alter table public.cxo_native_push_tokens add constraint cxo_native_push_tokens_pkey PRIMARY KEY (token);

alter table public.cxo_onboarding add constraint cxo_onboarding_pkey PRIMARY KEY (id);

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_pkey PRIMARY KEY (id);

alter table public.cxo_one_on_ones add constraint cxo_one_on_ones_pkey PRIMARY KEY (id);

alter table public.cxo_partner_actions add constraint cxo_partner_actions_pkey PRIMARY KEY (id);

alter table public.cxo_partners add constraint cxo_partners_pkey PRIMARY KEY (id);

alter table public.cxo_payout_periods add constraint cxo_payout_periods_pkey PRIMARY KEY (id);

alter table public.cxo_payout_periods add constraint cxo_payout_periods_rep_id_period_key_key UNIQUE (rep_id, period_key);

alter table public.cxo_plan_targets add constraint cxo_plan_targets_pkey PRIMARY KEY (id);

alter table public.cxo_plan_targets add constraint cxo_plan_targets_rep_id_year_month_product_carrier_key UNIQUE (rep_id, year, month, product, carrier);

alter table public.cxo_plan_unit_econ add constraint cxo_plan_unit_econ_pkey PRIMARY KEY (id);

alter table public.cxo_plan_unit_econ add constraint cxo_plan_unit_econ_rep_id_year_product_carrier_key UNIQUE (rep_id, year, product, carrier);

alter table public.cxo_plan_uploads add constraint cxo_plan_uploads_pkey PRIMARY KEY (id);

alter table public.cxo_praise add constraint cxo_praise_pkey PRIMARY KEY (id);

alter table public.cxo_qbo_connections add constraint cxo_qbo_connections_pkey PRIMARY KEY (id);

alter table public.cxo_qbo_connections add constraint cxo_qbo_connections_rep_id_key UNIQUE (rep_id);

alter table public.cxo_qbo_employees add constraint cxo_qbo_employees_pkey PRIMARY KEY (id);

alter table public.cxo_qbo_employees add constraint cxo_qbo_employees_rep_id_qbo_id_key UNIQUE (rep_id, qbo_id);

alter table public.cxo_qbo_expense_monthly add constraint cxo_qbo_expense_monthly_pkey PRIMARY KEY (id);

alter table public.cxo_qbo_expense_monthly add constraint cxo_qbo_expense_monthly_rep_id_month_category_key UNIQUE (rep_id, month, category);

alter table public.cxo_qbo_pnl_monthly add constraint cxo_qbo_pnl_monthly_pkey PRIMARY KEY (id);

alter table public.cxo_qbo_pnl_monthly add constraint cxo_qbo_pnl_monthly_rep_id_month_key UNIQUE (rep_id, month);

alter table public.cxo_qbo_revenue_breakdown add constraint cxo_qbo_revenue_breakdown_pkey PRIMARY KEY (id);

alter table public.cxo_qbo_revenue_breakdown add constraint cxo_qbo_revenue_breakdown_rep_id_month_dimension_name_key UNIQUE (rep_id, month, dimension, name);

alter table public.cxo_qbo_time_activity add constraint cxo_qbo_time_activity_pkey PRIMARY KEY (id);

alter table public.cxo_qbo_time_activity add constraint cxo_qbo_time_activity_rep_id_qbo_id_key UNIQUE (rep_id, qbo_id);

alter table public.cxo_report_jobs add constraint cxo_report_jobs_pkey PRIMARY KEY (id);

alter table public.cxo_reviews add constraint cxo_reviews_pkey PRIMARY KEY (id);

alter table public.cxo_slack_installs add constraint cxo_slack_installs_pkey PRIMARY KEY (rep_id);

alter table public.cxo_slack_threads add constraint cxo_slack_threads_pkey PRIMARY KEY (team_id, channel, thread_ts, member_id);

alter table public.cxo_todo_note_scans add constraint cxo_todo_note_scans_pkey PRIMARY KEY (note_id);

alter table public.cxo_todos add constraint cxo_todos_pkey PRIMARY KEY (id);

alter table public.cxo_weekly_status add constraint cxo_weekly_status_pkey PRIMARY KEY (id);

alter table public.cxo_whop_webhook_events add constraint cxo_whop_webhook_events_pkey PRIMARY KEY (id);

alter table public.deferred_items add constraint deferred_items_pkey PRIMARY KEY (id);

alter table public.dialer_hour_grants add constraint dialer_hour_grants_pkey PRIMARY KEY (id);

alter table public.dialer_hour_grants add constraint dialer_hour_grants_rep_id_week_start_grantee_member_id_gran_key UNIQUE (rep_id, week_start, grantee_member_id, granter_member_id);

alter table public.dialer_kpis add constraint dialer_kpis_pkey PRIMARY KEY (rep_id, day);

alter table public.dialer_mode_allocations add constraint dialer_mode_allocations_pkey PRIMARY KEY (id);

alter table public.dialer_mode_allocations add constraint dialer_mode_allocations_rep_id_member_id_week_start_mode_key UNIQUE (rep_id, member_id, week_start, mode);

alter table public.dialer_queue add constraint dialer_queue_pkey PRIMARY KEY (id);

alter table public.dialer_queue_events add constraint dialer_queue_events_pkey PRIMARY KEY (id);

alter table public.dialer_shifts add constraint dialer_shifts_pkey PRIMARY KEY (id);

alter table public.dialer_transfer_availability add constraint dialer_transfer_availability_pkey PRIMARY KEY (id);

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_pkey PRIMARY KEY (id);

alter table public.email_drafts add constraint email_drafts_pkey PRIMARY KEY (id);

alter table public.email_messages add constraint email_messages_gmail_message_id_key UNIQUE (gmail_message_id);

alter table public.email_messages add constraint email_messages_pkey PRIMARY KEY (id);

alter table public.email_threads add constraint email_threads_pkey PRIMARY KEY (id);

alter table public.email_threads add constraint email_threads_rep_id_gmail_thread_id_key UNIQUE (rep_id, gmail_thread_id);

alter table public.feature_requests add constraint feature_requests_pkey PRIMARY KEY (id);

alter table public.fix_requests add constraint fix_requests_pkey PRIMARY KEY (id);

alter table public.gmail_sync_state add constraint gmail_sync_state_id_pkey PRIMARY KEY (id);

alter table public.google_tokens add constraint google_tokens_id_pkey PRIMARY KEY (id);

alter table public.import_batches add constraint import_batches_pkey PRIMARY KEY (id);

alter table public.invoices add constraint invoices_pkey PRIMARY KEY (id);

alter table public.job_runs add constraint job_runs_pkey PRIMARY KEY (id);

alter table public.kpi_cards add constraint kpi_cards_pkey PRIMARY KEY (id);

alter table public.kpi_entries add constraint kpi_entries_pkey PRIMARY KEY (id);

alter table public.lead_activities add constraint lead_activities_pkey PRIMARY KEY (id);

alter table public.lead_campaign_events add constraint lead_campaign_events_pkey PRIMARY KEY (id);

alter table public.lead_campaigns add constraint lead_campaigns_pkey PRIMARY KEY (id);

alter table public.lead_events add constraint lead_events_pkey PRIMARY KEY (id);

alter table public.lead_notes add constraint lead_notes_pkey PRIMARY KEY (id);

alter table public.leads add constraint leads_pkey PRIMARY KEY (id);

alter table public.liability_agreements add constraint liability_agreements_member_id_agreement_version_key UNIQUE (member_id, agreement_version);

alter table public.liability_agreements add constraint liability_agreements_pkey PRIMARY KEY (id);

alter table public.local_presence_numbers add constraint local_presence_numbers_pkey PRIMARY KEY (id);

alter table public.mcp_tokens add constraint mcp_tokens_pkey PRIMARY KEY (id);

alter table public.meeting_inbound_tokens add constraint meeting_inbound_tokens_pkey PRIMARY KEY (token);

alter table public.meeting_inbound_tokens add constraint meeting_inbound_tokens_rep_id_member_id_key UNIQUE (rep_id, member_id);

alter table public.meetings add constraint meetings_pkey PRIMARY KEY (id);

alter table public.meetings add constraint meetings_rep_id_source_source_event_id_key UNIQUE (rep_id, source, source_event_id);

alter table public.member_addons add constraint member_addons_pkey PRIMARY KEY (rep_id, member_id, addon_key);

alter table public.member_message_triage add constraint member_message_triage_pkey PRIMARY KEY (message_id);

alter table public.member_messages add constraint member_messages_pkey PRIMARY KEY (id);

alter table public.members add constraint members_pkey PRIMARY KEY (id);

alter table public.onboarding_tokens add constraint onboarding_tokens_pkey PRIMARY KEY (id);

alter table public.onboarding_tokens add constraint onboarding_tokens_stripe_session_id_key UNIQUE (stripe_session_id);

alter table public.onboarding_tokens add constraint onboarding_tokens_token_key UNIQUE (token);

alter table public.org_billing_week add constraint org_billing_week_pkey PRIMARY KEY (id);

alter table public.org_billing_week add constraint org_billing_week_rep_id_iso_week_key UNIQUE (rep_id, iso_week);

alter table public.outbound_messages add constraint outbound_messages_pkey PRIMARY KEY (id);

alter table public.payroll_deposits add constraint payroll_deposits_pkey PRIMARY KEY (id);

alter table public.payroll_settings add constraint payroll_settings_pkey PRIMARY KEY (rep_id);

alter table public.pinnacle_agent_dir add constraint pinnacle_agent_dir_pkey PRIMARY KEY (id);

alter table public.pinnacle_airtable_records add constraint pinnacle_airtable_records_pkey PRIMARY KEY (base_id, table_name, record_id);

alter table public.pinnacle_airtable_snapshots add constraint pinnacle_airtable_snapshots_pkey PRIMARY KEY (base_id, snapshot_date);

alter table public.pinnacle_airtable_sync_runs add constraint pinnacle_airtable_sync_runs_pkey PRIMARY KEY (id);

alter table public.pinnacle_daily_rollup add constraint pinnacle_daily_rollup_pkey PRIMARY KEY (base_id, d, line);

alter table public.pinnacle_dim_rollup add constraint pinnacle_dim_rollup_pkey PRIMARY KEY (dim, d, line, label, team);

alter table public.pinnacle_dim_rollup_month add constraint pinnacle_dim_rollup_month_pkey PRIMARY KEY (dim, m, line, label, team);

alter table public.pinnacle_maintenance_log add constraint pinnacle_maintenance_log_pkey PRIMARY KEY (id);

alter table public.pinnacle_name_map add constraint pinnacle_name_map_pkey PRIMARY KEY (record_id);

alter table public.pinnacle_people_rollup add constraint pinnacle_people_rollup_pkey PRIMARY KEY (id);

alter table public.pinnacle_rollup_cache add constraint pinnacle_rollup_cache_pkey PRIMARY KEY (tenant_id);

alter table public.pinnacle_status_rollup add constraint pinnacle_status_rollup_pkey PRIMARY KEY (d, line);

alter table public.pinnacle_sync_cursor add constraint pinnacle_sync_cursor_pkey PRIMARY KEY (base_id, table_name);

alter table public.pinnacle_sync_state add constraint pinnacle_sync_state_pkey PRIMARY KEY (id);

alter table public.pinnacle_sync_table_runs add constraint pinnacle_sync_table_runs_pkey PRIMARY KEY (id);

alter table public.pipeline_items add constraint pipeline_items_pkey PRIMARY KEY (id);

alter table public.pipeline_stages add constraint pipeline_stages_pkey PRIMARY KEY (id);

alter table public.pipelines add constraint pipelines_pkey PRIMARY KEY (id);

alter table public.plaud_actions add constraint plaud_actions_pkey PRIMARY KEY (id);

alter table public.plaud_agent_guidance add constraint plaud_agent_guidance_pkey PRIMARY KEY (id);

alter table public.plaud_daily_plans add constraint plaud_daily_plans_pkey PRIMARY KEY (id);

alter table public.plaud_notes add constraint plaud_notes_pkey PRIMARY KEY (id);

alter table public.plaud_plan_feedback add constraint plaud_plan_feedback_pkey PRIMARY KEY (id);

alter table public.plaud_settings add constraint plaud_settings_pkey PRIMARY KEY (rep_id);

alter table public.project_sections add constraint project_sections_pkey PRIMARY KEY (id);

alter table public.project_task_steps add constraint project_task_steps_pkey PRIMARY KEY (id);

alter table public.project_tasks add constraint project_tasks_pkey PRIMARY KEY (id);

alter table public.projects add constraint projects_pkey PRIMARY KEY (id);

alter table public.prospects add constraint prospects_pkey PRIMARY KEY (id);

alter table public.prospects add constraint prospects_source_external_uniq UNIQUE (source, external_id);

alter table public.rate_limit_buckets add constraint rate_limit_buckets_pkey PRIMARY KEY (key);

alter table public.recommendation_suppressions add constraint recommendation_suppressions_pkey PRIMARY KEY (rep_id, kind);

alter table public.recommendations add constraint recommendations_pkey PRIMARY KEY (id);

alter table public.recommendations add constraint recommendations_rep_id_dedupe_key_key UNIQUE (rep_id, dedupe_key);

alter table public.rep_addons add constraint rep_addons_pkey PRIMARY KEY (rep_id, addon_key);

alter table public.rep_api_keys add constraint rep_api_keys_key_hash_key UNIQUE (key_hash);

alter table public.rep_api_keys add constraint rep_api_keys_pkey PRIMARY KEY (id);

alter table public.rep_contacts add constraint rep_contacts_pkey PRIMARY KEY (id);

alter table public.reps add constraint reps_pkey PRIMARY KEY (id);

alter table public.reps add constraint reps_slug_key UNIQUE (slug);

alter table public.roleplay_assignments add constraint roleplay_assignments_pkey PRIMARY KEY (id);

alter table public.roleplay_daily_activity add constraint roleplay_daily_activity_pkey PRIMARY KEY (rep_id, member_id, day);

alter table public.roleplay_quotas add constraint roleplay_quotas_pkey PRIMARY KEY (id);

alter table public.roleplay_reviews add constraint roleplay_reviews_pkey PRIMARY KEY (id);

alter table public.roleplay_scenario_docs add constraint roleplay_scenario_docs_pkey PRIMARY KEY (scenario_id, doc_id);

alter table public.roleplay_scenarios add constraint roleplay_scenarios_pkey PRIMARY KEY (id);

alter table public.roleplay_sessions add constraint roleplay_sessions_pkey PRIMARY KEY (id);

alter table public.roleplay_training_docs add constraint roleplay_training_docs_pkey PRIMARY KEY (id);

alter table public.roleplay_turns add constraint roleplay_turns_pkey PRIMARY KEY (id);

alter table public.room_deliveries add constraint room_deliveries_pkey PRIMARY KEY (id);

alter table public.room_messages add constraint room_messages_pkey PRIMARY KEY (id);

alter table public.room_todos add constraint room_todos_pkey PRIMARY KEY (id);

alter table public.sms_ai_sessions add constraint sms_ai_sessions_lead_id_rep_id_key UNIQUE (lead_id, rep_id);

alter table public.sms_ai_sessions add constraint sms_ai_sessions_pkey PRIMARY KEY (id);

alter table public.sms_messages add constraint sms_messages_pkey PRIMARY KEY (id);

alter table public.sms_messages add constraint sms_messages_provider_message_id_key UNIQUE (provider_message_id);

alter table public.stripe_events add constraint stripe_events_pkey PRIMARY KEY (id);

alter table public.targets add constraint targets_pkey PRIMARY KEY (id);

alter table public.team_members add constraint team_members_pkey PRIMARY KEY (id);

alter table public.teams add constraint teams_pkey PRIMARY KEY (id);

alter table public.usage_events add constraint usage_events_pkey PRIMARY KEY (id);

alter table public.voice_calls add constraint voice_calls_pkey PRIMARY KEY (id);

alter table public.voice_calls add constraint voice_calls_provider_provider_call_id_key UNIQUE (provider, provider_call_id);

alter table public.voice_memos add constraint voice_memos_pkey PRIMARY KEY (id);

alter table public.worker_health add constraint worker_health_pkey PRIMARY KEY (worker);

CREATE OR REPLACE FUNCTION public.agent_member_memory_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.agent_usage_increment(p_rep_id text, p_member_id uuid, p_day date, p_input_tokens integer DEFAULT 0, p_output_tokens integer DEFAULT 0, p_tool_calls integer DEFAULT 0, p_errors integer DEFAULT 0, p_model text DEFAULT NULL::text, p_est_cost_usd numeric DEFAULT 0)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare new_count int;
begin
  insert into agent_usage (rep_id, member_id, day, requests, input_tokens, output_tokens, tool_calls, errors, model, est_cost_usd)
    values (p_rep_id, p_member_id, p_day, 1, p_input_tokens, p_output_tokens, p_tool_calls, p_errors, p_model, coalesce(p_est_cost_usd, 0))
  on conflict (rep_id, member_id, day) do update
    set requests      = agent_usage.requests      + 1,
        input_tokens  = agent_usage.input_tokens  + p_input_tokens,
        output_tokens = agent_usage.output_tokens + p_output_tokens,
        tool_calls    = agent_usage.tool_calls    + p_tool_calls,
        errors        = agent_usage.errors        + p_errors,
        model         = coalesce(p_model, agent_usage.model),
        est_cost_usd  = agent_usage.est_cost_usd  + coalesce(p_est_cost_usd, 0),
        updated_at    = now()
  returning requests into new_count;
  return new_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.bump_stage_changed_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.pipeline_stage is distinct from old.pipeline_stage then
    new.stage_changed_at = now();
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_activity_hit(p_rep text, p_member uuid, p_day date, p_path text, p_bump boolean)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  insert into public.cxo_activity (rep_id, member_id, day, path, count)
  values (p_rep, p_member, p_day, left(p_path, 120), 1)
  on conflict (member_id, day, path) do update
    set count = public.cxo_activity.count + 1, updated_at = now()
    where p_bump;
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_boards_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at := now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION public.cxo_book_breakdown(p_rep_id text, p_dim text, p_line text, p_start date, p_end date, p_limit integer DEFAULT 50)
 RETURNS TABLE(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint, lapsed bigint, pending bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select coalesce(case lower(p_dim) when 'product' then pol.product when 'team' then pr.agency when 'line' then pol.line else pol.carrier end, 'Not recorded') as label,
    null::text,
    round(sum(pol.annual_premium)),
    round(sum(case when pol.status in ('issued', 'lapsed') then pol.annual_premium else 0 end)),
    count(*)::bigint,
    count(*) filter (where pol.status = 'issued')::bigint,
    count(*) filter (where pol.status = 'declined')::bigint,
    count(*) filter (where pol.status = 'lapsed')::bigint,
    count(*) filter (where pol.status = 'submitted')::bigint
  from cxo_book_policies pol
  left join cxo_book_producers pr on pr.id = pol.producer_id
  where pol.rep_id = p_rep_id and pol.submitted_on between p_start and p_end
    and pol.status <> 'withdrawn'
    and (p_line is null or p_line = 'All' or pol.line = p_line)
  group by 1
  order by 5 desc, 1
  limit greatest(1, least(p_limit, 200));
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_book_producer_production(p_rep_id text, p_line text, p_start date, p_end date, p_name text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS TABLE(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint, lapsed bigint, pending bigint, first_policy date, contracted_at date, status text)
 LANGUAGE sql
 STABLE
AS $function$
  with firsts as (
    select producer_id, min(submitted_on) as first_policy
    from public.cxo_book_policies where rep_id = p_rep_id group by producer_id
  ),
  win as (
    select pol.producer_id,
      sum(pol.annual_premium) as premium,
      sum(case when pol.status in ('issued', 'lapsed') then pol.annual_premium else 0 end) as funded,
      count(*) as policies,
      count(*) filter (where pol.status = 'issued') as paid,
      count(*) filter (where pol.status = 'declined') as declined,
      count(*) filter (where pol.status = 'lapsed') as lapsed,
      count(*) filter (where pol.status = 'submitted') as pending
    from public.cxo_book_policies pol
    where pol.rep_id = p_rep_id and pol.submitted_on between p_start and p_end
      and pol.status <> 'withdrawn'
      and (p_line is null or p_line = 'All' or pol.line = p_line)
    group by pol.producer_id
  )
  select p.name, p.agency, coalesce(w.premium, 0), coalesce(w.funded, 0), coalesce(w.policies, 0)::bigint,
    coalesce(w.paid, 0)::bigint, coalesce(w.declined, 0)::bigint, coalesce(w.lapsed, 0)::bigint, coalesce(w.pending, 0)::bigint,
    f.first_policy, p.contracted_at, p.status
  from public.cxo_book_producers p
  left join win w on w.producer_id = p.id
  left join firsts f on f.producer_id = p.id
  where p.rep_id = p_rep_id
    and (p_name is null or p.name ilike '%' || p_name || '%')
    -- Everyone with business in the window, plus anyone contracted in it (new producers with no business yet).
    and (w.producer_id is not null or p.contracted_at between p_start and p_end or p_name is not null)
  order by 3 desc, 1
  limit greatest(1, least(p_limit, 20000));
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_bump_todo_mentions(p_rep_id text, p_member_id uuid, p_ids uuid[], p_note_id uuid, p_title text, p_at timestamp with time zone)
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  update cxo_todos t
  set mentions = t.mentions + x.n, note_id = p_note_id, meeting_title = p_title, meeting_at = p_at, updated_at = now()
  from (select id, count(*)::int n from unnest(p_ids) id group by id) x
  where t.id = x.id and t.rep_id = p_rep_id and t.member_id = p_member_id;
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_partners_search_text()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.search_text := lower(
    coalesce(new.name, '') || ' ' || coalesce(new.org, '') || ' ' || coalesce(new.role, '') || ' ' ||
    coalesce(new.email, '') || ' ' || coalesce(new.email_secondary, '') || ' ' || coalesce(new.email_support, '') || ' ' ||
    coalesce(new.phone, '') || ' ' || coalesce(new.phone_office, '') || ' ' ||
    regexp_replace(coalesce(new.phone, ''), '\D', '', 'g') || ' ' ||
    regexp_replace(coalesce(new.phone_office, ''), '\D', '', 'g') || ' ' ||
    coalesce(array_to_string(new.tags, ' '), '')
  );
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cxo_partners_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at := now();
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.cxo_placement_maturity(p_source text, p_rep_id text, p_line text, p_today date, p_weeks integer DEFAULT 16)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ages as (
    select ((p_today - s.d) / 7)::int as wk, sum(s.total)::bigint as apps, sum(s.submitted)::bigint as pending
    from pinnacle_status_rollup s
    where p_source = 'pinnacle' and s.d <= p_today and s.d > p_today - 7 * least(greatest(p_weeks, 4), 52)
      and (p_line is null or p_line = 'All' or s.line = p_line)
    group by 1
    union all
    select ((p_today - pol.submitted_on) / 7)::int, count(*)::bigint, count(*) filter (where pol.status = 'submitted')::bigint
    from cxo_book_policies pol
    where p_source = 'tenant' and pol.rep_id = p_rep_id and pol.status <> 'withdrawn'
      and pol.submitted_on <= p_today and pol.submitted_on > p_today - 7 * least(greatest(p_weeks, 4), 52)
      and (p_line is null or p_line = 'All' or pol.line = p_line)
    group by 1
  ),
  issue_lag as (
    select (pol.issued_on - pol.submitted_on) as days
    from cxo_book_policies pol
    where p_source = 'tenant' and pol.rep_id = p_rep_id and pol.issued_on is not null
      and pol.submitted_on > p_today - 365 and pol.submitted_on <= p_today
      and (p_line is null or p_line = 'All' or pol.line = p_line)
  )
  select jsonb_build_object(
    'basis', case when p_source = 'pinnacle' then 'effective_date' else 'submitted_on' end,
    'curve', coalesce((select jsonb_agg(jsonb_build_object('week', wk, 'apps', apps, 'pending', pending) order by wk) from ages), '[]'::jsonb),
    'median_issue_days', (select percentile_cont(0.5) within group (order by days) from issue_lag),
    'p90_issue_days', (select percentile_cont(0.9) within group (order by days) from issue_lag),
    'issued_sample', (select count(*) from issue_lag)
  );
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_producer_retention(p_source text, p_rep_id text, p_line text, p_start date, p_end date, p_prior_start date, p_prior_end date, p_today date, p_team text DEFAULT NULL::text, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with
  raw_w as (
    select agent, line, wrote, ap from pinnacle_agent_writes where p_source = 'pinnacle'
    union all
    select pol.producer_id::text, pol.line, pol.submitted_on, pol.annual_premium
    from cxo_book_policies pol
    where p_source = 'tenant' and pol.rep_id = p_rep_id and pol.status not in ('declined', 'withdrawn')
  ),
  dir as (
    select id, name, team, created, status, status_changed, leaving from pinnacle_agent_dir where p_source = 'pinnacle'
    union all
    select p.id::text, p.name, coalesce(p.agency, ''), p.contracted_at, p.status, null::date, false
    from cxo_book_producers p
    where p_source = 'tenant' and p.rep_id = p_rep_id
  ),
  dir_f as (
    select * from dir where p_team is null or team ilike '%' || p_team || '%'
  ),
  w as (
    select x.agent, x.wrote, x.ap
    from raw_w x left join dir d on d.id = x.agent
    where x.wrote <= p_today
      and (p_line is null or p_line = 'All' or x.line = p_line)
      and (p_team is null or d.team ilike '%' || p_team || '%')
  ),
  lw as (
    select agent, min(wrote) as first_wrote, max(wrote) as last_wrote from w group by agent
  ),
  lft as (
    select l.agent, l.first_wrote, l.last_wrote, least(
        case when l.last_wrote + 90 <= p_today then l.last_wrote + 90 end,
        case when d.leaving and d.status_changed between l.last_wrote and least(l.last_wrote + 90, p_today) then d.status_changed end
      ) as left_on
    from lw l left join dir d on d.id = l.agent
  ),
  per as (
    select k, s, least(e, p_today) as e
    from (values ('now', p_start, p_end), ('prior', p_prior_start, p_prior_end)) v(k, s, e)
  ),
  hc_start as (
    select p.k, w.agent
    from per p join w on w.wrote > p.s - 91 and w.wrote <= p.s - 1
    join lft l on l.agent = w.agent
    where l.left_on is null or l.left_on > p.s - 1
    group by p.k, w.agent
  ),
  hc_end as (
    select p.k, w.agent
    from per p join w on w.wrote > p.e - 90 and w.wrote <= p.e
    join lft l on l.agent = w.agent
    where l.left_on is null or l.left_on > p.e
    group by p.k, w.agent
  ),
  gaps as (
    select agent, wrote, wrote - lag(wrote) over (partition by agent order by wrote) as gap from w
  ),
  stats as (
    select p.k, jsonb_build_object(
      'start', p.s, 'end', p.e,
      'active_start', (select count(*) from hc_start h where h.k = p.k),
      'retained', (select count(*) from hc_start h join lft l on l.agent = h.agent where h.k = p.k and (l.left_on is null or l.left_on > p.e)),
      'stopped', (select count(*) from lft l where l.left_on between p.s and p.e),
      'active_end', (select count(*) from hc_end h where h.k = p.k),
      'writing', (select count(distinct agent) from w where w.wrote between p.s and p.e),
      'new_writers', (select count(*) from lw where lw.first_wrote between p.s and p.e),
      'joined', (select count(*) from dir_f d where d.created between p.s and p.e),
      'reactivated', (select count(distinct g.agent) from gaps g where g.wrote between p.s and p.e and g.gap >= 90)
    ) as v
    from per p
  ),
  tail as (
    -- What each agent wrote in the 90 days up to their last policy.
    select w.agent, count(*) as policies, round(sum(w.ap)) as ap
    from w join lft l on l.agent = w.agent
    where w.wrote > l.last_wrote - 90
    group by w.agent
  ),
  quiet as (
    select coalesce(d.name, 'Unnamed agent') as name, nullif(d.team, '') as team, l.last_wrote as last_sale, l.left_on as stopped_on,
      case when l.left_on = l.last_wrote + 90 then 'no policy in 90 days' else 'marked ' || coalesce(d.status, 'inactive') end as why,
      t.policies as policies_last_90_days_before, t.ap as ap_last_90_days_before
    from lft l
    join per p on p.k = 'now'
    left join dir d on d.id = l.agent
    left join tail t on t.agent = l.agent
    where l.left_on between p.s and p.e
  ),
  -- Drifting is a today figure, whatever window is asked (QA 2026-10-18: a
  -- last-quarter board update counted it as of the quarter's end and said 374
  -- while the retention answer said 498). Same rule as the agent page: active
  -- today (a policy in the last 90 days, not marked leaving), last policy 30 to
  -- 89 days ago.
  hc_today as (
    select w.agent, max(w.wrote) as last_sale
    from w join lft l on l.agent = w.agent
    where w.wrote > p_today - 90 and w.wrote <= p_today
      and (l.left_on is null or l.left_on > p_today)
    group by w.agent
  ),
  risk2 as (
    select coalesce(d.name, 'Unnamed agent') as name, nullif(d.team, '') as team, r.last_sale,
      (p_today - r.last_sale) as days_since, t.ap as ap_last_90_days_before
    from hc_today r
    left join dir d on d.id = r.agent
    left join tail t on t.agent = r.agent
    where p_today - r.last_sale >= 30
  )
  select jsonb_build_object(
    'inactive_after_days', 90,
    'data_through', (select max(wrote) from w),
    'now', (select v from stats where k = 'now'),
    'prior', (select v from stats where k = 'prior'),
    'went_quiet_count', (select count(*) from quiet),
    'reactivated_agents', coalesce((select jsonb_agg(to_jsonb(x) order by x.came_back_on desc)
      from (select coalesce(d.name, 'Unnamed agent') as name, nullif(d.team, '') as team, min(g.wrote) as came_back_on, max(g.gap) as gap_days
            from gaps g join per p on p.k = 'now' left join dir d on d.id = g.agent
            where g.wrote between p.s and p.e and g.gap >= 90
            group by g.agent, d.name, d.team
            order by 3 desc
            limit greatest(1, least(p_limit, 200))) x), '[]'::jsonb),
    'went_quiet', coalesce((select jsonb_agg(to_jsonb(q) order by q.ap_last_90_days_before desc nulls last, q.last_sale desc)
      from (select * from quiet order by ap_last_90_days_before desc nulls last, last_sale desc limit greatest(1, least(p_limit, 200))) q), '[]'::jsonb),
    'drifting', jsonb_build_object(
      'as_of', p_today,
      'days_30_59', (select count(*) from risk2 where days_since < 60),
      'days_60_89', (select count(*) from risk2 where days_since >= 60),
      'top', coalesce((select jsonb_agg(to_jsonb(x) order by x.ap_last_90_days_before desc nulls last)
        from (select * from risk2 order by ap_last_90_days_before desc nulls last limit 10) x), '[]'::jsonb))
  );
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_producer_rows(p_source text, p_rep_id text, p_line text, p_start date, p_end date, p_name text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare out jsonb;
begin
  if p_source = 'pinnacle' then
    select coalesce(jsonb_agg(jsonb_build_array(x.label, x.team, x.premium, x.funded, x.policies, x.paid, x.declined, x.lapsed,
      x.pending, x.first_policy, x.contracted_at, x.status)), '[]'::jsonb)
    into out
    from public.pinnacle_producer_production(p_line, p_start, p_end, p_name, 20000) x;
  else
    select coalesce(jsonb_agg(jsonb_build_array(x.label, x.team, x.premium, x.funded, x.policies, x.paid, x.declined, x.lapsed,
      x.pending, x.first_policy, x.contracted_at, x.status)), '[]'::jsonb)
    into out
    from public.cxo_book_producer_production(p_rep_id, p_line, p_start, p_end, p_name, 20000) x;
  end if;
  return out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cxo_todos_touch()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at = now(); return new; end $function$
;

CREATE OR REPLACE FUNCTION public.enforce_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count integer;
  v_window_start timestamptz;
BEGIN
  INSERT INTO rate_limit_buckets (key, count, window_start)
  VALUES (p_key, 1, now())
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
                  WHEN rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
                    THEN 1
                  ELSE rate_limit_buckets.count + 1
                END,
        window_start = CASE
                  WHEN rate_limit_buckets.window_start < now() - make_interval(secs => p_window_seconds)
                    THEN now()
                  ELSE rate_limit_buckets.window_start
                END
  RETURNING count, window_start INTO v_count, v_window_start;
  RETURN v_count <= p_limit;
END
$function$
;

CREATE OR REPLACE FUNCTION public.gmail_sync_state_record(p_rep_id text, p_member_id uuid, p_history_id text, p_ok boolean, p_error text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  if p_member_id is null then
    insert into gmail_sync_state
      (rep_id, member_id, last_history_id, last_synced_at, last_error, consecutive_errors)
    values
      (p_rep_id, null, p_history_id, now(),
       case when p_ok then null else coalesce(p_error, 'unknown') end,
       case when p_ok then 0 else 1 end)
    on conflict (rep_id) where member_id is null do update set
      last_history_id = coalesce(excluded.last_history_id, gmail_sync_state.last_history_id),
      last_synced_at  = now(),
      last_error      = case when p_ok then null else coalesce(p_error, 'unknown') end,
      consecutive_errors = case when p_ok then 0 else gmail_sync_state.consecutive_errors + 1 end;
  else
    insert into gmail_sync_state
      (rep_id, member_id, last_history_id, last_synced_at, last_error, consecutive_errors)
    values
      (p_rep_id, p_member_id, p_history_id, now(),
       case when p_ok then null else coalesce(p_error, 'unknown') end,
       case when p_ok then 0 else 1 end)
    on conflict (rep_id, member_id) where member_id is not null do update set
      last_history_id = coalesce(excluded.last_history_id, gmail_sync_state.last_history_id),
      last_synced_at  = now(),
      last_error      = case when p_ok then null else coalesce(p_error, 'unknown') end,
      consecutive_errors = case when p_ok then 0 else gmail_sync_state.consecutive_errors + 1 end;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.member_messages_same_org()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from members where id = new.from_member_id and rep_id = new.rep_id)
     or not exists (select 1 from members where id = new.to_member_id and rep_id = new.rep_id) then
    raise exception 'member_messages: sender and recipient must both belong to org %', new.rep_id;
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_agent_contacts(p_names text[])
 RETURNS TABLE(name text, phone text, email text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select distinct on ((fields->>'Pinnacle Team Member'))
    (fields->>'Pinnacle Team Member'),
    coalesce(fields->>'Phone', fields->>'Phone Number', fields->>'Mobile', fields->>'Mobile Phone', fields->>'Cell', fields->>'Cell Phone'),
    coalesce(fields->>'Email', fields->>'Email Address')
  from pinnacle_airtable_records
  where table_name = 'Pinnacle Directory'
    and (fields->>'Pinnacle Team Member') = any(p_names)
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_breakdown(p_dim text, p_line text, p_start date, p_end date, p_limit integer DEFAULT 25)
 RETURNS TABLE(label text, premium numeric, policies bigint, paid bigint, declined bigint, lapsed bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select r.label, round(sum(r.premium)), sum(r.policies)::bigint, sum(r.paid)::bigint,
    sum(r.declined)::bigint, sum(r.lapsed)::bigint
  from pinnacle_dim_rollup r
  where r.dim = lower(p_dim)
    and r.d between p_start and p_end
    and (p_line = 'All' or r.line = p_line)
  group by r.label
  order by 2 desc nulls last
  limit greatest(1, least(p_limit, 200));
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_breakdown_v2(p_dim text, p_line text, p_start date, p_end date, p_limit integer DEFAULT 25)
 RETURNS TABLE(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint, lapsed bigint)
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  -- First whole month inside the window, and the day after the last one.
  ms date := case when p_start = date_trunc('month', p_start)::date then p_start
                  else (date_trunc('month', p_start) + interval '1 month')::date end;
  me date := case when p_end = (date_trunc('month', p_end) + interval '1 month - 1 day')::date
                  then (date_trunc('month', p_end) + interval '1 month')::date
                  else date_trunc('month', p_end)::date end;
  v_dim text := lower(p_dim);
begin
  if ms >= me then
    -- No whole month inside the window: daily rows only.
    ms := p_end + 1;
    me := p_end + 1;
  end if;
  return query
  with rows as (
    -- whole months
    select r.label, r.team, r.premium, r.funded, r.policies, r.paid, r.declined, r.lapsed
    from pinnacle_dim_rollup_month r
    where r.dim = v_dim and r.m >= ms and r.m < me
      and (p_line = 'All' or r.line = p_line)
    union all
    -- partial first month (or the whole window when it has no whole month)
    select r.label, r.team, r.premium, r.funded, r.policies, r.paid, r.declined, r.lapsed
    from pinnacle_dim_rollup r
    where r.dim = v_dim and r.d >= p_start and r.d < least(ms, p_end + 1)
      and (p_line = 'All' or r.line = p_line)
    union all
    -- partial last month
    select r.label, r.team, r.premium, r.funded, r.policies, r.paid, r.declined, r.lapsed
    from pinnacle_dim_rollup r
    where r.dim = v_dim and r.d >= greatest(me, p_start) and r.d <= p_end and me <= p_end
      and (p_line = 'All' or r.line = p_line)
  )
  select x.label, nullif(x.team, ''), round(sum(x.premium)), round(sum(x.funded)),
    sum(x.policies)::bigint, sum(x.paid)::bigint, sum(x.declined)::bigint, sum(x.lapsed)::bigint
  from rows x
  group by x.label, x.team
  order by 3 desc nulls last
  limit greatest(1, least(p_limit, 200));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_build_agent_writes()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '600s'
AS $function$
begin
  delete from pinnacle_agent_writes;
  insert into pinnacle_agent_writes (agent, line, wrote, ap)
  select agent, line, wrote, ap from (
    -- One row per policy number (latest edit wins), same dedupe and dates as the page.
    select distinct on (r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id))
      r.fields->'Pinnacle Team Member'->>0 as agent,
      case when r.table_name ilike '%health%' then 'Health' when r.table_name ilike '%annuit%' then 'Annuity' else 'Life' end as line,
      least(pinnacle_safe_date(r.fields->>'Effective Date'), pinnacle_safe_date(r.fields->>'Pinnacle Recording Date')) as wrote,
      coalesce(pinnacle_safe_num(r.fields->>'Annual Premium'), 0) as ap,
      lower(coalesce(r.fields->>'Summary Status', '')) as st
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW'
      and r.table_name in ('Pinnacle Life Policies', 'Pinnacle Health Policies', 'Pinnacle Annuity Policies')
    order by r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ) p
  where st <> 'declined' and agent is not null and wrote is not null
    and extract(year from wrote) between 2020 and 2030;

  delete from pinnacle_agent_dir;
  insert into pinnacle_agent_dir (id, name, team, created, status, status_changed, leaving)
  select distinct on (r.record_id) r.record_id,
    coalesce(nullif(btrim(r.fields->>'Pinnacle Team Member'), ''), 'Unnamed agent'),
    coalesce(pinnacle_label(r.fields->'Team (Parsed for Score)'), ''),
    pinnacle_safe_date(r.fields->>'Agent Created On:'),
    r.fields->>'Agent Status',
    pinnacle_safe_date(r.fields->>'Last Agent Status Change'),
    coalesce(r.fields->>'Agent Status', '') in ('Inactive Agent', 'Terminated', 'Agent Release Approved', 'Agent Pending Release')
  from pinnacle_airtable_records r
  where r.base_id = 'appHyYBfI6kfX6ZuW' and r.table_name = 'Pinnacle Directory'
    and coalesce(r.fields->>'Agent Status', '') in ('Active Agent', 'Inactive Agent', 'Team Leader', 'Agent Pending Release',
      'Agent Release Declined', 'New Agent', 'Terminated', 'Agent Release Approved')
  order by r.record_id, r.fetched_at desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_build_people_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  today date := (now() at time zone 'America/New_York')::date;
  book_start date;
  out jsonb;
begin
  create temp table _dir on commit drop as
  select r.record_id as id,
    pinnacle_safe_date(r.fields->>'Agent Created On:') as created,
    r.fields->>'Agent Status' as status,
    pinnacle_safe_date(r.fields->>'Last Agent Status Change') as status_changed,
    coalesce(pinnacle_label(r.fields->'Team (Parsed for Score)'), '') as team,
    coalesce(nullif(btrim(r.fields->>'Pinnacle Team Member'), ''), 'Unnamed agent') as name,
    r.fields->>'First $5K in Sales' as k5,
    r.fields->>'First $10K in Sales' as k10,
    r.fields->>'First Sale?' as first_sale
  from pinnacle_airtable_records r
  where r.base_id = 'appHyYBfI6kfX6ZuW' and r.table_name = 'Pinnacle Directory'
    and coalesce(r.fields->>'Agent Status', '') in ('Active Agent','Inactive Agent','Team Leader','Agent Pending Release','Agent Release Declined','New Agent','Terminated','Agent Release Approved');

  create temp table _pol on commit drop as
  with dd as (
    select distinct on (r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW'
      and r.table_name in ('Pinnacle Life Policies','Pinnacle Health Policies','Pinnacle Annuity Policies')
    order by r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  )
  select r.fields->'Pinnacle Team Member'->>0 as agent,
    case when r.table_name ilike '%health%' then 'Health' when r.table_name ilike '%annuit%' then 'Annuity' else 'Life' end as line,
    pinnacle_safe_date(r.fields->>'Effective Date') as eff,
    least(pinnacle_safe_date(r.fields->>'Effective Date'), pinnacle_safe_date(r.fields->>'Pinnacle Recording Date')) as wrote,
    coalesce(pinnacle_safe_num(r.fields->>'Annual Premium'), 0) as ap,
    lower(coalesce(r.fields->>'Summary Status', '')) as st
  from dd r;
  delete from _pol where wrote is null or extract(year from wrote) not between 2020 and 2030;

  select min(date_trunc('month', wrote))::date into book_start from _pol where wrote >= date '2025-06-01';

  with
  roster as (select * from _dir where status not in ('Terminated','Agent Release Approved')),
  firsts as (
    select agent, min(wrote) as first_wrote from _pol where st <> 'declined' and wrote <= today group by agent
  ),
  cum as (
    select agent, wrote, sum(ap) over (partition by agent order by wrote rows unbounded preceding) as running
    from _pol where st <> 'declined' and wrote <= today
  ),
  ms as (
    select agent, min(wrote) filter (where running >= 5000) as at5, min(wrote) filter (where running >= 10000) as at10 from cum group by agent
  ),
  joiners as (
    select d.*, f.first_wrote, (f.first_wrote - d.created) as days_first,
           (m.at5 - d.created) as days5, (m.at10 - d.created) as days10
    from _dir d left join firsts f on f.agent = d.id left join ms m on m.agent = d.id
    where d.created >= book_start and d.created <= today
  ),
  months as (select generate_series(date_trunc('month', today) - interval '11 months', date_trunc('month', today), interval '1 month')::date as m),
  pers as (
    select p.line, (d.created > p.eff - interval '12 months') as new_agent, p.st
    from _pol p left join _dir d on d.id = p.agent
    where p.eff between (today - interval '12 months')::date and (today - interval '6 months')::date and p.st in ('issue - paid','lapsed')
  )
  select jsonb_build_object(
    'today', today,
    'book_start', book_start,
    'fill', (select jsonb_build_object(
        'directory_rows', count(*),
        'created_on', round(avg((r.fields ? 'Agent Created On:')::int) * 100, 1),
        'agent_status', round(avg((r.fields ? 'Agent Status')::int) * 100, 1),
        'last_status_change', round(avg((r.fields ? 'Last Agent Status Change')::int) * 100, 1),
        'first_sale', round(avg((r.fields ? 'First Sale?')::int) * 100, 1),
        'first_sale_status_change', round(avg((r.fields ? 'First Sale Status Change')::int) * 100, 1),
        'first_5k', round(avg((r.fields ? 'First $5K in Sales')::int) * 100, 1),
        'first_10k', round(avg((r.fields ? 'First $10K in Sales')::int) * 100, 1),
        'npn', round(avg((r.fields ? 'NPN')::int) * 100, 1),
        'team', round(avg((r.fields ? 'Team (Parsed for Score)')::int) * 100, 1))
      from pinnacle_airtable_records r where r.base_id = 'appHyYBfI6kfX6ZuW' and r.table_name = 'Pinnacle Directory'),
    'policies_linked_pct', (select round(avg((agent is not null and exists (select 1 from _dir d where d.id = agent))::int) * 100, 1) from _pol),
    'roster', (select count(*) from roster),
    'active', (select count(*) from roster where status in ('Active Agent','Team Leader','New Agent')),
    'agencies', (select count(distinct team) from roster where team <> '' and status in ('Active Agent','Team Leader','New Agent')),
    'writing30', (select count(distinct agent) from _pol where st <> 'declined' and wrote > today - 30 and wrote <= today),
    'writing90', (select count(distinct agent) from _pol where st <> 'declined' and wrote > today - 90 and wrote <= today),
    'new30', (select count(*) from roster where created > today - 30 and created <= today),
    'writing365', (select count(distinct agent) from _pol where st <> 'declined' and wrote > today - 365 and wrote <= today),
    'new90', (select count(*) from roster where created > today - 90 and created <= today),
    'new365', (select count(*) from roster where created > today - 365 and created <= today),
    'writers_by_month', (select jsonb_agg(jsonb_build_object('m', to_char(mo.m, 'YYYY-MM'),
        'n', (select count(distinct agent) from _pol where st <> 'declined' and wrote >= mo.m and wrote < (mo.m + interval '1 month')::date and wrote <= today)) order by mo.m) from months mo),
    'joins_by_month', (select jsonb_agg(jsonb_build_object('m', to_char(mo.m, 'YYYY-MM'),
        'joined', (select count(*) from _dir d where date_trunc('month', d.created) = mo.m),
        'still_active', (select count(*) from _dir d where date_trunc('month', d.created) = mo.m and d.status in ('Active Agent','Team Leader','New Agent')),
        'inactive', (select count(*) from _dir d where date_trunc('month', d.status_changed) = mo.m and d.status not in ('Active Agent','Team Leader','New Agent')),
        'wrote', (select count(*) from joiners j where date_trunc('month', j.created) = mo.m and j.first_wrote is not null),
        'median_days', (select percentile_cont(0.5) within group (order by greatest(j.days_first, 0)) from joiners j where date_trunc('month', j.created) = mo.m and j.first_wrote is not null)
      ) order by mo.m) from months mo),
    'first_policy', (select jsonb_build_object(
        'joiners', count(*),
        'wrote', count(*) filter (where first_wrote is not null),
        'median_days', percentile_cont(0.5) within group (order by greatest(days_first, 0)) filter (where first_wrote is not null),
        'eligible30', count(*) filter (where created <= today - 30),
        'within30', count(*) filter (where created <= today - 30 and days_first <= 30),
        'eligible60', count(*) filter (where created <= today - 60),
        'within60', count(*) filter (where created <= today - 60 and days_first <= 60),
        'eligible90', count(*) filter (where created <= today - 90),
        'within90', count(*) filter (where created <= today - 90 and days_first <= 90),
        'reached5k', count(*) filter (where days5 is not null),
        'median5k', percentile_cont(0.5) within group (order by greatest(days5, 0)) filter (where days5 is not null),
        'reached10k', count(*) filter (where days10 is not null),
        'median10k', percentile_cont(0.5) within group (order by greatest(days10, 0)) filter (where days10 is not null),
        'dir_5k_flag', count(*) filter (where k5 in ('Achieved','Achievement Recorded')),
        'dir_10k_flag', count(*) filter (where k10 in ('Achieved','Achievement Recorded'))
      ) from joiners),
    'persistency6', (select jsonb_object_agg(line, v) from (
        select coalesce(line, 'All') as line, jsonb_build_object(
          'new_paid', count(*) filter (where new_agent and st = 'issue - paid'),
          'new_total', count(*) filter (where new_agent),
          'rest_paid', count(*) filter (where not coalesce(new_agent, false) and st = 'issue - paid'),
          'rest_total', count(*) filter (where not coalesce(new_agent, false))) as v
        from pers group by rollup (line)) x)
  ) into out;

  -- Retention & turnover (10-09). "Still writing" at month k = a non-declined
  -- policy in the 90 days before join + k months. A joiner only counts at k
  -- when that whole 90-day window sits inside the book (on/after book_start)
  -- and has already happened. The Aug-2024 bulk import is not a real join
  -- date, so retention joiners start Sep 2024.
  create temp table _w on commit drop as
    select agent, wrote, ap from _pol where st <> 'declined' and wrote <= today and agent is not null;
  create index on _w (agent, wrote);

  create temp table _rk on commit drop as
  select j.id, j.created, k, x.at,
    exists (select 1 from _w w where w.agent = j.id and w.wrote > x.at - 90 and w.wrote <= x.at) as writing
  from _dir j
  cross join generate_series(1, 24) k
  cross join lateral (select (j.created + make_interval(months => k))::date as at) x
  where j.created >= date '2024-09-01' and j.created <= today
    and x.at <= today and x.at - 90 >= book_start;

  -- Left = stopped writing (90 days with no policy after their last one), or
  -- moved to a leaving status while still writing; whichever came first.
  create temp table _left on commit drop as
  select a.agent, a.last_wrote, least(
      case when a.last_wrote + 90 <= today then a.last_wrote + 90 end,
      case when d.status in ('Inactive Agent','Terminated','Agent Release Approved','Agent Pending Release')
            and d.status_changed between a.last_wrote and least(a.last_wrote + 90, today) then d.status_changed end
    ) as left_on
  from (select agent, max(wrote) as last_wrote from _w group by agent) a
  left join _dir d on d.id = a.agent;

  out := out || jsonb_build_object('retention', (
    with
    flow_start as (select date_trunc('month', book_start + 90)::date as s),
    fm as (select generate_series((select s from flow_start), date_trunc('month', today)::date, interval '1 month')::date as m),
    flow as (
      select fm.m, least((fm.m + interval '1 month')::date - 1, today) as e,
        (select count(*) from _dir d where d.created >= fm.m and d.created < (fm.m + interval '1 month')::date and d.created <= today) as joined,
        (select count(*) from _left l where l.left_on >= fm.m and l.left_on < (fm.m + interval '1 month')::date) as left_n
      from fm
    ),
    flow2 as (
      select f.*, (select count(distinct w.agent) from _w w left join _left l on l.agent = w.agent
                    where w.wrote > f.e - 90 and w.wrote <= f.e and (l.left_on is null or l.left_on > f.e)) as headcount
      from flow f
    ),
    curve as (select k, count(*) as n, count(*) filter (where writing) as w from _rk group by k),
    coh as (
      select to_char(date_trunc('quarter', created), 'YYYY') || ' Q' || extract(quarter from created) as q,
             date_trunc('quarter', created)::date as qs, k, count(*) as n, count(*) filter (where writing) as w
      from _rk group by 1, 2, 3
    ),
    wash as (
      select d.id, min(w.wrote) as first_wrote, max(w.wrote) as last_wrote
      from _dir d left join _w w on w.agent = d.id
      where d.created >= book_start and d.created <= today - 180
      group by d.id
    ),
    appr as (
      select d.id, d.name, d.team, d.created,
        floor((today - d.created) / 30.44)::int as months_in,
        (select max(wrote) from _w w where w.agent = d.id) as last_wrote,
        (select count(*) from _w w where w.agent = d.id and w.wrote > today - 60) as recent_n,
        (select coalesce(sum(ap), 0) from _w w where w.agent = d.id and w.wrote > today - 60) as recent_ap,
        (select count(*) from _w w where w.agent = d.id and w.wrote > today - 120 and w.wrote <= today - 60) as prior_n,
        (select coalesce(sum(ap), 0) from _w w where w.agent = d.id and w.wrote > today - 120 and w.wrote <= today - 60) as prior_ap
      from _dir d
      where d.status in ('Active Agent','Team Leader','New Agent')
        and d.created > (today - interval '10 months')::date and d.created <= (today - interval '6 months')::date
    )
    select jsonb_build_object(
      'since', '2024-09-01',
      'window_days', 90,
      'milestones', (select jsonb_object_agg('m' || k, jsonb_build_object('n', n, 'writing', w)) from curve where k in (3, 6, 10, 12, 24)),
      'curve', (select jsonb_agg(jsonb_build_object('k', k, 'n', n, 'writing', w) order by k) from curve),
      'cohorts', (select jsonb_agg(jsonb_build_object('q', q, 'start', qs, 'points', pts) order by qs) from (
          select q, qs, jsonb_agg(jsonb_build_object('k', k, 'n', n, 'writing', w) order by k) as pts from coh group by q, qs) c),
      'flow', (select jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'), 'joined', joined, 'left', left_n, 'headcount', headcount, 'partial', e < (m + interval '1 month')::date - 1) order by m) from flow2),
      'turnover', (select jsonb_build_object(
          'from', min(m), 'to', today,
          'left', sum(left_n),
          'avg_headcount', round(avg(headcount) filter (where e = (m + interval '1 month')::date - 1), 1),
          'months', round(((today - min(m)) + 1) / 30.44, 2)) from flow2),
      'washout', (select jsonb_build_object(
          'eligible', count(*),
          'never', count(*) filter (where first_wrote is null),
          'stopped90', count(*) filter (where first_wrote is not null and last_wrote - first_wrote <= 90 and last_wrote <= today - 90)) from wash),
      'approaching', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'team', team, 'months_in', months_in,
            'last_wrote', last_wrote, 'recent_n', recent_n, 'prior_n', prior_n, 'recent_ap', recent_ap, 'prior_ap', prior_ap)
          order by (prior_ap - recent_ap) desc) from (select * from appr where prior_n > 0 and recent_ap < prior_ap order by (prior_ap - recent_ap) desc limit 40) a), '[]'::jsonb),
      'approaching_total', (select count(*) from appr where prior_n > 0 and recent_ap < prior_ap)
    )));

  insert into pinnacle_people_rollup (id, data, computed_at) values (1, out, now())
  on conflict (id) do update set data = excluded.data, computed_at = excluded.computed_at;
  return out;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_build_snapshot(p_base_id text)
 RETURNS TABLE(total_rows bigint, policy_rows bigint, skipped_agent_rows bigint, revenue_total numeric, apps_submitted bigint, apps_approved bigint, apps_funded bigint)
 LANGUAGE sql
 STABLE
AS $function$
  WITH base AS (
    SELECT
      (lower(table_name) LIKE '%directory%' OR lower(table_name) LIKE '%agent list%') AS is_agent,
      fields
    FROM pinnacle_airtable_records
    WHERE base_id = p_base_id
  ),
  agg AS (
    SELECT
      count(*)                                  AS total_rows,
      count(*) FILTER (WHERE is_agent)          AS skipped_agent_rows,
      count(*) FILTER (WHERE NOT is_agent)      AS policy_rows,
      round(coalesce(sum(
        CASE WHEN NOT is_agent
              AND regexp_replace(coalesce(fields->>'Annual Premium',''),'[$,[:space:]]','','g') ~ '^-?[0-9]+(\.[0-9]+)?$'
             THEN regexp_replace(fields->>'Annual Premium','[$,[:space:]]','','g')::numeric
             ELSE 0 END
      ), 0), 2)                                 AS revenue_sum,
      bool_or(NOT is_agent AND (fields ? 'Annual Premium'))  AS revenue_seen,
      bool_or(NOT is_agent AND (fields ? 'Summary Status'))  AS status_seen,
      count(*) FILTER (WHERE NOT is_agent
        AND (lower(coalesce(fields->>'Summary Status','')) LIKE '%approved%'
          OR lower(coalesce(fields->>'Summary Status','')) LIKE '%issue%'))      AS approved_cnt,
      count(*) FILTER (WHERE NOT is_agent
        AND (lower(coalesce(fields->>'Summary Status','')) LIKE '%issue - paid%'
          OR lower(coalesce(fields->>'Summary Status','')) LIKE '%issue-paid%'
          OR lower(coalesce(fields->>'Summary Status','')) LIKE '%funded%'))     AS funded_cnt
    FROM base
  )
  SELECT
    total_rows,
    policy_rows,
    skipped_agent_rows,
    CASE WHEN revenue_seen THEN revenue_sum ELSE NULL END AS revenue_total,
    -- No explicit "submitted" field in the schema → JS falls back to all policy
    -- rows when a status column is present; null otherwise.
    CASE WHEN status_seen THEN policy_rows  ELSE NULL END AS apps_submitted,
    CASE WHEN status_seen THEN approved_cnt ELSE NULL END AS apps_approved,
    CASE WHEN status_seen THEN funded_cnt   ELSE NULL END AS apps_funded
  FROM agg;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_dedupe_and_rebuild_once()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '0'
 SET search_path TO 'public', 'cron'
AS $function$
declare a jsonb; b jsonb;
begin
  perform cron.unschedule('pinnacle-dedupe-once');
  a := pinnacle_dedupe_mirror();
  b := pinnacle_post_sync(true);
  insert into pinnacle_maintenance_log (note, result) values ('dedupe+rebuild', jsonb_build_object('dedupe', a, 'post_sync', b));
exception when others then
  insert into pinnacle_maintenance_log (note, result) values ('dedupe+rebuild FAILED', jsonb_build_object('err', sqlerrm));
end $function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_dedupe_mirror()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '0'
 SET search_path TO 'public'
AS $function$
declare v_deleted bigint;
begin
  perform pg_advisory_xact_lock(hashtext('pinnacle_post_sync'));
  create temp table _keep on commit drop as
    select distinct on (base_id, table_name, btrim(fields->>'Policy Number')) record_id
    from pinnacle_airtable_records
    where base_id = 'appHyYBfI6kfX6ZuW'
      and table_name in ('Pinnacle Life Policies', 'Pinnacle Health Policies')
      and nullif(btrim(fields->>'Policy Number'), '') is not null
    order by base_id, table_name, btrim(fields->>'Policy Number'),
             coalesce(fields->>'Created', '') desc, coalesce(fields->>'Last Modified', '') desc, fetched_at desc;
  create index on _keep (record_id);
  delete from pinnacle_airtable_records r
   where r.base_id = 'appHyYBfI6kfX6ZuW'
     and r.table_name in ('Pinnacle Life Policies', 'Pinnacle Health Policies')
     and nullif(btrim(r.fields->>'Policy Number'), '') is not null
     and not exists (select 1 from _keep k where k.record_id = r.record_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end $function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_dedupe_reimports_once()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '0'
 SET search_path TO 'public', 'cron'
AS $function$
declare r record; res jsonb := '[]'::jsonb;
begin
  -- Unschedule outside the inner block so a failure does not retry every minute.
  perform cron.unschedule('pinnacle-dedupe-reimports-once');
  begin
  perform pg_advisory_xact_lock(hashtext('pinnacle_post_sync'));
  for r in
    select distinct on (base_id, table_name) base_id, table_name, started_at
    from pinnacle_sync_table_runs
    where not incremental and clean and fetched > 0
    order by base_id, table_name, started_at desc
  loop
    if exists (select 1 from pinnacle_airtable_records a
               where a.base_id = r.base_id and a.table_name = r.table_name and a.fetched_at < r.started_at) then
      res := res || jsonb_build_object('base_id', r.base_id, 'table', r.table_name,
        'result', pinnacle_sweep_table(r.base_id, r.table_name, r.started_at, 0));
    end if;
  end loop;
  insert into pinnacle_maintenance_log (note, result) values ('dedupe re-imports 2026-10-17', jsonb_build_object('sweep', res));
  exception when others then
    insert into pinnacle_maintenance_log (note, result) values ('dedupe re-imports 2026-10-17 FAILED', jsonb_build_object('err', sqlerrm));
  end;
end $function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_dedupe_rolling()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '0'
 SET search_path TO 'public'
AS $function$
declare v_deleted bigint;
begin
  perform pg_advisory_xact_lock(hashtext('pinnacle_post_sync'));
  create temp table _keep on commit drop as
    select distinct on (base_id, table_name, btrim(fields->>'Policy Number')) base_id, record_id
    from pinnacle_airtable_records
    where table_name = 'Rolling 2025 BOB'
      and nullif(btrim(fields->>'Policy Number'), '') is not null
    order by base_id, table_name, btrim(fields->>'Policy Number'),
             fetched_at desc, coalesce(fields->>'Last Modified', '') desc;
  create index on _keep (base_id, record_id);
  delete from pinnacle_airtable_records r
   where r.table_name = 'Rolling 2025 BOB'
     and nullif(btrim(r.fields->>'Policy Number'), '') is not null
     and not exists (select 1 from _keep k where k.base_id = r.base_id and k.record_id = r.record_id);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('deleted', v_deleted);
end $function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_dedupe_rolling_once()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '0'
 SET search_path TO 'public', 'cron'
AS $function$
declare a jsonb;
begin
  perform cron.unschedule('pinnacle-dedupe-rolling-once');
  a := pinnacle_dedupe_rolling();
  insert into pinnacle_maintenance_log (note, result) values ('dedupe rolling', a);
exception when others then
  insert into pinnacle_maintenance_log (note, result) values ('dedupe rolling FAILED', jsonb_build_object('err', sqlerrm));
end $function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_field_whitelist()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_label(v jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select nullif(btrim(case jsonb_typeof(v)
    when 'string' then v #>> '{}'
    when 'number' then v #>> '{}'
    when 'array' then case jsonb_typeof(v -> 0)
        when 'object' then coalesce(v -> 0 ->> 'name', v -> 0 ->> 'Name', v -> 0 ->> 'id')
        else v ->> 0 end
    when 'object' then coalesce(v ->> 'name', v ->> 'Name', v ->> 'id')
    else null end), '')
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_month_summary()
 RETURNS TABLE(this_month_premium numeric, prev_month_premium numeric, this_month_total bigint, this_month_paid bigint)
 LANGUAGE sql
 STABLE
AS $function$
  with t as (
    select (now() at time zone 'America/New_York')::date as today
  ), w as (
    select today,
           date_trunc('month', today)::date as m0,
           (date_trunc('month', today) - interval '1 month')::date as p0
    from t
  )
  select
    coalesce((select sum(r.premium) from pinnacle_daily_rollup r, w
              where r.base_id = 'appHyYBfI6kfX6ZuW' and r.d between w.m0 and w.today), 0)::numeric,
    coalesce((select sum(r.premium) from pinnacle_daily_rollup r, w
              where r.base_id = 'appHyYBfI6kfX6ZuW' and r.d >= w.p0 and r.d < w.m0), 0)::numeric,
    coalesce((select sum(s.total) from pinnacle_status_rollup s, w
              where s.d between w.m0 and w.today), 0)::bigint,
    coalesce((select sum(s.paid) from pinnacle_status_rollup s, w
              where s.d between w.m0 and w.today), 0)::bigint;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_post_sync(p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
declare
  r record;
  n bigint;
  live bigint;
  prev bigint;
  landed bigint;
  res jsonb;
  swept_total bigint := 0;
  tables_done int := 0;
  skipped jsonb := '[]'::jsonb;
  kept jsonb := '[]'::jsonb;
  why text;
begin
  -- Only one runner at a time (cron tick overlapping a manual call).
  if not pg_try_advisory_xact_lock(hashtext('pinnacle_post_sync')) then
    return jsonb_build_object('skipped', 'already running');
  end if;

  -- Latest completed, unswept fetch per table. Older pending runs for the
  -- same table are superseded and just marked.
  for r in
    select distinct on (base_id, table_name) id, base_id, table_name, started_at, fetched, clean
    from pinnacle_sync_table_runs
    where swept_at is null and not incremental
    order by base_id, table_name, completed_at desc
  loop
    n := 0;
    why := null;
    -- Size reference: the previous clean full pull of this table. Comparing
    -- with live rows double-counts after a re-import (both copies are live).
    select t.fetched into prev
    from pinnacle_sync_table_runs t
    where t.base_id = r.base_id and t.table_name = r.table_name
      and not t.incremental and t.clean and t.fetched > 0
      and t.started_at < r.started_at
    order by t.started_at desc limit 1;

    if not coalesce(r.clean, false) then
      why := 'run not clean';
    elsif r.fetched is null or r.fetched <= 0 then
      why := 'zero-row fetch';
    elsif prev is not null and r.fetched < 0.9 * prev then
      why := format('fetched %s < 90%% of previous full pull %s', r.fetched, prev);
    elsif prev is null then
      select count(*) into live from pinnacle_airtable_records
      where base_id = r.base_id and table_name = r.table_name;
      if r.fetched < 0.9 * live then
        why := format('fetched %s < 90%% of %s live rows (no previous full pull)', r.fetched, live);
      end if;
    end if;
    if why is null then
      select count(*) into landed from pinnacle_airtable_records
      where base_id = r.base_id and table_name = r.table_name and fetched_at >= r.started_at;
      if landed < 0.9 * r.fetched then
        why := format('only %s of %s fetched rows landed', landed, r.fetched);
      end if;
    end if;

    if why is null then
      res := pinnacle_sweep_table(r.base_id, r.table_name, r.started_at);
      n := coalesce((res->>'deleted')::bigint, 0);
      if coalesce((res->>'kept_orphans')::bigint, 0) > 0 then
        kept := kept || jsonb_build_object('base_id', r.base_id, 'table', r.table_name, 'kept_orphans', (res->>'kept_orphans')::bigint);
      end if;
    else
      skipped := skipped || jsonb_build_object('base_id', r.base_id, 'table', r.table_name, 'reason', why);
    end if;
    update pinnacle_sync_table_runs set swept_at = now(), swept = n,
      sweep_skipped = case when id = r.id then why else 'superseded' end
    where base_id = r.base_id and table_name = r.table_name and swept_at is null and completed_at <= now();
    swept_total := swept_total + n;
    tables_done := tables_done + 1;
  end loop;

  -- Incremental pulls (changed rows only) never sweep: they did not see the
  -- whole table. They only ask for the rebuild below.
  update pinnacle_sync_table_runs set swept_at = now(), swept = 0
  where incremental and swept_at is null and completed_at <= now();
  get diagnostics n = row_count;
  tables_done := tables_done + n;

  if tables_done = 0 and not p_force then
    return jsonb_build_object('skipped', 'nothing new');
  end if;

  perform pinnacle_rebuild_rollups();
  perform pinnacle_rebuild_dim_rollup();
  perform pinnacle_build_people_stats();
  perform pinnacle_build_agent_writes();
  -- Expire every tenant's day cache: the next view recomputes from the
  -- rebuilt rollups.
  update pinnacle_rollup_cache set computed_at = 'epoch', computing_since = null;

  return jsonb_build_object('tables', tables_done, 'swept', swept_total, 'sweep_skipped', skipped,
    'kept_orphans', kept, 'rebuilt_at', now());
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_premium_daily()
 RETURNS TABLE(d date, base_id text, line text, premium numeric, policies bigint, funded_premium numeric, funded_policies bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select d, base_id, line, premium, policies, funded_premium, funded_policies
  from pinnacle_daily_rollup;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_producer_production(p_line text, p_start date, p_end date, p_name text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS TABLE(label text, team text, premium numeric, funded numeric, policies bigint, paid bigint, declined bigint, lapsed bigint, pending bigint, first_policy date, contracted_at date, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with win as (
    select r.label, nullif(max(r.team), '') as team,
      round(sum(r.premium), 2) as premium, round(sum(r.funded), 2) as funded,  -- cents kept so totals match the Revenue card to the dollar
      sum(r.policies)::bigint as policies, sum(r.paid)::bigint as paid,
      sum(r.declined)::bigint as declined, sum(r.lapsed)::bigint as lapsed
    from public.pinnacle_dim_rollup r
    where r.dim = 'agent' and r.d between p_start and p_end
      and (p_line is null or p_line = 'All' or r.line = p_line)
      and (p_name is null or r.label ilike '%' || p_name || '%')
    group by r.label
  )
  select w.label, w.team, w.premium, w.funded, w.policies, w.paid, w.declined, w.lapsed,
    greatest(w.policies - w.paid - w.declined - w.lapsed, 0)::bigint,
    f.first_policy, null::date, null::text
  from win w
  left join lateral (
    select min(r.d) as first_policy from public.pinnacle_dim_rollup r
    where r.dim = 'agent' and r.policies > 0 and r.label = w.label
  ) f on true
  order by 3 desc nulls last, 1
  limit greatest(1, least(p_limit, 20000));
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_rebuild_dim_rollup()
 RETURNS void
 LANGUAGE plpgsql
 SET statement_timeout TO '1800s'
AS $function$
begin
  delete from pinnacle_name_map;
  insert into pinnacle_name_map (record_id, name, source_table)
  select distinct on (r.record_id) r.record_id,
    coalesce(
      pinnacle_label(r.fields -> 'Name'), pinnacle_label(r.fields -> 'Full Name'),
      pinnacle_label(r.fields -> 'Agent Name'), pinnacle_label(r.fields -> 'Agent'),
      pinnacle_label(r.fields -> 'Team Name'), pinnacle_label(r.fields -> 'Team'),
      pinnacle_label(r.fields -> 'Agency'), nullif(btrim(concat_ws(' ', r.fields ->> 'First Name', r.fields ->> 'Last Name')), '')
    ),
    r.table_name
  from pinnacle_airtable_records r
  where r.base_id = 'appHyYBfI6kfX6ZuW'
    and lower(r.table_name) ~ '(directory|agent|team|agenc|producer|roster|downline)'
    and coalesce(
      pinnacle_label(r.fields -> 'Name'), pinnacle_label(r.fields -> 'Full Name'),
      pinnacle_label(r.fields -> 'Agent Name'), pinnacle_label(r.fields -> 'Agent'),
      pinnacle_label(r.fields -> 'Team Name'), pinnacle_label(r.fields -> 'Team'),
      pinnacle_label(r.fields -> 'Agency'), nullif(btrim(concat_ws(' ', r.fields ->> 'First Name', r.fields ->> 'Last Name')), '')
    ) is not null
  order by r.record_id, (lower(r.table_name) like '%directory%') desc;

  delete from pinnacle_dim_rollup;
  insert into pinnacle_dim_rollup (d, line, dim, label, team, premium, funded, policies, paid, declined, lapsed)
  with dd as (
    -- Airtable's policy tables are wiped and re-imported weekly with new
    -- record ids, so the mirror can hold the same policy many times. One row
    -- per policy number (latest edit wins); rows without one stay as-is.
    select distinct on (r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW'
      and lower(r.table_name) not like '%directory%'
      and lower(r.table_name) not like '%agent list%'
      and lower(r.table_name) not like '%rolling%'
    order by r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ),
  src as (
    select
      pinnacle_safe_date(r.fields ->> 'Effective Date') as d,
      case
        when r.table_name ilike '%annuit%' then 'Annuity'
        when r.table_name ilike '%health%' then 'Health'
        when r.table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      coalesce(pinnacle_safe_num(r.fields ->> 'Annual Premium'), 0) as ap,
      lower(coalesce(r.fields ->> 'Summary Status', '')) as status,
      -- Team = the Directory's 'Team (Parsed for Score)' for the writing agent
      -- (Score's own naming). Life policies carry no 'Team (Parsed)' at all.
      coalesce(pinnacle_label(dir.fields -> 'Team (Parsed for Score)'),
               pinnacle_label(r.fields -> 'Team (Parsed)'),
               pinnacle_label(r.fields -> 'Team (parsed)')) as team_raw,
      pinnacle_label(r.fields -> 'Agent') as agent_raw,
      pinnacle_label(r.fields -> 'Carrier') as carrier,
      pinnacle_label(r.fields -> 'State') as state,
      pinnacle_label(r.fields -> 'Product Name') as product
    from dd r
    left join pinnacle_airtable_records dir
      on dir.base_id = r.base_id and dir.table_name = 'Pinnacle Directory'
     and dir.record_id = r.fields -> 'Pinnacle Team Member' ->> 0
  ),
  named as (
    select s.d, s.line, s.ap, s.status, s.carrier, s.state, s.product,
      case when s.team_raw ~ '^rec[A-Za-z0-9]{14}$' then tm.name else s.team_raw end as team,
      case when s.agent_raw ~ '^rec[A-Za-z0-9]{14}$' then am.name else s.agent_raw end as agent
    from src s
    left join pinnacle_name_map tm on tm.record_id = s.team_raw
    left join pinnacle_name_map am on am.record_id = s.agent_raw
    where s.d is not null and extract(year from s.d) between 2020 and 2030
  ),
  flags as (
    select *,
      (status like '%issue - paid%' or status like '%issue-paid%' or status like '%funded%') as is_paid,
      (status like '%declin%') as is_declined,
      (status like '%lapse%') as is_lapsed
    from named
  ),
  dims as (
    select d, line, 'team' as dim, team as label, '' as team, ap, is_paid, is_declined, is_lapsed from flags where team is not null
    union all
    select d, line, 'agent', agent, coalesce(team, ''), ap, is_paid, is_declined, is_lapsed from flags where agent is not null
    union all
    select d, line, 'carrier', carrier, '', ap, is_paid, is_declined, is_lapsed from flags where carrier is not null
    union all
    select d, line, 'state', state, '', ap, is_paid, is_declined, is_lapsed from flags where state is not null
    union all
    select d, line, 'product', product, '', ap, is_paid, is_declined, is_lapsed from flags where product is not null
  )
  select d, line, dim, label, team,
    sum(ap), coalesce(sum(ap) filter (where is_paid), 0),
    count(*)::bigint,
    count(*) filter (where is_paid)::bigint,
    count(*) filter (where is_declined)::bigint,
    count(*) filter (where is_lapsed)::bigint
  from dims
  group by d, line, dim, label, team;

  -- Monthly pre-aggregate for the breakdown tables (pinnacle_breakdown_v2
  -- reads whole months here and only the partial edge days from the daily
  -- table). Rebuilt in the same transaction, so readers never see it empty.
  delete from pinnacle_dim_rollup_month;
  insert into pinnacle_dim_rollup_month (m, line, dim, label, team, premium, funded, policies, paid, declined, lapsed)
  select date_trunc('month', d)::date, line, dim, label, team,
    sum(premium), sum(funded), sum(policies)::bigint, sum(paid)::bigint, sum(declined)::bigint, sum(lapsed)::bigint
  from pinnacle_dim_rollup
  group by 1, line, dim, label, team
  order by dim, 1;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_rebuild_once()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '0'
 SET search_path TO 'public', 'cron'
AS $function$
declare b jsonb;
begin
  if exists (select 1 from cron.job where jobname = 'pinnacle-dedupe-reimports-once') then
    return; -- cleanup has not run yet
  end if;
  perform cron.unschedule('pinnacle-rebuild-once');
  begin
    b := pinnacle_post_sync(true);
    insert into pinnacle_maintenance_log (note, result) values ('rebuild after dedupe 2026-10-17', b);
  exception when others then
    insert into pinnacle_maintenance_log (note, result) values ('rebuild after dedupe 2026-10-17 FAILED', jsonb_build_object('err', sqlerrm));
  end;
end $function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_rebuild_rollups()
 RETURNS void
 LANGUAGE plpgsql
 SET statement_timeout TO '1800s'
AS $function$
begin
  -- Premium rollup — all bases.
  delete from pinnacle_daily_rollup;
  insert into pinnacle_daily_rollup (base_id, d, line, premium, policies, funded_premium, funded_policies)
  with dd as (
    -- Airtable's policy tables are wiped and re-imported weekly with new
    -- record ids, so the mirror can hold the same policy many times. One row
    -- per policy number (latest edit wins); rows without one stay as-is.
    select distinct on (r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where lower(r.table_name) not like '%directory%'
      and lower(r.table_name) not like '%agent list%'
      and lower(r.table_name) not like '%rolling%'
    order by r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ),
  src as (
    select
      r.base_id, r.table_name,
      r.fields->>'Effective Date' as eff_raw,
      nullif(regexp_replace(coalesce(r.fields->>'Annual Premium',''), '[^0-9.\-]', '', 'g'), '')::numeric as ap,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from dd r
  ),
  typed as (
    select
      eff_raw::date as d, base_id,
      case
        when table_name ilike '%annuit%' then 'Annuity'
        when table_name ilike '%health%' then 'Health'
        when table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      coalesce(ap,0) as ap,
      (status like '%issue - paid%' or status like '%issue-paid%' or status like '%funded%') as is_funded
    from src
    where eff_raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
      and substring(eff_raw,1,4)::int between 2020 and 2030
  )
  select base_id, d, line, sum(ap), count(*)::bigint,
         sum(ap) filter (where is_funded), count(*) filter (where is_funded)::bigint
  from typed group by base_id, d, line;

  -- Status rollup — Pinnacle master base only.
  delete from pinnacle_status_rollup;
  insert into pinnacle_status_rollup (d, line, total, paid, declined, lapsed, submitted)
  with dd as (
    -- Airtable's policy tables are wiped and re-imported weekly with new
    -- record ids, so the mirror can hold the same policy many times. One row
    -- per policy number (latest edit wins); rows without one stay as-is.
    select distinct on (r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id)) r.*
    from pinnacle_airtable_records r
    where r.base_id = 'appHyYBfI6kfX6ZuW' and lower(r.table_name) not like '%directory%'
    order by r.base_id, r.table_name, coalesce(nullif(btrim(r.fields->>'Policy Number'), ''), r.record_id),
             coalesce(r.fields->>'Last Modified', '') desc, r.fetched_at desc
  ),
  src as (
    select
      r.fields->>'Effective Date' as eff_raw,
      case
        when r.table_name ilike '%annuit%' then 'Annuity'
        when r.table_name ilike '%health%' then 'Health'
        when r.table_name ilike '%life%'   then 'Life'
        else 'Other' end as line,
      lower(coalesce(r.fields->>'Summary Status','')) as status
    from dd r
  )
  select eff_raw::date, line, count(*)::bigint,
    count(*) filter (where status like '%issue - paid%' or status like '%issue-paid%')::bigint,
    count(*) filter (where status like '%declin%')::bigint,
    count(*) filter (where status like '%lapse%')::bigint,
    count(*) filter (where status like '%submit%')::bigint
  from src
  where eff_raw ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
    and substring(eff_raw,1,4)::int between 2020 and 2030
  group by 1, 2;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_refresh_mv()
 RETURNS void
 LANGUAGE sql
AS $function$
  select public.pinnacle_rebuild_rollups();
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_safe_date(t text)
 RETURNS date
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
begin
  if t is null or t !~ '^\d{4}-\d{2}-\d{2}' then return null; end if;
  return substring(t, 1, 10)::date;
exception when others then
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_safe_num(t text)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare s text := nullif(regexp_replace(coalesce(t, ''), '[^0-9.\-]', '', 'g'), '');
begin
  if s is null then return null; end if;
  return s::numeric;
exception when others then
  return null;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_status_daily()
 RETURNS TABLE(d date, line text, total bigint, paid bigint, declined bigint, lapsed bigint, submitted bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select d, line, total, paid, declined, lapsed, submitted
  from pinnacle_status_rollup;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_sweep_table(p_base text, p_table text, p_started timestamp with time zone, p_orphan_max numeric DEFAULT 0.01)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '0'
AS $function$
declare
  v_fresh bigint;
  v_has_pn boolean;
  v_orphans bigint := 0;
  v_deleted bigint := 0;
  v_keep_orphans boolean := false;
begin
  select count(*), bool_or(nullif(btrim(fields->>'Policy Number'), '') is not null)
    into v_fresh, v_has_pn
  from pinnacle_airtable_records
  where base_id = p_base and table_name = p_table and fetched_at >= p_started;

  if coalesce(v_fresh, 0) = 0 then
    return jsonb_build_object('deleted', 0, 'reason', 'no fresh rows');
  end if;

  if not coalesce(v_has_pn, false) then
    -- Directory / agent lists: no policy key, the full pull is the table.
    delete from pinnacle_airtable_records
    where base_id = p_base and table_name = p_table and fetched_at < p_started;
    get diagnostics v_deleted = row_count;
    return jsonb_build_object('deleted', v_deleted, 'kept_orphans', 0, 'fresh', v_fresh);
  end if;

  create temp table if not exists _pin_fresh_pn (pn text primary key) on commit drop;
  truncate _pin_fresh_pn;
  insert into _pin_fresh_pn
    select distinct btrim(fields->>'Policy Number')
    from pinnacle_airtable_records
    where base_id = p_base and table_name = p_table and fetched_at >= p_started
      and nullif(btrim(fields->>'Policy Number'), '') is not null;

  select count(distinct btrim(a.fields->>'Policy Number')) into v_orphans
  from pinnacle_airtable_records a
  where a.base_id = p_base and a.table_name = p_table and a.fetched_at < p_started
    and nullif(btrim(a.fields->>'Policy Number'), '') is not null
    and not exists (select 1 from _pin_fresh_pn f where f.pn = btrim(a.fields->>'Policy Number'));

  v_keep_orphans := v_orphans > p_orphan_max * v_fresh;

  delete from pinnacle_airtable_records a
  where a.base_id = p_base and a.table_name = p_table and a.fetched_at < p_started
    and (
      not v_keep_orphans
      or nullif(btrim(a.fields->>'Policy Number'), '') is null
      or exists (select 1 from _pin_fresh_pn f where f.pn = btrim(a.fields->>'Policy Number'))
    );
  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'deleted', v_deleted,
    'orphan_policies', v_orphans,
    'kept_orphans', case when v_keep_orphans then v_orphans else 0 end,
    'fresh', v_fresh);
end $function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_table_counts()
 RETURNS TABLE(base_id text, table_name text, n bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select base_id, table_name, count(*)::bigint
  from pinnacle_airtable_records
  group by base_id, table_name;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_team_signals()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with a as (
    select label, max(nullif(team, '')) team,
           coalesce(sum(policies) filter (where d > current_date - 30), 0) now30,
           coalesce(sum(policies) filter (where d <= current_date - 30 and d > current_date - 60), 0) prev30
    from pinnacle_dim_rollup
    where dim = 'agent' and d > current_date - 60 and d <= current_date
    group by label
  ), s as (
    select * from a where prev30 >= 6 and now30 <= prev30 * 0.4
    order by prev30 - now30 desc limit 5
  )
  select jsonb_build_object(
    'slipping', coalesce((select jsonb_agg(jsonb_build_object('agent', label, 'team', team, 'now30', now30, 'prev30', prev30)) from s), '[]'::jsonb),
    'slipping_total', (select count(*) from a where prev30 >= 6 and now30 <= prev30 * 0.4),
    'new_no_policy', (
      select coalesce(sum((j->>'joined')::int - (j->>'wrote')::int), 0)
      from pinnacle_people_rollup p, jsonb_array_elements(p.data->'joins_by_month') j
      where (j->>'m') between to_char(current_date - 75, 'YYYY-MM') and to_char(current_date - 30, 'YYYY-MM')
    )
  )
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_trim_fields()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.fields := coalesce((
    select jsonb_object_agg(k, v) from jsonb_each(new.fields) as e(k, v)
    where k = any (pinnacle_field_whitelist())
  ), '{}'::jsonb);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_upsert_records(p_rows jsonb)
 RETURNS integer
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with src as (
    select * from jsonb_to_recordset(p_rows) as r(
      base_id text, table_name text, record_id text, fields jsonb,
      airtable_created timestamptz, last_modified_at timestamptz, fetched_at timestamptz)
  ), up as (
    insert into public.pinnacle_airtable_records as t
      (base_id, table_name, record_id, fields, airtable_created, last_modified_at, fetched_at)
    select base_id, table_name, record_id, fields, airtable_created, last_modified_at, coalesce(fetched_at, now())
    from src
    on conflict (base_id, table_name, record_id) do update set
      fields           = excluded.fields,
      airtable_created = excluded.airtable_created,
      last_modified_at = excluded.last_modified_at,
      fetched_at       = excluded.fetched_at
    where t.last_modified_at is distinct from excluded.last_modified_at
       or t.fields is distinct from excluded.fields and excluded.last_modified_at is null
    returning 1
  )
  select count(*)::int from up;
$function$
;

CREATE OR REPLACE FUNCTION public.pinnacle_window_summary(p_start date, p_end date)
 RETURNS TABLE(premium numeric, policies bigint, funded numeric, paid bigint, total bigint)
 LANGUAGE sql
 STABLE
AS $function$
  select
    coalesce(sum(premium),0)::numeric,
    coalesce(sum(policies),0)::bigint,
    coalesce(sum(funded_premium),0)::numeric,
    coalesce(sum(funded_policies),0)::bigint,
    coalesce(sum(policies),0)::bigint
  from pinnacle_daily_rollup
  where base_id = 'appHyYBfI6kfX6ZuW' and d between p_start and p_end;
$function$
;

CREATE OR REPLACE FUNCTION public.recompute_roleplay_daily(p_rep_id text, p_member_id uuid, p_day date)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
begin
  insert into roleplay_daily_activity (rep_id, member_id, day, sessions_count, minutes_practiced, avg_score, best_score)
  select p_rep_id,
         p_member_id,
         p_day,
         count(*),
         coalesce(sum(coalesce(duration_seconds, 0)), 0) / 60,
         avg(ai_score),
         max(ai_score)
    from roleplay_sessions
   where rep_id = p_rep_id
     and member_id = p_member_id
     and status = 'completed'
     and (completed_at at time zone 'UTC')::date = p_day
  on conflict (rep_id, member_id, day) do update
    set sessions_count = excluded.sessions_count,
        minutes_practiced = excluded.minutes_practiced,
        avg_score = excluded.avg_score,
        best_score = excluded.best_score,
        updated_at = now();
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reps_hosts_unique()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  h text;
  mine text[];
begin
  mine := array_remove(array[lower(new.slug)] || coalesce((select array_agg(lower(x)) from unnest(new.host_aliases) x), '{}'), null);
  if (select count(*) from unnest(mine)) <> (select count(distinct x) from unnest(mine) x) then
    raise exception 'rep % lists the same host twice (slug/aliases)', new.id using errcode = '23505';
  end if;
  foreach h in array mine loop
    perform pg_advisory_xact_lock(hashtext('reps_host:' || h));
    if exists (
      select 1 from reps r
      where r.id <> new.id
        and (lower(r.slug) = h or h = any (select lower(y) from unnest(r.host_aliases) y))
    ) then
      raise exception 'host "%" is already used by another rep as a slug or alias', h using errcode = '23505';
    end if;
  end loop;
  return new;
end $function$
;

CREATE OR REPLACE FUNCTION public.roleplay_wallet_charge(p_rep_id text, p_member_id uuid, p_session_id uuid, p_amount_cents integer, p_note text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_amount  integer := -abs(p_amount_cents);
  v_balance integer;
begin
  insert into ai_wallets (rep_id) values (p_rep_id)
  on conflict (rep_id) do nothing;

  insert into ai_wallet_ledger (rep_id, member_id, kind, amount_cents, session_id, note)
  values (p_rep_id, p_member_id, 'roleplay_practice', v_amount, p_session_id, p_note)
  on conflict (session_id) where kind = 'roleplay_practice' do nothing;

  if found then
    update ai_wallets
       set balance_cents = balance_cents + v_amount, updated_at = now()
     where rep_id = p_rep_id
    returning balance_cents into v_balance;
  else
    select balance_cents into v_balance from ai_wallets where rep_id = p_rep_id;
  end if;

  return coalesce(v_balance, 0);
end
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.set_updated_at_projects()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
    begin
      new.updated_at = now();
      return new;
    end;
    $function$
;

CREATE OR REPLACE FUNCTION public.trg_roleplay_session_completed()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.status = 'completed' and new.completed_at is not null then
    perform recompute_roleplay_daily(
      new.rep_id,
      new.member_id,
      (new.completed_at at time zone 'UTC')::date
    );
  end if;
  return new;
end;
$function$
;

create materialized view if not exists public.pinnacle_policy_mv as
 SELECT base_id,
    table_name,
    record_id,
    ((fields ->> 'Effective Date'::text))::date AS eff_date,
        CASE
            WHEN (table_name ~~* '%annuit%'::text) THEN 'Annuity'::text
            WHEN (table_name ~~* '%health%'::text) THEN 'Health'::text
            WHEN (table_name ~~* '%life%'::text) THEN 'Life'::text
            ELSE 'Other'::text
        END AS line,
    COALESCE((NULLIF(regexp_replace(COALESCE((fields ->> 'Annual Premium'::text), ''::text), '[^0-9.\-]'::text, ''::text, 'g'::text), ''::text))::numeric, (0)::numeric) AS premium,
    ((lower(COALESCE((fields ->> 'Summary Status'::text), ''::text)) ~~ '%issue - paid%'::text) OR (lower(COALESCE((fields ->> 'Summary Status'::text), ''::text)) ~~ '%issue-paid%'::text)) AS is_paid,
    (lower(COALESCE((fields ->> 'Summary Status'::text), ''::text)) ~~ '%declin%'::text) AS is_declined,
    (lower(COALESCE((fields ->> 'Summary Status'::text), ''::text)) ~~ '%lapse%'::text) AS is_lapsed,
    (lower(COALESCE((fields ->> 'Summary Status'::text), ''::text)) ~~ '%submit%'::text) AS is_submitted,
    NULLIF((fields ->> 'Team (Parsed)'::text), ''::text) AS team,
    NULLIF((fields ->> 'Agent'::text), ''::text) AS agent,
    NULLIF((fields ->> 'Carrier'::text), ''::text) AS carrier,
    NULLIF((fields ->> 'State'::text), ''::text) AS state,
    NULLIF((fields ->> 'Product Name'::text), ''::text) AS product
   FROM pinnacle_airtable_records r
  WHERE ((lower(table_name) !~~ '%directory%'::text) AND (lower(table_name) !~~ '%agent list%'::text) AND ((fields ->> 'Effective Date'::text) ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'::text) AND ((("substring"((fields ->> 'Effective Date'::text), 1, 4))::integer >= 2020) AND (("substring"((fields ->> 'Effective Date'::text), 1, 4))::integer <= 2030)));

alter table public.addon_requests add constraint addon_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.addon_requests add constraint addon_requests_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.addon_requests add constraint addon_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])));

alter table public.agent_actions add constraint agent_actions_action_type_check CHECK ((action_type = ANY (ARRAY['email_draft'::text, 'classification'::text, 'alert'::text, 'dormant_flag'::text])));

alter table public.agent_actions add constraint agent_actions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

alter table public.agent_actions add constraint agent_actions_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.agent_actions add constraint agent_actions_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.agent_actions add constraint agent_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'dismissed'::text])));

alter table public.agent_billing add constraint agent_billing_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.agent_billing add constraint agent_billing_payer_model_check CHECK ((payer_model = ANY (ARRAY['self'::text, 'org'::text])));

alter table public.agent_billing add constraint agent_billing_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.agent_billing add constraint agent_billing_status_check CHECK ((status = ANY (ARRAY['pending_setup'::text, 'active'::text, 'past_due'::text, 'cancelled'::text, 'paused'::text])));

alter table public.agent_billing add constraint agent_billing_volume_tier_check CHECK ((volume_tier = ANY (ARRAY['t1'::text, 't2'::text, 't3'::text, 't4'::text, 't5'::text])));

alter table public.agent_billing_event add constraint agent_billing_event_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.agent_billing_event add constraint agent_billing_event_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE SET NULL;

alter table public.agent_billing_week add constraint agent_billing_week_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.agent_billing_week add constraint agent_billing_week_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.agent_billing_week add constraint agent_billing_week_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));

alter table public.agent_history add constraint agent_history_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.agent_history add constraint agent_history_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.agent_history add constraint agent_history_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])));

alter table public.agent_member_memory add constraint agent_member_memory_kind_check CHECK ((kind = ANY (ARRAY['avoid'::text, 'prefer'::text, 'correction'::text, 'fact'::text])));

alter table public.agent_member_memory add constraint agent_member_memory_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.agent_member_memory add constraint agent_member_memory_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.agent_member_memory add constraint agent_member_memory_rule_check CHECK (((char_length(rule) >= 1) AND (char_length(rule) <= 500)));

alter table public.agent_runs add constraint agent_runs_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.agent_runs add constraint agent_runs_run_type_check CHECK ((run_type = ANY (ARRAY['morning_scan'::text, 'dormant_check'::text, 'hot_pulse'::text, 'midday_pulse'::text, 'coach'::text])));

alter table public.agent_runs add constraint agent_runs_status_check CHECK ((status = ANY (ARRAY['success'::text, 'error'::text])));

alter table public.agent_usage add constraint agent_usage_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.agent_usage add constraint agent_usage_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.ai_salespeople add constraint ai_salespeople_assigned_member_id_fkey FOREIGN KEY (assigned_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.ai_salespeople add constraint ai_salespeople_created_by_member_id_fkey FOREIGN KEY (created_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.ai_salespeople add constraint ai_salespeople_phone_provider_check CHECK ((phone_provider = ANY (ARRAY['revring'::text, 'twilio'::text])));

alter table public.ai_salespeople add constraint ai_salespeople_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.ai_salespeople add constraint ai_salespeople_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'paused'::text, 'archived'::text])));

alter table public.ai_salesperson_campaigns add constraint ai_salesperson_campaigns_ai_salesperson_id_fkey FOREIGN KEY (ai_salesperson_id) REFERENCES ai_salespeople(id) ON DELETE CASCADE;

alter table public.ai_salesperson_campaigns add constraint ai_salesperson_campaigns_created_by_member_id_fkey FOREIGN KEY (created_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.ai_salesperson_campaigns add constraint ai_salesperson_campaigns_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_ai_salesperson_id_fkey FOREIGN KEY (ai_salesperson_id) REFERENCES ai_salespeople(id) ON DELETE CASCADE;

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_channel_check CHECK ((channel = ANY (ARRAY['call'::text, 'sms'::text, 'email'::text])));

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES dialer_queue(id) ON DELETE SET NULL;

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_source_call_id_fkey FOREIGN KEY (source_call_id) REFERENCES voice_calls(id) ON DELETE SET NULL;

alter table public.ai_salesperson_followups add constraint ai_salesperson_followups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'queued'::text, 'done'::text, 'cancelled'::text])));

alter table public.ai_wallet_ledger add constraint ai_wallet_ledger_kind_check CHECK ((kind = ANY (ARRAY['deposit'::text, 'adjustment'::text, 'roleplay_practice'::text])));

alter table public.ai_wallet_ledger add constraint ai_wallet_ledger_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.ai_wallet_ledger add constraint ai_wallet_ledger_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.ai_wallet_ledger add constraint ai_wallet_ledger_session_id_fkey FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE SET NULL;

alter table public.ai_wallets add constraint ai_wallets_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.audit_events add constraint audit_events_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.audit_events add constraint audit_events_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.billing_audit add constraint billing_audit_actor_kind_check CHECK ((actor_kind = ANY (ARRAY['admin'::text, 'system'::text, 'customer'::text, 'webhook'::text])));

alter table public.billing_audit add constraint billing_audit_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.billing_audit add constraint billing_audit_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE SET NULL;

alter table public.billing_change_requests add constraint billing_change_requests_kind_check CHECK ((kind = ANY (ARRAY['add_hours'::text, 'remove_hours'::text, 'toggle_overflow'::text, 'add_addon'::text, 'remove_addon'::text, 'cancel'::text, 'other'::text])));

alter table public.billing_change_requests add constraint billing_change_requests_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.billing_change_requests add constraint billing_change_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES members(id) ON DELETE CASCADE;

alter table public.billing_change_requests add constraint billing_change_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.billing_change_requests add constraint billing_change_requests_status_check CHECK ((status = ANY (ARRAY['open'::text, 'approved'::text, 'rejected'::text, 'applied'::text])));

alter table public.billing_change_requests add constraint billing_change_requests_target_member_id_fkey FOREIGN KEY (target_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.billing_periods add constraint billing_periods_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.billing_periods add constraint billing_periods_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));

alter table public.brain_dumps add constraint brain_dumps_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.brain_dumps add constraint brain_dumps_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.brain_dumps add constraint brain_dumps_source_check CHECK ((source = ANY (ARRAY['mic'::text, 'manual'::text, 'import'::text, 'plaud'::text, 'telegram'::text])));

alter table public.brain_items add constraint brain_items_brain_dump_id_fkey FOREIGN KEY (brain_dump_id) REFERENCES brain_dumps(id) ON DELETE SET NULL;

alter table public.brain_items add constraint brain_items_horizon_check CHECK ((horizon = ANY (ARRAY['day'::text, 'week'::text, 'month'::text, 'quarter'::text, 'year'::text, 'none'::text])));

alter table public.brain_items add constraint brain_items_item_type_check CHECK ((item_type = ANY (ARRAY['task'::text, 'goal'::text, 'idea'::text, 'plan'::text, 'note'::text])));

alter table public.brain_items add constraint brain_items_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.brain_items add constraint brain_items_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.brain_items add constraint brain_items_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])));

alter table public.brain_items add constraint brain_items_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.brain_items add constraint brain_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'dismissed'::text])));

alter table public.call_logs add constraint call_logs_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.call_logs add constraint call_logs_outcome_check CHECK ((outcome = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text, 'no_answer'::text, 'voicemail'::text, 'booked'::text, 'closed_won'::text, 'closed_lost'::text])));

alter table public.call_logs add constraint call_logs_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.call_logs add constraint call_logs_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.call_logs add constraint call_logs_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

alter table public.carts add constraint carts_converted_member_id_fkey FOREIGN KEY (converted_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.carts add constraint carts_converted_rep_id_fkey FOREIGN KEY (converted_rep_id) REFERENCES reps(id) ON DELETE SET NULL;

alter table public.carts add constraint carts_rep_count_check CHECK ((rep_count > 0));

alter table public.carts add constraint carts_tier_check CHECK ((tier = ANY (ARRAY['individual'::text, 'team'::text, 'enterprise'::text])));

alter table public.ciao_chat_folders add constraint ciao_chat_folders_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 40)));

alter table public.ciao_conversations add constraint ciao_conversations_folder_id_fkey FOREIGN KEY (folder_id) REFERENCES ciao_chat_folders(id) ON DELETE SET NULL;

alter table public.ciao_conversations add constraint ciao_conversations_title_check CHECK (((title IS NULL) OR ((char_length(title) >= 1) AND (char_length(title) <= 80))));

alter table public.client_addons add constraint client_addons_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.client_addons add constraint client_addons_source_check CHECK ((source = ANY (ARRAY['admin_cart'::text, 'self_serve'::text, 'manual'::text, 'converted_prospect'::text])));

alter table public.client_addons add constraint client_addons_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'over_cap'::text, 'cancelled'::text])));

alter table public.client_events add constraint client_events_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.client_integrations add constraint client_integrations_kind_check CHECK ((kind = ANY (ARRAY['api'::text, 'oauth'::text, 'webhook_inbound'::text, 'webhook_outbound'::text, 'zapier'::text])));

alter table public.client_integrations add constraint client_integrations_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.commission_entries add constraint commission_entries_deposit_id_fkey FOREIGN KEY (deposit_id) REFERENCES payroll_deposits(id) ON DELETE SET NULL;

alter table public.commission_entries add constraint commission_entries_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.commission_entries add constraint commission_entries_status_check CHECK ((status = ANY (ARRAY['expected'::text, 'matched'::text, 'paid'::text])));

alter table public.cxo_activity add constraint cxo_activity_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_allowance_tiers add constraint cxo_allowance_tiers_period_check CHECK ((period = ANY (ARRAY['month'::text, 'quarter'::text])));

alter table public.cxo_allowance_tiers add constraint cxo_allowance_tiers_threshold_check CHECK ((threshold >= (0)::numeric));

alter table public.cxo_assistant_activity add constraint cxo_assistant_activity_area_check CHECK ((area = ANY (ARRAY['boards'::text, 'messages'::text, 'todos'::text, 'calendar'::text, 'meetings'::text])));

alter table public.cxo_assistant_activity add constraint cxo_assistant_activity_assistant_member_id_fkey FOREIGN KEY (assistant_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_assistant_activity add constraint cxo_assistant_activity_exec_member_id_fkey FOREIGN KEY (exec_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_assistant_activity add constraint cxo_assistant_activity_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_behind_watch add constraint cxo_behind_watch_last_week_check CHECK (((last_week IS NULL) OR (last_week ~ '^\d{4}-W\d{2}$'::text)));

alter table public.cxo_board_card_assignees add constraint cxo_board_card_assignees_board_id_fkey FOREIGN KEY (board_id) REFERENCES cxo_boards(id) ON DELETE CASCADE;

alter table public.cxo_board_card_assignees add constraint cxo_board_card_assignees_card_id_fkey FOREIGN KEY (card_id) REFERENCES cxo_board_cards(id) ON DELETE CASCADE;

alter table public.cxo_board_card_assignees add constraint cxo_board_card_assignees_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_board_card_assignees add constraint cxo_board_card_assignees_one CHECK (((member_id IS NULL) <> (partner_id IS NULL)));

alter table public.cxo_board_card_assignees add constraint cxo_board_card_assignees_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES cxo_partners(id) ON DELETE CASCADE;

alter table public.cxo_board_card_assignees add constraint cxo_board_card_assignees_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_board_cards add constraint cxo_board_cards_acted_by_member_id_fkey FOREIGN KEY (acted_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_board_cards add constraint cxo_board_cards_board_id_fkey FOREIGN KEY (board_id) REFERENCES cxo_boards(id) ON DELETE CASCADE;

alter table public.cxo_board_cards add constraint cxo_board_cards_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_board_cards add constraint cxo_board_cards_list_id_fkey FOREIGN KEY (list_id) REFERENCES cxo_board_lists(id) ON DELETE CASCADE;

alter table public.cxo_board_cards add constraint cxo_board_cards_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_board_cards add constraint cxo_board_cards_urgency_check CHECK ((urgency = ANY (ARRAY['now'::text, 'week'::text, 'later'::text])));

alter table public.cxo_board_checklist_items add constraint cxo_board_checklist_items_board_id_fkey FOREIGN KEY (board_id) REFERENCES cxo_boards(id) ON DELETE CASCADE;

alter table public.cxo_board_checklist_items add constraint cxo_board_checklist_items_card_id_fkey FOREIGN KEY (card_id) REFERENCES cxo_board_cards(id) ON DELETE CASCADE;

alter table public.cxo_board_checklist_items add constraint cxo_board_checklist_items_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_board_lists add constraint cxo_board_lists_board_id_fkey FOREIGN KEY (board_id) REFERENCES cxo_boards(id) ON DELETE CASCADE;

alter table public.cxo_board_lists add constraint cxo_board_lists_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_board_updates add constraint cxo_board_updates_body_check CHECK ((char_length(body) <= 20000));

alter table public.cxo_board_updates add constraint cxo_board_updates_draft_text_check CHECK ((char_length(draft_text) <= 20000));

alter table public.cxo_board_updates add constraint cxo_board_updates_month_check CHECK ((month ~ '^\d{4}-(0[1-9]|1[0-2])$'::text));

alter table public.cxo_board_updates add constraint cxo_board_updates_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'edited'::text, 'sent'::text])));

alter table public.cxo_boards add constraint cxo_boards_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_boards add constraint cxo_boards_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_book_policies add constraint cxo_book_policies_line_check CHECK ((line = ANY (ARRAY['Health'::text, 'Life'::text, 'Annuity'::text, 'Other'::text])));

alter table public.cxo_book_policies add constraint cxo_book_policies_producer_id_fkey FOREIGN KEY (producer_id) REFERENCES cxo_book_producers(id) ON DELETE CASCADE;

alter table public.cxo_book_policies add constraint cxo_book_policies_status_check CHECK ((status = ANY (ARRAY['submitted'::text, 'issued'::text, 'declined'::text, 'lapsed'::text, 'withdrawn'::text])));

alter table public.cxo_book_producers add constraint cxo_book_producers_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'terminated'::text])));

alter table public.cxo_comp_rates add constraint cxo_comp_rates_agency_rate_check CHECK (((agency_rate >= (0)::numeric) AND (agency_rate <= (1000)::numeric)));

alter table public.cxo_comp_rates add constraint cxo_comp_rates_payout_rate_check CHECK (((payout_rate >= (0)::numeric) AND (payout_rate <= (1000)::numeric)));

alter table public.cxo_comp_rates add constraint cxo_comp_rates_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES cxo_plan_uploads(id) ON DELETE SET NULL;

alter table public.cxo_comp_tiers add constraint cxo_comp_tiers_attain_pct_check CHECK ((attain_pct >= (0)::numeric));

alter table public.cxo_comp_tiers add constraint cxo_comp_tiers_bonus_check CHECK ((bonus >= (0)::numeric));

alter table public.cxo_comp_tiers add constraint cxo_comp_tiers_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_comp_tiers add constraint cxo_comp_tiers_kpi_id_fkey FOREIGN KEY (kpi_id) REFERENCES cxo_employee_kpis(id) ON DELETE CASCADE;

alter table public.cxo_comp_tiers add constraint cxo_comp_tiers_period_check CHECK ((period = ANY (ARRAY['month'::text, 'quarter'::text, 'year'::text])));

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_body_check CHECK ((char_length(body) <= 6000));

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_kind_check CHECK ((kind = ANY (ARRAY['reply_draft'::text, 'email_draft'::text, 'inbox_draft'::text, 'talking_points'::text, 'brief'::text])));

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_source_key_check CHECK (((char_length(source_key) >= 1) AND (char_length(source_key) <= 200)));

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'approved'::text, 'dismissed'::text])));

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)));

alter table public.cxo_daily_queue_items add constraint cxo_daily_queue_items_via_check CHECK ((via = ANY (ARRAY['app'::text, 'mcp'::text])));

alter table public.cxo_daily_queue_runs add constraint cxo_daily_queue_runs_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_daily_queue_runs add constraint cxo_daily_queue_runs_via_check CHECK ((via = ANY (ARRAY['app'::text, 'mcp'::text])));

alter table public.cxo_decisions add constraint cxo_decisions_decided_by_check CHECK (((decided_by IS NULL) OR (char_length(decided_by) <= 120)));

alter table public.cxo_decisions add constraint cxo_decisions_idx_check CHECK ((idx >= 0));

alter table public.cxo_decisions add constraint cxo_decisions_meeting_title_check CHECK (((meeting_title IS NULL) OR (char_length(meeting_title) <= 300)));

alter table public.cxo_decisions add constraint cxo_decisions_note_id_fkey FOREIGN KEY (note_id) REFERENCES plaud_notes(id) ON DELETE CASCADE;

alter table public.cxo_decisions add constraint cxo_decisions_reversal_reason_check CHECK (((reversal_reason IS NULL) OR (char_length(reversal_reason) <= 300)));

alter table public.cxo_decisions add constraint cxo_decisions_reversed_by_id_fkey FOREIGN KEY (reversed_by_id) REFERENCES cxo_decisions(id) ON DELETE SET NULL;

alter table public.cxo_decisions add constraint cxo_decisions_reverses_id_fkey FOREIGN KEY (reverses_id) REFERENCES cxo_decisions(id) ON DELETE SET NULL;

alter table public.cxo_decisions add constraint cxo_decisions_text_check CHECK (((char_length(text) >= 1) AND (char_length(text) <= 600)));

alter table public.cxo_decisions add constraint cxo_decisions_topic_check CHECK ((char_length(topic) <= 600));

alter table public.cxo_due_digests add constraint cxo_due_digests_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_due_reminders add constraint cxo_due_reminders_card_id_fkey FOREIGN KEY (card_id) REFERENCES cxo_board_cards(id) ON DELETE CASCADE;

alter table public.cxo_due_reminders add constraint cxo_due_reminders_kind_check CHECK ((kind = ANY (ARRAY['d7'::text, 'd3'::text, 'd1'::text, 'd0'::text, 'overdue'::text])));

alter table public.cxo_due_reminders add constraint cxo_due_reminders_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_employee_kpis add constraint cxo_employee_kpis_actual_source_check CHECK ((actual_source = ANY (ARRAY['manual'::text, 'book'::text])));

alter table public.cxo_employee_kpis add constraint cxo_employee_kpis_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_employee_kpis add constraint cxo_employee_kpis_period_check CHECK ((period = ANY (ARRAY['month'::text, 'quarter'::text, 'year'::text])));

alter table public.cxo_employee_kpis add constraint cxo_employee_kpis_quota_type_check CHECK ((quota_type = ANY (ARRAY['revenue'::text, 'premium'::text, 'policies'::text, 'recruits'::text, 'appointments'::text, 'custom'::text])));

alter table public.cxo_employee_kpis add constraint cxo_employee_kpis_unit_check CHECK ((unit = ANY (ARRAY['count'::text, 'usd'::text, 'pct'::text, 'days'::text, 'hours'::text])));

alter table public.cxo_employee_time_off add constraint cxo_employee_time_off_check CHECK ((end_date >= start_date));

alter table public.cxo_employee_time_off add constraint cxo_employee_time_off_days_check CHECK ((days >= (0)::numeric));

alter table public.cxo_employee_time_off add constraint cxo_employee_time_off_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_employee_time_off add constraint cxo_employee_time_off_kind_check CHECK ((kind = ANY (ARRAY['vacation'::text, 'sick'::text, 'personal'::text, 'other'::text])));

alter table public.cxo_employees add constraint cxo_employees_book_dim_check CHECK (((book_dim IS NULL) OR (book_dim = ANY (ARRAY['agent'::text, 'team'::text]))));

alter table public.cxo_employees add constraint cxo_employees_manager_id_fkey FOREIGN KEY (manager_id) REFERENCES cxo_employees(id) ON DELETE SET NULL;

alter table public.cxo_employees add constraint cxo_employees_pay_frequency_check CHECK ((pay_frequency = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'semimonthly'::text, 'monthly'::text])));

alter table public.cxo_exec_assistants add constraint cxo_exec_assistants_assistant_member_id_fkey FOREIGN KEY (assistant_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_exec_assistants add constraint cxo_exec_assistants_check CHECK ((exec_member_id <> assistant_member_id));

alter table public.cxo_exec_assistants add constraint cxo_exec_assistants_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_exec_assistants add constraint cxo_exec_assistants_exec_member_id_fkey FOREIGN KEY (exec_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_exec_assistants add constraint cxo_exec_assistants_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_followup_notices add constraint cxo_followup_notices_body_check CHECK (((body IS NULL) OR (char_length(body) <= 8000)));

alter table public.cxo_followup_notices add constraint cxo_followup_notices_item_kind_check CHECK (((item_kind IS NULL) OR (item_kind = ANY (ARRAY['request'::text, 'card'::text, 'meeting'::text, 'report'::text, 'approval'::text, 'praise'::text]))));

alter table public.cxo_followup_notices add constraint cxo_followup_notices_kind_check CHECK ((kind = ANY (ARRAY['nudge'::text, 'escalate'::text, 'close'::text, 'report'::text, 'approval'::text, 'approval_result'::text, 'praise'::text])));

alter table public.cxo_followup_notices add constraint cxo_followup_notices_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_followup_notices add constraint cxo_followup_notices_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 300)));

alter table public.cxo_goals add constraint cxo_goals_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_goals add constraint cxo_goals_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_goals add constraint cxo_goals_status_check CHECK ((status = ANY (ARRAY['active'::text, 'done'::text])));

alter table public.cxo_goals add constraint cxo_goals_target_check CHECK ((target > (0)::numeric));

alter table public.cxo_goals add constraint cxo_goals_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 200)));

alter table public.cxo_goals add constraint cxo_goals_unit_check CHECK ((unit = ANY (ARRAY['count'::text, 'usd'::text, 'pct'::text])));

alter table public.cxo_ics_feeds add constraint cxo_ics_feeds_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_kpi_actuals add constraint cxo_kpi_actuals_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_kpi_actuals add constraint cxo_kpi_actuals_kpi_id_fkey FOREIGN KEY (kpi_id) REFERENCES cxo_employee_kpis(id) ON DELETE CASCADE;

alter table public.cxo_meeting_series add constraint cxo_meeting_series_choice_check CHECK ((choice = ANY (ARRAY['leadership'::text, 'not'::text])));

alter table public.cxo_mira_approvals add constraint cxo_mira_approvals_decided_by_fkey FOREIGN KEY (decided_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_mira_approvals add constraint cxo_mira_approvals_reason_check CHECK ((reason = ANY (ARRAY['outside_send'::text, 'others_work'::text, 'slack_hold'::text])));

alter table public.cxo_mira_approvals add constraint cxo_mira_approvals_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_mira_approvals add constraint cxo_mira_approvals_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'declined'::text, 'executed'::text, 'failed'::text])));

alter table public.cxo_mira_audit add constraint cxo_mira_audit_action_id_fkey FOREIGN KEY (action_id) REFERENCES cxo_mira_approvals(id) ON DELETE SET NULL;

alter table public.cxo_mira_audit add constraint cxo_mira_audit_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_mira_audit add constraint cxo_mira_audit_result_check CHECK ((result = ANY (ARRAY['ok'::text, 'not_done'::text, 'error'::text, 'refused'::text, 'queued'::text])));

alter table public.cxo_native_push_tokens add constraint cxo_native_push_tokens_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_native_push_tokens add constraint cxo_native_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])));

alter table public.cxo_native_push_tokens add constraint cxo_native_push_tokens_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_author_member_id_fkey FOREIGN KEY (author_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_author_name_check CHECK (((author_name IS NULL) OR (char_length(author_name) <= 200)));

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 2000)));

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_kind_check CHECK ((kind = ANY (ARRAY['agenda'::text, 'note'::text, 'action'::text, 'feedback'::text])));

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_one_on_one_id_fkey FOREIGN KEY (one_on_one_id) REFERENCES cxo_one_on_ones(id) ON DELETE CASCADE;

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_one_on_one_items add constraint cxo_one_on_one_items_owner_name_check CHECK (((owner_name IS NULL) OR (char_length(owner_name) <= 200)));

alter table public.cxo_one_on_ones add constraint cxo_one_on_ones_cadence_check CHECK ((cadence = ANY (ARRAY['weekly'::text, 'biweekly'::text, 'monthly'::text])));

alter table public.cxo_one_on_ones add constraint cxo_one_on_ones_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_one_on_ones add constraint cxo_one_on_ones_manager_member_id_fkey FOREIGN KEY (manager_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_one_on_ones add constraint cxo_one_on_ones_manager_name_check CHECK (((manager_name IS NULL) OR (char_length(manager_name) <= 200)));

alter table public.cxo_partner_actions add constraint cxo_partner_actions_kind_check CHECK ((kind = ANY (ARRAY['note'::text, 'email'::text, 'report'::text, 'task'::text, 'meeting'::text])));

alter table public.cxo_partner_actions add constraint cxo_partner_actions_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES cxo_partners(id) ON DELETE CASCADE;

alter table public.cxo_partner_actions add constraint cxo_partner_actions_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_partner_actions add constraint cxo_partner_actions_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'sent'::text, 'done'::text])));

alter table public.cxo_partners add constraint cxo_partners_kind_check CHECK ((kind = ANY (ARRAY['executive'::text, 'carrier'::text, 'agency'::text, 'board'::text, 'vendor'::text, 'producer'::text, 'other'::text])));

alter table public.cxo_partners add constraint cxo_partners_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_partners add constraint cxo_partners_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.cxo_plan_targets add constraint cxo_plan_targets_month_check CHECK (((month >= 1) AND (month <= 12)));

alter table public.cxo_plan_targets add constraint cxo_plan_targets_year_check CHECK (((year >= 2000) AND (year <= 2100)));

alter table public.cxo_plan_uploads add constraint cxo_plan_uploads_kind_check CHECK ((kind = ANY (ARRAY['plan'::text, 'comp'::text])));

alter table public.cxo_plan_uploads add constraint cxo_plan_uploads_read_by_check CHECK ((read_by = ANY (ARRAY['rules'::text, 'claude'::text])));

alter table public.cxo_plan_uploads add constraint cxo_plan_uploads_source_check CHECK ((source = ANY (ARRAY['xlsx'::text, 'xls'::text, 'csv'::text, 'pdf'::text, 'sheet'::text, 'file'::text])));

alter table public.cxo_praise add constraint cxo_praise_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 600)));

alter table public.cxo_praise add constraint cxo_praise_from_member_id_fkey FOREIGN KEY (from_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_praise add constraint cxo_praise_from_name_check CHECK (((char_length(from_name) >= 1) AND (char_length(from_name) <= 200)));

alter table public.cxo_praise add constraint cxo_praise_to_employee_id_fkey FOREIGN KEY (to_employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_praise add constraint cxo_praise_value_check CHECK (((value IS NULL) OR (char_length(value) <= 60)));

alter table public.cxo_qbo_connections add constraint cxo_qbo_connections_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'production'::text])));

alter table public.cxo_qbo_expense_monthly add constraint cxo_qbo_expense_monthly_month_check CHECK ((month ~ '^\d{4}-\d{2}$'::text));

alter table public.cxo_qbo_pnl_monthly add constraint cxo_qbo_pnl_monthly_month_check CHECK ((month ~ '^\d{4}-\d{2}$'::text));

alter table public.cxo_qbo_revenue_breakdown add constraint cxo_qbo_revenue_breakdown_dimension_check CHECK ((dimension = ANY (ARRAY['customer'::text, 'class'::text])));

alter table public.cxo_qbo_revenue_breakdown add constraint cxo_qbo_revenue_breakdown_month_check CHECK ((month ~ '^\d{4}-\d{2}$'::text));

alter table public.cxo_report_jobs add constraint cxo_report_jobs_cadence_check CHECK ((cadence = ANY (ARRAY['daily'::text, 'weekly'::text])));

alter table public.cxo_report_jobs add constraint cxo_report_jobs_hour_check CHECK (((hour >= 0) AND (hour <= 23)));

alter table public.cxo_report_jobs add constraint cxo_report_jobs_kind_check CHECK ((kind = ANY (ARRAY['open_by_person'::text, 'overdue'::text, 'waiting_on'::text, 'my_open'::text, 'production'::text])));

alter table public.cxo_report_jobs add constraint cxo_report_jobs_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_report_jobs add constraint cxo_report_jobs_weekday_check CHECK (((weekday IS NULL) OR ((weekday >= 0) AND (weekday <= 6))));

alter table public.cxo_reviews add constraint cxo_reviews_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES cxo_employees(id) ON DELETE CASCADE;

alter table public.cxo_reviews add constraint cxo_reviews_overall_check CHECK (((overall >= 1) AND (overall <= 5)));

alter table public.cxo_reviews add constraint cxo_reviews_period_type_check CHECK ((period_type = ANY (ARRAY['month'::text, 'quarter'::text, 'year'::text])));

alter table public.cxo_slack_installs add constraint cxo_slack_installs_installed_by_fkey FOREIGN KEY (installed_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_slack_threads add constraint cxo_slack_threads_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_todo_note_scans add constraint cxo_todo_note_scans_note_id_fkey FOREIGN KEY (note_id) REFERENCES plaud_notes(id) ON DELETE CASCADE;

alter table public.cxo_todos add constraint cxo_todos_acted_by_member_id_fkey FOREIGN KEY (acted_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.cxo_todos add constraint cxo_todos_assignee_partner_id_fkey FOREIGN KEY (assignee_partner_id) REFERENCES cxo_partners(id) ON DELETE SET NULL;

alter table public.cxo_todos add constraint cxo_todos_kind_check CHECK ((kind = ANY (ARRAY['task'::text, 'email'::text, 'call'::text, 'prep'::text, 'team'::text, 'personal'::text])));

alter table public.cxo_todos add constraint cxo_todos_link_kind_check CHECK (((link_kind IS NULL) OR (link_kind = ANY (ARRAY['partner'::text, 'agent'::text, 'meeting'::text, 'card'::text, 'message'::text]))));

alter table public.cxo_todos add constraint cxo_todos_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.cxo_todos add constraint cxo_todos_note_id_fkey FOREIGN KEY (note_id) REFERENCES plaud_notes(id) ON DELETE SET NULL;

alter table public.cxo_todos add constraint cxo_todos_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES cxo_partners(id) ON DELETE SET NULL;

alter table public.cxo_todos add constraint cxo_todos_priority_check CHECK ((priority = ANY (ARRAY['high'::text, 'normal'::text, 'low'::text])));

alter table public.cxo_todos add constraint cxo_todos_remind_rule_check CHECK (((remind_rule IS NULL) OR (remind_rule = ANY (ARRAY['daily'::text, 'weekdays'::text, 'weekly'::text]))));

alter table public.cxo_todos add constraint cxo_todos_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'meeting'::text, 'partner'::text, 'mira'::text, 'message'::text])));

alter table public.cxo_weekly_status add constraint cxo_weekly_status_week_check CHECK ((week ~ '^\d{4}-W\d{2}$'::text));

alter table public.deferred_items add constraint deferred_items_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.deferred_items add constraint deferred_items_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.deferred_items add constraint deferred_items_source_check CHECK ((source = ANY (ARRAY['walkie'::text, 'voice_memo'::text, 'room'::text, 'lead'::text, 'roleplay'::text, 'self'::text])));

alter table public.deferred_items add constraint deferred_items_source_lead_id_fkey FOREIGN KEY (source_lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.deferred_items add constraint deferred_items_source_member_id_fkey FOREIGN KEY (source_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.deferred_items add constraint deferred_items_source_memo_id_fkey FOREIGN KEY (source_memo_id) REFERENCES voice_memos(id) ON DELETE SET NULL;

alter table public.deferred_items add constraint deferred_items_source_room_message_id_fkey FOREIGN KEY (source_room_message_id) REFERENCES room_messages(id) ON DELETE SET NULL;

alter table public.deferred_items add constraint deferred_items_source_session_id_fkey FOREIGN KEY (source_session_id) REFERENCES roleplay_sessions(id) ON DELETE SET NULL;

alter table public.deferred_items add constraint deferred_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'snoozed'::text, 'done'::text, 'dismissed'::text])));

alter table public.dialer_hour_grants add constraint dialer_hour_grants_granted_seconds_check CHECK ((granted_seconds >= 0));

alter table public.dialer_hour_grants add constraint dialer_hour_grants_grantee_member_id_fkey FOREIGN KEY (grantee_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.dialer_hour_grants add constraint dialer_hour_grants_granter_member_id_fkey FOREIGN KEY (granter_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.dialer_hour_grants add constraint dialer_hour_grants_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_kpis add constraint dialer_kpis_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_mode_allocations add constraint dialer_mode_allocations_allocated_seconds_check CHECK ((allocated_seconds >= 0));

alter table public.dialer_mode_allocations add constraint dialer_mode_allocations_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.dialer_mode_allocations add constraint dialer_mode_allocations_mode_check CHECK ((mode = ANY (ARRAY['concierge'::text, 'appointment_setter'::text, 'live_transfer'::text, 'pipeline'::text])));

alter table public.dialer_mode_allocations add constraint dialer_mode_allocations_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_queue add constraint dialer_queue_ai_salesperson_id_fkey FOREIGN KEY (ai_salesperson_id) REFERENCES ai_salespeople(id) ON DELETE SET NULL;

alter table public.dialer_queue add constraint dialer_queue_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES ai_salesperson_campaigns(id) ON DELETE SET NULL;

alter table public.dialer_queue add constraint dialer_queue_dialer_mode_check CHECK ((dialer_mode = ANY (ARRAY['concierge'::text, 'appointment_setter'::text, 'pipeline'::text, 'live_transfer'::text])));

alter table public.dialer_queue add constraint dialer_queue_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;

alter table public.dialer_queue add constraint dialer_queue_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.dialer_queue add constraint dialer_queue_live_transfer_status_check CHECK ((live_transfer_status = ANY (ARRAY['pending'::text, 'attempted'::text, 'transferred'::text, 'fallback_booked'::text, 'fallback_callback'::text, 'fallback_ended'::text])));

alter table public.dialer_queue add constraint dialer_queue_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.dialer_queue add constraint dialer_queue_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_queue add constraint dialer_queue_source_kind_check CHECK ((source_kind = ANY (ARRAY['calendar'::text, 'crm'::text, 'payment'::text, 'csv'::text, 'telegram'::text, 'manual'::text])));

alter table public.dialer_queue add constraint dialer_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'cancelled'::text, 'expired'::text])));

alter table public.dialer_queue add constraint dialer_queue_workflow_rule_id_fkey FOREIGN KEY (workflow_rule_id) REFERENCES dialer_workflow_rules(id) ON DELETE SET NULL;

alter table public.dialer_queue_events add constraint dialer_queue_events_event_type_check CHECK ((event_type = ANY (ARRAY['enqueued'::text, 'dispatched'::text, 'provider_call_started'::text, 'provider_call_completed'::text, 'retry_scheduled'::text, 'failed'::text, 'cancelled'::text, 'live_transfer_attempted'::text, 'live_transfer_fallback_booked'::text, 'live_transfer_fallback_callback'::text, 'live_transfer_fallback_ended'::text])));

alter table public.dialer_queue_events add constraint dialer_queue_events_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.dialer_queue_events add constraint dialer_queue_events_queue_id_fkey FOREIGN KEY (queue_id) REFERENCES dialer_queue(id) ON DELETE CASCADE;

alter table public.dialer_queue_events add constraint dialer_queue_events_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_queue_events add constraint dialer_queue_events_workflow_rule_id_fkey FOREIGN KEY (workflow_rule_id) REFERENCES dialer_workflow_rules(id) ON DELETE SET NULL;

alter table public.dialer_shifts add constraint dialer_shifts_check CHECK ((end_minute > start_minute));

alter table public.dialer_shifts add constraint dialer_shifts_end_minute_check CHECK (((end_minute >= 1) AND (end_minute <= 1440)));

alter table public.dialer_shifts add constraint dialer_shifts_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.dialer_shifts add constraint dialer_shifts_mode_check CHECK (((mode IS NULL) OR (mode = ANY (ARRAY['concierge'::text, 'appointment_setter'::text, 'live_transfer'::text, 'pipeline'::text]))));

alter table public.dialer_shifts add constraint dialer_shifts_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_shifts add constraint dialer_shifts_start_minute_check CHECK (((start_minute >= 0) AND (start_minute <= 1439)));

alter table public.dialer_shifts add constraint dialer_shifts_weekday_check CHECK (((weekday >= 0) AND (weekday <= 6)));

alter table public.dialer_transfer_availability add constraint dialer_transfer_availability_day_of_week_check CHECK (((day_of_week >= 0) AND (day_of_week <= 6)));

alter table public.dialer_transfer_availability add constraint dialer_transfer_availability_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.dialer_transfer_availability add constraint dialer_transfer_availability_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_transfer_availability add constraint dialer_transfer_availability_window_check CHECK ((end_local > start_local));

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_created_by_member_id_fkey FOREIGN KEY (created_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_dialer_mode_check CHECK ((dialer_mode = ANY (ARRAY['concierge'::text, 'appointment_setter'::text, 'pipeline'::text, 'live_transfer'::text])));

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_max_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10)));

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_retry_delay_min_check CHECK (((retry_delay_min >= 1) AND (retry_delay_min <= 1440)));

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_scope_check CHECK ((scope = ANY (ARRAY['personal'::text, 'team'::text, 'account'::text])));

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_scope_owner_check CHECK ((((scope = 'personal'::text) AND (owner_member_id IS NOT NULL) AND (team_id IS NULL)) OR ((scope = 'team'::text) AND (team_id IS NOT NULL)) OR ((scope = 'account'::text) AND (team_id IS NULL))));

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

alter table public.dialer_workflow_rules add constraint dialer_workflow_rules_trigger_kind_check CHECK ((trigger_kind = ANY (ARRAY['calendar_reminder'::text, 'calendar_reschedule_request'::text, 'crm_stage_changed'::text, 'payment_event'::text, 'csv_batch'::text, 'telegram_command'::text])));

alter table public.email_drafts add constraint email_drafts_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.email_drafts add constraint email_drafts_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.email_drafts add constraint email_drafts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'sent'::text, 'dismissed'::text, 'superseded'::text])));

alter table public.email_drafts add constraint email_drafts_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES email_threads(id) ON DELETE CASCADE;

alter table public.email_messages add constraint email_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));

alter table public.email_messages add constraint email_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES email_threads(id) ON DELETE CASCADE;

alter table public.email_threads add constraint email_threads_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.email_threads add constraint email_threads_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.email_threads add constraint email_threads_priority_check CHECK ((priority = ANY (ARRAY['urgent'::text, 'high'::text, 'normal'::text, 'low'::text, 'noise'::text])));

alter table public.email_threads add constraint email_threads_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.email_threads add constraint email_threads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'drafted'::text, 'approved'::text, 'sent'::text, 'snoozed'::text, 'archived'::text, 'dismissed'::text])));

alter table public.feature_requests add constraint feature_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.feature_requests add constraint feature_requests_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.feature_requests add constraint feature_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'planned'::text, 'shipped'::text, 'wont_do'::text])));

alter table public.fix_requests add constraint fix_requests_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.fix_requests add constraint fix_requests_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.fix_requests add constraint fix_requests_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])));

alter table public.fix_requests add constraint fix_requests_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'dismiss'::text, 'plan'::text, 'auto'::text])));

alter table public.fix_requests add constraint fix_requests_status_check CHECK ((status = ANY (ARRAY['new'::text, 'sent'::text, 'resolved'::text, 'dismissed'::text])));

alter table public.gmail_sync_state add constraint gmail_sync_state_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.gmail_sync_state add constraint gmail_sync_state_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.google_tokens add constraint google_tokens_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.google_tokens add constraint google_tokens_oauth_source_check CHECK ((oauth_source = ANY (ARRAY['tenant'::text, 'brand'::text, 'global'::text])));

alter table public.google_tokens add constraint google_tokens_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.import_batches add constraint import_batches_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.import_batches add constraint import_batches_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.import_batches add constraint import_batches_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'paused'::text, 'completed'::text])));

alter table public.invoices add constraint invoices_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.invoices add constraint invoices_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE SET NULL;

alter table public.invoices add constraint invoices_scope_check CHECK ((scope = ANY (ARRAY['org'::text, 'member'::text])));

alter table public.kpi_cards add constraint kpi_cards_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.kpi_cards add constraint kpi_cards_period_check CHECK ((period = ANY (ARRAY['day'::text, 'week'::text, 'month'::text])));

alter table public.kpi_cards add constraint kpi_cards_reminder_cadence_check CHECK ((reminder_cadence = ANY (ARRAY['none'::text, 'daily'::text, 'weekdays'::text, 'weekly'::text])));

alter table public.kpi_cards add constraint kpi_cards_reminder_dow_check CHECK (((reminder_dow IS NULL) OR ((reminder_dow >= 0) AND (reminder_dow <= 6))));

alter table public.kpi_cards add constraint kpi_cards_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.kpi_entries add constraint kpi_entries_kpi_card_id_fkey FOREIGN KEY (kpi_card_id) REFERENCES kpi_cards(id) ON DELETE CASCADE;

alter table public.kpi_entries add constraint kpi_entries_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.kpi_entries add constraint kpi_entries_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.lead_activities add constraint lead_activities_author_member_id_fkey FOREIGN KEY (author_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.lead_activities add constraint lead_activities_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

alter table public.lead_activities add constraint lead_activities_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.lead_activities add constraint lead_activities_source_check CHECK ((source = ANY (ARRAY['manual'::text, 'ai'::text, 'sync'::text])));

alter table public.lead_activities add constraint lead_activities_type_check CHECK ((type = ANY (ARRAY['note'::text, 'email'::text, 'visit'::text, 'meeting'::text, 'task'::text, 'other'::text])));

alter table public.lead_campaign_events add constraint lead_campaign_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES lead_campaigns(id) ON DELETE CASCADE;

alter table public.lead_campaigns add constraint lead_campaigns_ai_salesperson_id_fkey FOREIGN KEY (ai_salesperson_id) REFERENCES ai_salespeople(id) ON DELETE SET NULL;

alter table public.lead_campaigns add constraint lead_campaigns_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'stopped'::text, 'failed'::text])));

alter table public.lead_events add constraint lead_events_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

alter table public.lead_events add constraint lead_events_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id);

alter table public.lead_notes add constraint lead_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES members(id);

alter table public.lead_notes add constraint lead_notes_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE;

alter table public.leads add constraint leads_ai_salesperson_id_fkey FOREIGN KEY (ai_salesperson_id) REFERENCES ai_salespeople(id) ON DELETE SET NULL;

alter table public.leads add constraint leads_import_batch_id_fkey FOREIGN KEY (import_batch_id) REFERENCES import_batches(id) ON DELETE SET NULL;

alter table public.leads add constraint leads_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.leads add constraint leads_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE SET NULL;

alter table public.leads add constraint leads_pipeline_stage_id_fkey FOREIGN KEY (pipeline_stage_id) REFERENCES pipeline_stages(id) ON DELETE SET NULL;

alter table public.leads add constraint leads_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.leads add constraint leads_status_check CHECK ((status = ANY (ARRAY['hot'::text, 'warm'::text, 'cold'::text, 'dormant'::text])));

alter table public.leads add constraint leads_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

alter table public.liability_agreements add constraint liability_agreements_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.liability_agreements add constraint liability_agreements_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.mcp_tokens add constraint mcp_tokens_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.mcp_tokens add constraint mcp_tokens_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.meetings add constraint meetings_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.meetings add constraint meetings_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.meetings add constraint meetings_source_check CHECK ((source = ANY (ARRAY['google'::text, 'cal'::text, 'ghl'::text, 'manual'::text])));

alter table public.meetings add constraint meetings_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'confirmed'::text, 'reschedule_requested'::text, 'rescheduled'::text, 'cancelled'::text, 'no_response'::text, 'completed'::text, 'noshow'::text])));

alter table public.member_addons add constraint member_addons_addon_key_check CHECK ((addon_key = ANY (ARRAY['roleplay'::text, 'custom_integration'::text])));

alter table public.member_addons add constraint member_addons_granted_by_member_id_fkey FOREIGN KEY (granted_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.member_addons add constraint member_addons_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.member_addons add constraint member_addons_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.member_message_triage add constraint member_message_triage_category_check CHECK ((category = ANY (ARRAY['decision'::text, 'answer'::text, 'fyi'::text, 'time'::text])));

alter table public.member_message_triage add constraint member_message_triage_message_id_fkey FOREIGN KEY (message_id) REFERENCES member_messages(id) ON DELETE CASCADE;

alter table public.member_message_triage add constraint member_message_triage_outcome_check CHECK ((outcome = ANY (ARRAY['answered'::text, 'agenda'::text, 'todo'::text, 'card'::text, 'time_booked'::text])));

alter table public.member_message_triage add constraint member_message_triage_suggestion_check CHECK ((suggestion = ANY (ARRAY['reply'::text, 'agenda'::text, 'todo'::text, 'card'::text, 'time'::text, 'none'::text])));

alter table public.member_message_triage add constraint member_message_triage_to_member_id_fkey FOREIGN KEY (to_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.member_messages add constraint member_messages_acted_by_member_id_fkey FOREIGN KEY (acted_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.member_messages add constraint member_messages_body_check CHECK (((char_length(body) >= 1) AND (char_length(body) <= 4000)));

alter table public.member_messages add constraint member_messages_check CHECK ((from_member_id <> to_member_id));

alter table public.member_messages add constraint member_messages_from_member_id_fkey FOREIGN KEY (from_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.member_messages add constraint member_messages_kind_check CHECK ((kind = ANY (ARRAY['message'::text, 'request'::text, 'question'::text, 'note'::text])));

alter table public.member_messages add constraint member_messages_replied_to_id_fkey FOREIGN KEY (replied_to_id) REFERENCES member_messages(id) ON DELETE CASCADE;

alter table public.member_messages add constraint member_messages_to_member_id_fkey FOREIGN KEY (to_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.members add constraint members_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.members add constraint members_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.members add constraint members_role_check CHECK ((role = ANY ('{admin,manager,observer,owner,rep,assistant}'::text[])));

alter table public.onboarding_tokens add constraint onboarding_tokens_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.org_billing_week add constraint org_billing_week_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.org_billing_week add constraint org_billing_week_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text])));

alter table public.outbound_messages add constraint outbound_messages_channel_check CHECK ((channel = ANY (ARRAY['imessage'::text, 'sms'::text, 'email'::text, 'telegram'::text])));

alter table public.outbound_messages add constraint outbound_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));

alter table public.outbound_messages add constraint outbound_messages_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.outbound_messages add constraint outbound_messages_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.outbound_messages add constraint outbound_messages_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'delivered'::text, 'failed'::text])));

alter table public.payroll_deposits add constraint payroll_deposits_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.payroll_settings add constraint payroll_settings_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.pinnacle_people_rollup add constraint pinnacle_people_rollup_id_check CHECK ((id = 1));

alter table public.pinnacle_sync_state add constraint pinnacle_sync_state_id_check CHECK ((id = 1));

alter table public.pipeline_items add constraint pipeline_items_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.pipeline_items add constraint pipeline_items_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE;

alter table public.pipeline_items add constraint pipeline_items_pipeline_stage_id_fkey FOREIGN KEY (pipeline_stage_id) REFERENCES pipeline_stages(id) ON DELETE SET NULL;

alter table public.pipeline_items add constraint pipeline_items_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.pipeline_items add constraint pipeline_items_status_check CHECK ((status = ANY (ARRAY['open'::text, 'active'::text, 'blocked'::text, 'done'::text, 'archived'::text])));

alter table public.pipeline_stages add constraint pipeline_stages_pipeline_id_fkey FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE;

alter table public.pipeline_stages add constraint pipeline_stages_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.pipelines add constraint pipelines_kind_check CHECK ((kind = ANY (ARRAY['sales'::text, 'recruiting'::text, 'team'::text, 'project'::text, 'custom'::text])));

alter table public.pipelines add constraint pipelines_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.pipelines add constraint pipelines_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.plaud_actions add constraint plaud_actions_kind_check CHECK ((kind = ANY (ARRAY['create_task'::text, 'create_doc'::text, 'update_sheet'::text, 'send_email'::text, 'create_calendar_event'::text, 'notify_member'::text])));

alter table public.plaud_actions add constraint plaud_actions_note_id_fkey FOREIGN KEY (note_id) REFERENCES plaud_notes(id) ON DELETE CASCADE;

alter table public.plaud_actions add constraint plaud_actions_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.plaud_actions add constraint plaud_actions_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.plaud_actions add constraint plaud_actions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'executed'::text, 'failed'::text, 'dismissed'::text, 'superseded'::text])));

alter table public.plaud_actions add constraint plaud_actions_target_member_id_fkey FOREIGN KEY (target_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.plaud_agent_guidance add constraint plaud_agent_guidance_kind_check CHECK ((kind = ANY (ARRAY['avoid'::text, 'prefer'::text, 'correction'::text, 'fact'::text])));

alter table public.plaud_agent_guidance add constraint plaud_agent_guidance_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.plaud_agent_guidance add constraint plaud_agent_guidance_scope_check CHECK ((scope = ANY (ARRAY['note_agent'::text, 'planner'::text, 'both'::text, 'email'::text])));

alter table public.plaud_agent_guidance add constraint plaud_agent_guidance_source_check CHECK ((source = ANY (ARRAY['action'::text, 'plan'::text, 'manual'::text])));

alter table public.plaud_daily_plans add constraint plaud_daily_plans_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.plaud_daily_plans add constraint plaud_daily_plans_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.plaud_daily_plans add constraint plaud_daily_plans_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'reviewed'::text])));

alter table public.plaud_notes add constraint plaud_notes_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.plaud_notes add constraint plaud_notes_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.plaud_notes add constraint plaud_notes_triage_class_check CHECK ((triage_class = ANY (ARRAY['trash'::text, 'action'::text, 'training'::text, 'executive'::text, 'unclear'::text])));

alter table public.plaud_plan_feedback add constraint plaud_plan_feedback_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.plaud_plan_feedback add constraint plaud_plan_feedback_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES plaud_daily_plans(id) ON DELETE CASCADE;

alter table public.plaud_plan_feedback add constraint plaud_plan_feedback_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.plaud_plan_feedback add constraint plaud_plan_feedback_verdict_check CHECK ((verdict = ANY (ARRAY['up'::text, 'down'::text])));

alter table public.plaud_settings add constraint plaud_settings_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.project_sections add constraint project_sections_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

alter table public.project_sections add constraint project_sections_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.project_task_steps add constraint project_task_steps_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

alter table public.project_task_steps add constraint project_task_steps_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.project_task_steps add constraint project_task_steps_task_id_fkey FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE;

alter table public.project_tasks add constraint project_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES members(id) ON DELETE SET NULL;

alter table public.project_tasks add constraint project_tasks_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

alter table public.project_tasks add constraint project_tasks_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.project_tasks add constraint project_tasks_section_id_fkey FOREIGN KEY (section_id) REFERENCES project_sections(id) ON DELETE CASCADE;

alter table public.project_tasks add constraint project_tasks_status_check CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text, 'blocked'::text])));

alter table public.projects add constraint projects_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.projects add constraint projects_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.projects add constraint projects_source_kind_check CHECK ((source_kind = ANY (ARRAY['prompt'::text, 'pdf'::text, 'docx'::text, 'manual'::text])));

alter table public.projects add constraint projects_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'archived'::text])));

alter table public.prospects add constraint prospects_cart_id_fkey FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE SET NULL;

alter table public.prospects add constraint prospects_pipeline_stage_check CHECK ((pipeline_stage = ANY (ARRAY['lead'::text, 'call_booked'::text, 'plan_generated'::text, 'quote_sent'::text, 'payment_made'::text, 'kickoff_scheduled'::text, 'building'::text, 'active'::text, 'lost'::text])));

alter table public.prospects add constraint prospects_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE SET NULL;

alter table public.prospects add constraint prospects_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'booked'::text, 'won'::text, 'lost'::text, 'canceled'::text])));

alter table public.recommendation_suppressions add constraint recommendation_suppressions_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.recommendations add constraint recommendations_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text])));

alter table public.recommendations add constraint recommendations_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.recommendations add constraint recommendations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'acted'::text, 'dismissed'::text, 'stale'::text])));

alter table public.rep_addons add constraint rep_addons_addon_key_check CHECK ((addon_key = ANY (ARRAY['roleplay'::text, 'custom_integration'::text])));

alter table public.rep_addons add constraint rep_addons_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.rep_addons add constraint rep_addons_seats_check CHECK ((seats >= 0));

alter table public.rep_api_keys add constraint rep_api_keys_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.rep_contacts add constraint rep_contacts_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.rep_contacts add constraint rep_contacts_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.reps add constraint reps_billing_status_check CHECK ((billing_status = ANY (ARRAY['none'::text, 'pending_activation'::text, 'building'::text, 'trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'incomplete'::text, 'paused'::text, 'comped'::text])));

alter table public.reps add constraint reps_brand_check CHECK ((brand = ANY (ARRAY['virtualcloser'::text, 'cxo'::text])));

alter table public.reps add constraint reps_dialer_pool_mode_check CHECK ((dialer_pool_mode = ANY (ARRAY['shared'::text, 'per_rep'::text])));

alter table public.reps add constraint reps_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE SET NULL;

alter table public.reps add constraint reps_tier_check CHECK ((tier = ANY (ARRAY['individual'::text, 'team'::text, 'enterprise'::text])));

alter table public.reps add constraint reps_volume_tier_check CHECK ((volume_tier = ANY (ARRAY['t1'::text, 't2'::text, 't3'::text, 't4'::text, 't5'::text])));

alter table public.roleplay_assignments add constraint roleplay_assignments_assigned_by_member_id_fkey FOREIGN KEY (assigned_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.roleplay_assignments add constraint roleplay_assignments_assignee_member_id_fkey FOREIGN KEY (assignee_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.roleplay_assignments add constraint roleplay_assignments_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.roleplay_assignments add constraint roleplay_assignments_required_count_check CHECK ((required_count > 0));

alter table public.roleplay_assignments add constraint roleplay_assignments_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES roleplay_scenarios(id) ON DELETE CASCADE;

alter table public.roleplay_assignments add constraint roleplay_assignments_status_check CHECK ((status = ANY (ARRAY['open'::text, 'completed'::text, 'expired'::text, 'canceled'::text])));

alter table public.roleplay_assignments add constraint roleplay_assignments_target_check CHECK (((assignee_member_id IS NOT NULL) OR (team_id IS NOT NULL)));

alter table public.roleplay_assignments add constraint roleplay_assignments_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.roleplay_daily_activity add constraint roleplay_daily_activity_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.roleplay_daily_activity add constraint roleplay_daily_activity_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.roleplay_quotas add constraint roleplay_quotas_cadence_check CHECK ((cadence = ANY (ARRAY['daily'::text, 'weekly'::text, 'monthly'::text])));

alter table public.roleplay_quotas add constraint roleplay_quotas_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.roleplay_quotas add constraint roleplay_quotas_required_count_check CHECK ((required_count > 0));

alter table public.roleplay_quotas add constraint roleplay_quotas_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.roleplay_reviews add constraint roleplay_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)));

alter table public.roleplay_reviews add constraint roleplay_reviews_reviewer_member_id_fkey FOREIGN KEY (reviewer_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.roleplay_reviews add constraint roleplay_reviews_session_id_fkey FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE CASCADE;

alter table public.roleplay_reviews add constraint roleplay_reviews_verdict_check CHECK ((verdict = ANY (ARRAY['ready'::text, 'needs_work'::text, 'escalate'::text])));

alter table public.roleplay_scenario_docs add constraint roleplay_scenario_docs_doc_id_fkey FOREIGN KEY (doc_id) REFERENCES roleplay_training_docs(id) ON DELETE CASCADE;

alter table public.roleplay_scenario_docs add constraint roleplay_scenario_docs_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES roleplay_scenarios(id) ON DELETE CASCADE;

alter table public.roleplay_scenarios add constraint roleplay_scenarios_created_by_member_id_fkey FOREIGN KEY (created_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.roleplay_scenarios add constraint roleplay_scenarios_difficulty_check CHECK ((difficulty = ANY (ARRAY['easy'::text, 'standard'::text, 'hard'::text, 'brutal'::text])));

alter table public.roleplay_scenarios add constraint roleplay_scenarios_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.roleplay_sessions add constraint roleplay_sessions_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.roleplay_sessions add constraint roleplay_sessions_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.roleplay_sessions add constraint roleplay_sessions_scenario_id_fkey FOREIGN KEY (scenario_id) REFERENCES roleplay_scenarios(id) ON DELETE CASCADE;

alter table public.roleplay_sessions add constraint roleplay_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'abandoned'::text])));

alter table public.roleplay_training_docs add constraint roleplay_training_docs_ai_salesperson_id_fkey FOREIGN KEY (ai_salesperson_id) REFERENCES ai_salespeople(id) ON DELETE SET NULL;

alter table public.roleplay_training_docs add constraint roleplay_training_docs_doc_kind_check CHECK ((doc_kind = ANY (ARRAY['product_brief'::text, 'script'::text, 'objection_list'::text, 'case_study'::text, 'training'::text, 'reference'::text])));

alter table public.roleplay_training_docs add constraint roleplay_training_docs_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.roleplay_training_docs add constraint roleplay_training_docs_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.roleplay_training_docs add constraint roleplay_training_docs_scope_check CHECK ((scope = ANY (ARRAY['personal'::text, 'account'::text])));

alter table public.roleplay_training_docs add constraint roleplay_training_docs_scope_owner_check CHECK ((((scope = 'personal'::text) AND (owner_member_id IS NOT NULL)) OR ((scope = 'account'::text) AND (owner_member_id IS NULL))));

alter table public.roleplay_training_docs add constraint roleplay_training_docs_source_voice_memo_id_fkey FOREIGN KEY (source_voice_memo_id) REFERENCES voice_memos(id) ON DELETE SET NULL;

alter table public.roleplay_training_docs add constraint roleplay_training_docs_uploaded_by_member_id_fkey FOREIGN KEY (uploaded_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.roleplay_turns add constraint roleplay_turns_session_id_fkey FOREIGN KEY (session_id) REFERENCES roleplay_sessions(id) ON DELETE CASCADE;

alter table public.roleplay_turns add constraint roleplay_turns_speaker_check CHECK ((speaker = ANY (ARRAY['ai'::text, 'rep'::text])));

alter table public.room_deliveries add constraint room_deliveries_message_id_fkey FOREIGN KEY (message_id) REFERENCES room_messages(id) ON DELETE CASCADE;

alter table public.room_deliveries add constraint room_deliveries_recipient_member_id_fkey FOREIGN KEY (recipient_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.room_messages add constraint room_messages_audience_check CHECK (((audience = ANY (ARRAY['managers'::text, 'owners'::text])) OR (audience ~~ 'team:%'::text)));

alter table public.room_messages add constraint room_messages_kind_check CHECK ((kind = ANY (ARRAY['text'::text, 'voice'::text, 'system'::text])));

alter table public.room_messages add constraint room_messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES room_messages(id) ON DELETE SET NULL;

alter table public.room_messages add constraint room_messages_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.room_messages add constraint room_messages_sender_member_id_fkey FOREIGN KEY (sender_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.room_todos add constraint room_todos_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES members(id) ON DELETE SET NULL;

alter table public.room_todos add constraint room_todos_audience_check CHECK (((audience = ANY (ARRAY['managers'::text, 'owners'::text])) OR (audience ~~ 'team:%'::text)));

alter table public.room_todos add constraint room_todos_created_by_fkey FOREIGN KEY (created_by) REFERENCES members(id) ON DELETE SET NULL;

alter table public.room_todos add constraint room_todos_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.room_todos add constraint room_todos_status_check CHECK ((status = ANY (ARRAY['open'::text, 'done'::text, 'archived'::text])));

alter table public.sms_ai_sessions add constraint sms_ai_sessions_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.sms_messages add constraint sms_messages_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text])));

alter table public.sms_messages add constraint sms_messages_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.sms_messages add constraint sms_messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES sms_ai_sessions(id);

alter table public.targets add constraint targets_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.targets add constraint targets_period_type_check CHECK ((period_type = ANY (ARRAY['day'::text, 'week'::text, 'month'::text, 'quarter'::text, 'year'::text])));

alter table public.targets add constraint targets_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.targets add constraint targets_scope_check CHECK ((scope = ANY (ARRAY['personal'::text, 'team'::text, 'account'::text])));

alter table public.targets add constraint targets_status_check CHECK ((status = ANY (ARRAY['active'::text, 'hit'::text, 'missed'::text, 'archived'::text])));

alter table public.targets add constraint targets_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

alter table public.targets add constraint targets_visibility_check CHECK ((visibility = ANY (ARRAY['all'::text, 'managers'::text, 'owners'::text])));

alter table public.team_members add constraint team_members_member_id_fkey FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.team_members add constraint team_members_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.team_members add constraint team_members_role_check CHECK ((role = ANY (ARRAY['manager'::text, 'rep'::text, 'fulfillment_partner'::text, 'observer'::text])));

alter table public.team_members add constraint team_members_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;

alter table public.teams add constraint teams_manager_member_id_fkey FOREIGN KEY (manager_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.teams add constraint teams_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.usage_events add constraint usage_events_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.voice_calls add constraint voice_calls_ai_salesperson_id_fkey FOREIGN KEY (ai_salesperson_id) REFERENCES ai_salespeople(id) ON DELETE SET NULL;

alter table public.voice_calls add constraint voice_calls_dialer_mode_check CHECK ((dialer_mode = ANY (ARRAY['concierge'::text, 'appointment_setter'::text, 'pipeline'::text, 'live_transfer'::text])));

alter table public.voice_calls add constraint voice_calls_direction_check CHECK ((direction = ANY (ARRAY['outbound_confirm'::text, 'outbound_reschedule'::text, 'outbound_followup'::text, 'outbound_dial'::text, 'inbound'::text])));

alter table public.voice_calls add constraint voice_calls_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.voice_calls add constraint voice_calls_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE SET NULL;

alter table public.voice_calls add constraint voice_calls_outcome_check CHECK ((outcome = ANY (ARRAY['confirmed'::text, 'reschedule_requested'::text, 'rescheduled'::text, 'cancelled'::text, 'voicemail'::text, 'no_answer'::text, 'failed'::text, 'connected'::text, 'noshow_acknowledged'::text])));

alter table public.voice_calls add constraint voice_calls_owner_member_id_fkey FOREIGN KEY (owner_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.voice_calls add constraint voice_calls_provider_check CHECK ((provider = ANY (ARRAY['vapi'::text, 'retell'::text, 'bland'::text, 'twilio'::text, 'wavv'::text, 'manual'::text, 'revring'::text, 'ghl'::text])));

alter table public.voice_calls add constraint voice_calls_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.voice_calls add constraint voice_calls_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'ringing'::text, 'in_progress'::text, 'completed'::text, 'failed'::text, 'no_answer'::text, 'voicemail'::text, 'busy'::text, 'cancelled'::text, 'blocked_cap'::text])));

alter table public.voice_memos add constraint voice_memos_kind_check CHECK ((kind = ANY (ARRAY['pitch'::text, 'feedback'::text, 'note'::text, 'coaching'::text])));

alter table public.voice_memos add constraint voice_memos_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL;

alter table public.voice_memos add constraint voice_memos_parent_memo_id_fkey FOREIGN KEY (parent_memo_id) REFERENCES voice_memos(id) ON DELETE SET NULL;

alter table public.voice_memos add constraint voice_memos_recipient_member_id_fkey FOREIGN KEY (recipient_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.voice_memos add constraint voice_memos_rep_id_fkey FOREIGN KEY (rep_id) REFERENCES reps(id) ON DELETE CASCADE;

alter table public.voice_memos add constraint voice_memos_reviewed_by_member_id_fkey FOREIGN KEY (reviewed_by_member_id) REFERENCES members(id) ON DELETE SET NULL;

alter table public.voice_memos add constraint voice_memos_sender_member_id_fkey FOREIGN KEY (sender_member_id) REFERENCES members(id) ON DELETE CASCADE;

alter table public.voice_memos add constraint voice_memos_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_review'::text, 'ready'::text, 'needs_work'::text, 'archived'::text])));

alter table public.voice_memos add constraint voice_memos_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS addon_requests_pending_idx ON public.addon_requests USING btree (rep_id, addon_key) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS agent_actions_lead_idx ON public.agent_actions USING btree (lead_id);

CREATE INDEX IF NOT EXISTS agent_actions_owner_idx ON public.agent_actions USING btree (rep_id, owner_member_id);

CREATE INDEX IF NOT EXISTS agent_actions_rep_created_idx ON public.agent_actions USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_actions_rep_status_idx ON public.agent_actions USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS agent_actions_rep_type_idx ON public.agent_actions USING btree (rep_id, action_type);

CREATE INDEX IF NOT EXISTS agent_billing_event_member_idx ON public.agent_billing_event USING btree (member_id, processed_at DESC) WHERE (member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS agent_billing_event_type_idx ON public.agent_billing_event USING btree (event_type, processed_at DESC);

CREATE INDEX IF NOT EXISTS agent_billing_rep_idx ON public.agent_billing USING btree (rep_id);

CREATE INDEX IF NOT EXISTS agent_billing_status_idx ON public.agent_billing USING btree (status);

CREATE INDEX IF NOT EXISTS agent_billing_stripe_cust_idx ON public.agent_billing USING btree (stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS agent_billing_stripe_sub_idx ON public.agent_billing USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS agent_billing_week_member_idx ON public.agent_billing_week USING btree (member_id, iso_week DESC);

CREATE INDEX IF NOT EXISTS agent_billing_week_open_idx ON public.agent_billing_week USING btree (member_id) WHERE (status = 'open'::text);

CREATE INDEX IF NOT EXISTS agent_billing_week_rep_idx ON public.agent_billing_week USING btree (rep_id, iso_week);

CREATE INDEX IF NOT EXISTS agent_history_conversation_idx ON public.agent_history USING btree (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS agent_history_member_time_idx ON public.agent_history USING btree (member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_member_memory_member_idx ON public.agent_member_memory USING btree (rep_id, member_id, active, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_runs_rep_created_idx ON public.agent_runs USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS agent_usage_rep_day_idx ON public.agent_usage USING btree (rep_id, day DESC);

CREATE INDEX IF NOT EXISTS ai_salespeople_assigned_idx ON public.ai_salespeople USING btree (assigned_member_id) WHERE (assigned_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ai_salespeople_rep_idx ON public.ai_salespeople USING btree (rep_id);

CREATE INDEX IF NOT EXISTS ai_salespeople_rep_status_idx ON public.ai_salespeople USING btree (rep_id, status) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS ai_salesperson_campaigns_setter_idx ON public.ai_salesperson_campaigns USING btree (ai_salesperson_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_salesperson_followups_due_idx ON public.ai_salesperson_followups USING btree (rep_id, status, due_at) WHERE (status = ANY (ARRAY['pending'::text, 'queued'::text]));

CREATE INDEX IF NOT EXISTS ai_salesperson_followups_setter_idx ON public.ai_salesperson_followups USING btree (ai_salesperson_id, status, due_at);

CREATE INDEX IF NOT EXISTS ai_wallet_ledger_rep_idx ON public.ai_wallet_ledger USING btree (rep_id, created_at DESC);

CREATE UNIQUE INDEX ai_wallet_ledger_session_charge_key ON public.ai_wallet_ledger USING btree (session_id) WHERE (kind = 'roleplay_practice'::text);

CREATE INDEX IF NOT EXISTS audit_rep_action_idx ON public.audit_events USING btree (rep_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_rep_created_idx ON public.audit_events USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_rep_member_idx ON public.audit_events USING btree (rep_id, member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_audit_action_idx ON public.billing_audit USING btree (action, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_audit_member_idx ON public.billing_audit USING btree (member_id, created_at DESC) WHERE (member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS billing_audit_rep_idx ON public.billing_audit USING btree (rep_id, created_at DESC) WHERE (rep_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS billing_change_requests_open_idx ON public.billing_change_requests USING btree (rep_id, created_at DESC) WHERE (status = 'open'::text);

CREATE INDEX IF NOT EXISTS billing_periods_rep_idx ON public.billing_periods USING btree (rep_id, period_year_month DESC);

CREATE INDEX IF NOT EXISTS billing_periods_status_idx ON public.billing_periods USING btree (status, period_year_month);

CREATE INDEX IF NOT EXISTS brain_dumps_rep_created_idx ON public.brain_dumps USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS brain_items_deleted_recent_idx ON public.brain_items USING btree (rep_id, owner_member_id, deleted_at DESC) WHERE (deleted_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS brain_items_lead_idx ON public.brain_items USING btree (rep_id, lead_id) WHERE (lead_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS brain_items_owner_idx ON public.brain_items USING btree (rep_id, owner_member_id);

CREATE INDEX IF NOT EXISTS brain_items_rep_created_idx ON public.brain_items USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS brain_items_rep_horizon_idx ON public.brain_items USING btree (rep_id, horizon);

CREATE INDEX IF NOT EXISTS brain_items_rep_status_idx ON public.brain_items USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS brain_items_rep_type_idx ON public.brain_items USING btree (rep_id, item_type);

CREATE INDEX IF NOT EXISTS brain_items_search_idx ON public.brain_items USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS call_logs_commission_idx ON public.call_logs USING btree (rep_id, occurred_at DESC) WHERE (commission_amount IS NOT NULL);

CREATE INDEX IF NOT EXISTS call_logs_lead_idx ON public.call_logs USING btree (lead_id);

CREATE INDEX IF NOT EXISTS call_logs_owner_member_idx ON public.call_logs USING btree (rep_id, owner_member_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS call_logs_rep_idx ON public.call_logs USING btree (rep_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS call_logs_rep_outcome_idx ON public.call_logs USING btree (rep_id, outcome);

CREATE INDEX IF NOT EXISTS call_logs_team_idx ON public.call_logs USING btree (rep_id, team_id, occurred_at DESC) WHERE (team_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS carts_email_idx ON public.carts USING btree (lower(email)) WHERE (email IS NOT NULL);

CREATE INDEX IF NOT EXISTS carts_session_idx ON public.carts USING btree (checkout_session_id) WHERE (checkout_session_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS carts_unconverted_idx ON public.carts USING btree (created_at DESC) WHERE (converted_at IS NULL);

CREATE INDEX IF NOT EXISTS ciao_chat_folders_member_idx ON public.ciao_chat_folders USING btree (member_id, created_at);

CREATE INDEX IF NOT EXISTS ciao_conversations_folder_idx ON public.ciao_conversations USING btree (folder_id) WHERE (folder_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS ciao_conversations_member_idx ON public.ciao_conversations USING btree (member_id, last_at DESC);

CREATE INDEX IF NOT EXISTS client_addons_rep_idx ON public.client_addons USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS client_addons_status_idx ON public.client_addons USING btree (status) WHERE (status = ANY (ARRAY['active'::text, 'over_cap'::text]));

CREATE INDEX IF NOT EXISTS client_events_rep_created_idx ON public.client_events USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS client_integrations_rep_idx ON public.client_integrations USING btree (rep_id, is_active, created_at DESC);

CREATE INDEX IF NOT EXISTS commission_entries_agent_idx ON public.commission_entries USING btree (rep_id, agent_name);

CREATE INDEX IF NOT EXISTS commission_entries_rep_idx ON public.commission_entries USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS commission_entries_status_idx ON public.commission_entries USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS cxo_activity_rep_day ON public.cxo_activity USING btree (rep_id, day);

CREATE INDEX IF NOT EXISTS cxo_allowance_tiers_year_idx ON public.cxo_allowance_tiers USING btree (rep_id, year, carrier);

CREATE INDEX IF NOT EXISTS cxo_assistant_activity_assistant_idx ON public.cxo_assistant_activity USING btree (assistant_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_assistant_activity_exec_idx ON public.cxo_assistant_activity USING btree (rep_id, exec_member_id, created_at DESC);

CREATE UNIQUE INDEX cxo_behind_watch_employee_uq ON public.cxo_behind_watch USING btree (rep_id, employee_id);

CREATE INDEX IF NOT EXISTS cxo_board_card_assignees_member_idx ON public.cxo_board_card_assignees USING btree (rep_id, member_id);

CREATE UNIQUE INDEX cxo_board_card_assignees_member_uq ON public.cxo_board_card_assignees USING btree (card_id, member_id) WHERE (member_id IS NOT NULL);

CREATE UNIQUE INDEX cxo_board_card_assignees_partner_uq ON public.cxo_board_card_assignees USING btree (card_id, partner_id) WHERE (partner_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS cxo_board_cards_board_idx ON public.cxo_board_cards USING btree (board_id, list_id, "position");

CREATE INDEX IF NOT EXISTS cxo_board_cards_search_idx ON public.cxo_board_cards USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS cxo_board_checklist_card_idx ON public.cxo_board_checklist_items USING btree (card_id, "position");

CREATE INDEX IF NOT EXISTS cxo_board_lists_board_idx ON public.cxo_board_lists USING btree (board_id, "position");

CREATE UNIQUE INDEX cxo_board_updates_rep_month_uq ON public.cxo_board_updates USING btree (rep_id, month);

CREATE INDEX IF NOT EXISTS cxo_boards_rep_idx ON public.cxo_boards USING btree (rep_id, "position", created_at);

CREATE INDEX IF NOT EXISTS cxo_book_policies_producer_idx ON public.cxo_book_policies USING btree (producer_id);

CREATE INDEX IF NOT EXISTS cxo_book_policies_rep_day_idx ON public.cxo_book_policies USING btree (rep_id, submitted_on);

CREATE INDEX IF NOT EXISTS cxo_book_producers_rep_idx ON public.cxo_book_producers USING btree (rep_id, name);

CREATE INDEX IF NOT EXISTS cxo_ciao_pending_member_idx ON public.cxo_ciao_pending USING btree (rep_id, member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_comp_rates_rep_idx ON public.cxo_comp_rates USING btree (rep_id, carrier);

CREATE INDEX IF NOT EXISTS cxo_comp_tiers_emp_idx ON public.cxo_comp_tiers USING btree (rep_id, employee_id);

CREATE INDEX IF NOT EXISTS cxo_daily_queue_items_open_idx ON public.cxo_daily_queue_items USING btree (rep_id, member_id, status, day);

CREATE UNIQUE INDEX cxo_daily_queue_items_uq ON public.cxo_daily_queue_items USING btree (rep_id, member_id, source_key);

CREATE INDEX IF NOT EXISTS cxo_daily_queue_runs_idx ON public.cxo_daily_queue_runs USING btree (rep_id, member_id, day, ran_at DESC);

CREATE UNIQUE INDEX cxo_decisions_note_idx_uq ON public.cxo_decisions USING btree (note_id, idx);

CREATE INDEX IF NOT EXISTS cxo_decisions_rep_when_idx ON public.cxo_decisions USING btree (rep_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS cxo_due_reminders_member_unread ON public.cxo_due_reminders USING btree (member_id, read_at);

CREATE INDEX IF NOT EXISTS cxo_employee_kpis_emp_idx ON public.cxo_employee_kpis USING btree (rep_id, employee_id);

CREATE INDEX IF NOT EXISTS cxo_employee_time_off_emp_idx ON public.cxo_employee_time_off USING btree (rep_id, employee_id, start_date);

CREATE INDEX IF NOT EXISTS cxo_employees_member_idx ON public.cxo_employees USING btree (rep_id, member_id) WHERE (member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS cxo_employees_rep_idx ON public.cxo_employees USING btree (rep_id, department);

CREATE INDEX IF NOT EXISTS cxo_exec_assistants_assistant_idx ON public.cxo_exec_assistants USING btree (assistant_member_id) WHERE is_active;

CREATE INDEX IF NOT EXISTS cxo_exec_assistants_exec_idx ON public.cxo_exec_assistants USING btree (rep_id, exec_member_id);

CREATE INDEX IF NOT EXISTS cxo_followup_notices_item_idx ON public.cxo_followup_notices USING btree (rep_id, item_id);

CREATE UNIQUE INDEX cxo_followup_notices_key_uq ON public.cxo_followup_notices USING btree (rep_id, key);

CREATE INDEX IF NOT EXISTS cxo_followup_notices_member_idx ON public.cxo_followup_notices USING btree (rep_id, member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_goals_employee_idx ON public.cxo_goals USING btree (rep_id, employee_id);

CREATE INDEX IF NOT EXISTS cxo_kpi_actuals_rep_idx ON public.cxo_kpi_actuals USING btree (rep_id, period_key);

CREATE UNIQUE INDEX cxo_meeting_agendas_instance_uidx ON public.cxo_meeting_agendas USING btree (rep_id, series_id, starts_at);

CREATE INDEX IF NOT EXISTS cxo_meeting_agendas_rep_start_idx ON public.cxo_meeting_agendas USING btree (rep_id, starts_at DESC);

CREATE UNIQUE INDEX cxo_meeting_series_uidx ON public.cxo_meeting_series USING btree (rep_id, series_id);

CREATE INDEX IF NOT EXISTS cxo_mira_approvals_pending_idx ON public.cxo_mira_approvals USING btree (rep_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_mira_audit_member_idx ON public.cxo_mira_audit USING btree (rep_id, member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_mira_audit_rep_idx ON public.cxo_mira_audit USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_mira_corrections_rep_idx ON public.cxo_mira_corrections USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_native_push_tokens_member_idx ON public.cxo_native_push_tokens USING btree (rep_id, member_id);

CREATE UNIQUE INDEX cxo_onboarding_member_uq ON public.cxo_onboarding USING btree (rep_id, member_id);

CREATE INDEX IF NOT EXISTS cxo_one_on_one_items_idx ON public.cxo_one_on_one_items USING btree (rep_id, one_on_one_id, created_at);

CREATE UNIQUE INDEX cxo_one_on_ones_employee_uq ON public.cxo_one_on_ones USING btree (rep_id, employee_id);

CREATE INDEX IF NOT EXISTS cxo_partner_actions_partner_idx ON public.cxo_partner_actions USING btree (partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_partner_actions_rep_idx ON public.cxo_partner_actions USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_partners_email_idx ON public.cxo_partners USING btree (rep_id, lower(email));

CREATE INDEX IF NOT EXISTS cxo_partners_name_org_idx ON public.cxo_partners USING btree (rep_id, lower(name), lower(COALESCE(org, ''::text)));

CREATE INDEX IF NOT EXISTS cxo_partners_rep_idx ON public.cxo_partners USING btree (rep_id, kind, name);

CREATE INDEX IF NOT EXISTS cxo_plan_targets_year_idx ON public.cxo_plan_targets USING btree (rep_id, year);

CREATE INDEX IF NOT EXISTS cxo_plan_uploads_rep_idx ON public.cxo_plan_uploads USING btree (rep_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_praise_rep_idx ON public.cxo_praise USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_praise_to_idx ON public.cxo_praise USING btree (rep_id, to_employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cxo_qbo_employees_rep_idx ON public.cxo_qbo_employees USING btree (rep_id, active);

CREATE INDEX IF NOT EXISTS cxo_qbo_expense_monthly_rep_idx ON public.cxo_qbo_expense_monthly USING btree (rep_id, month);

CREATE INDEX IF NOT EXISTS cxo_qbo_revenue_breakdown_rep_idx ON public.cxo_qbo_revenue_breakdown USING btree (rep_id, dimension, month);

CREATE INDEX IF NOT EXISTS cxo_qbo_time_activity_emp_idx ON public.cxo_qbo_time_activity USING btree (rep_id, employee_qbo_id, txn_date);

CREATE INDEX IF NOT EXISTS cxo_qbo_time_activity_rep_idx ON public.cxo_qbo_time_activity USING btree (rep_id, txn_date);

CREATE INDEX IF NOT EXISTS cxo_report_jobs_due_idx ON public.cxo_report_jobs USING btree (next_run_at) WHERE (paused = false);

CREATE INDEX IF NOT EXISTS cxo_report_jobs_member_idx ON public.cxo_report_jobs USING btree (rep_id, member_id);

CREATE INDEX IF NOT EXISTS cxo_reviews_emp_idx ON public.cxo_reviews USING btree (rep_id, employee_id, period_key);

CREATE UNIQUE INDEX cxo_slack_installs_team_uq ON public.cxo_slack_installs USING btree (team_id);

CREATE INDEX IF NOT EXISTS cxo_slack_threads_rep_idx ON public.cxo_slack_threads USING btree (rep_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS cxo_todos_member_idx ON public.cxo_todos USING btree (rep_id, member_id) WHERE (deleted_at IS NULL);

CREATE UNIQUE INDEX cxo_todos_message_link_uq ON public.cxo_todos USING btree (rep_id, member_id, link_kind, link_id) WHERE ((link_kind = 'message'::text) AND (deleted_at IS NULL));

CREATE INDEX IF NOT EXISTS cxo_todos_remind_due_idx ON public.cxo_todos USING btree (remind_at) WHERE ((remind_at IS NOT NULL) AND (reminded_at IS NULL) AND (deleted_at IS NULL));

CREATE INDEX IF NOT EXISTS cxo_todos_search_idx ON public.cxo_todos USING gin (search_tsv);

CREATE UNIQUE INDEX cxo_todos_source_key_uq ON public.cxo_todos USING btree (rep_id, member_id, source_key) WHERE (source_key IS NOT NULL);

CREATE UNIQUE INDEX cxo_weekly_status_member_week_uq ON public.cxo_weekly_status USING btree (rep_id, member_id, week);

CREATE INDEX IF NOT EXISTS cxo_weekly_status_rep_week_idx ON public.cxo_weekly_status USING btree (rep_id, week);

CREATE INDEX IF NOT EXISTS deferred_owner_status_idx ON public.deferred_items USING btree (owner_member_id, status, remind_at);

CREATE INDEX IF NOT EXISTS deferred_remind_idx ON public.deferred_items USING btree (remind_at) WHERE ((status = ANY (ARRAY['open'::text, 'snoozed'::text])) AND (remind_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS deferred_rep_status_idx ON public.deferred_items USING btree (rep_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS deferred_source_idx ON public.deferred_items USING btree (rep_id, source, status, created_at DESC);

CREATE INDEX IF NOT EXISTS dialer_hour_grants_grantee_week_idx ON public.dialer_hour_grants USING btree (grantee_member_id, week_start);

CREATE INDEX IF NOT EXISTS dialer_hour_grants_granter_week_idx ON public.dialer_hour_grants USING btree (granter_member_id, week_start) WHERE (granter_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS dialer_hour_grants_rep_week_idx ON public.dialer_hour_grants USING btree (rep_id, week_start);

CREATE INDEX IF NOT EXISTS dialer_kpis_rep_day_idx ON public.dialer_kpis USING btree (rep_id, day DESC);

CREATE INDEX IF NOT EXISTS dialer_mode_alloc_member_week_idx ON public.dialer_mode_allocations USING btree (member_id, week_start);

CREATE INDEX IF NOT EXISTS dialer_queue_batch_idx ON public.dialer_queue USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS dialer_queue_dispatch_idx ON public.dialer_queue USING btree (rep_id, status, priority DESC, scheduled_for) WHERE (status = ANY (ARRAY['pending'::text, 'in_progress'::text]));

CREATE INDEX IF NOT EXISTS dialer_queue_events_queue_idx ON public.dialer_queue_events USING btree (queue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dialer_queue_events_rep_created_idx ON public.dialer_queue_events USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dialer_queue_events_rule_idx ON public.dialer_queue_events USING btree (workflow_rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS dialer_queue_mode_idx ON public.dialer_queue USING btree (rep_id, dialer_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS dialer_queue_owner_idx ON public.dialer_queue USING btree (rep_id, owner_member_id, status) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS dialer_queue_retry_idx ON public.dialer_queue USING btree (rep_id, status, next_retry_at) WHERE ((status = 'pending'::text) AND (next_retry_at IS NOT NULL));

CREATE INDEX IF NOT EXISTS dialer_queue_setter_idx ON public.dialer_queue USING btree (ai_salesperson_id, status) WHERE (ai_salesperson_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS dialer_rules_rep_active_idx ON public.dialer_workflow_rules USING btree (rep_id, is_active, priority DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS dialer_rules_rep_mode_idx ON public.dialer_workflow_rules USING btree (rep_id, dialer_mode, is_active);

CREATE INDEX IF NOT EXISTS dialer_rules_scope_idx ON public.dialer_workflow_rules USING btree (rep_id, scope, is_active);

CREATE INDEX IF NOT EXISTS dialer_rules_team_idx ON public.dialer_workflow_rules USING btree (rep_id, team_id, is_active) WHERE (team_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS dialer_shifts_member_idx ON public.dialer_shifts USING btree (member_id) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS dialer_shifts_rep_idx ON public.dialer_shifts USING btree (rep_id) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS dialer_transfer_day_idx ON public.dialer_transfer_availability USING btree (rep_id, day_of_week, accepts_live_transfer);

CREATE INDEX IF NOT EXISTS dialer_transfer_member_idx ON public.dialer_transfer_availability USING btree (rep_id, member_id, day_of_week, start_local);

CREATE UNIQUE INDEX dialer_transfer_unique_window ON public.dialer_transfer_availability USING btree (rep_id, member_id, day_of_week, start_local, end_local);

CREATE INDEX IF NOT EXISTS email_drafts_rep_pending_idx ON public.email_drafts USING btree (rep_id, status) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS email_drafts_thread_idx ON public.email_drafts USING btree (thread_id, status);

CREATE INDEX IF NOT EXISTS email_messages_thread_idx ON public.email_messages USING btree (thread_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS email_threads_owner_idx ON public.email_threads USING btree (owner_member_id) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS email_threads_rep_status_idx ON public.email_threads USING btree (rep_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS email_threads_snoozed_idx ON public.email_threads USING btree (snoozed_until) WHERE (snoozed_until IS NOT NULL);

CREATE INDEX IF NOT EXISTS feature_requests_rep_idx ON public.feature_requests USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fix_requests_rep_idx ON public.fix_requests USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS fix_requests_status_created_idx ON public.fix_requests USING btree (status, created_at DESC);

CREATE UNIQUE INDEX gmail_sync_state_member_unique ON public.gmail_sync_state USING btree (rep_id, member_id) WHERE (member_id IS NOT NULL);

CREATE UNIQUE INDEX gmail_sync_state_tenant_unique ON public.gmail_sync_state USING btree (rep_id) WHERE (member_id IS NULL);

CREATE INDEX IF NOT EXISTS google_tokens_email_idx ON public.google_tokens USING btree (lower(email));

CREATE INDEX IF NOT EXISTS google_tokens_member_idx ON public.google_tokens USING btree (member_id) WHERE (member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS google_tokens_rep_member_created_idx ON public.google_tokens USING btree (rep_id, member_id, created_at);

CREATE UNIQUE INDEX google_tokens_rep_member_email_unique ON public.google_tokens USING btree (rep_id, COALESCE(member_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(COALESCE(email, ''::text)));

CREATE INDEX IF NOT EXISTS idx_app_errors_occurred_at ON public.app_errors USING btree (occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_errors_rep_id ON public.app_errors USING btree (rep_id, occurred_at DESC) WHERE (rep_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_app_errors_source_severity ON public.app_errors USING btree (source, severity, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_window_start ON public.rate_limit_buckets USING btree (window_start);

CREATE INDEX IF NOT EXISTS idx_reps_brand ON public.reps USING btree (brand);

CREATE INDEX IF NOT EXISTS idx_sms_ai_sessions_lead ON public.sms_ai_sessions USING btree (lead_id);

CREATE INDEX IF NOT EXISTS idx_sms_ai_sessions_phone_rep ON public.sms_ai_sessions USING btree (phone, rep_id);

CREATE INDEX IF NOT EXISTS idx_sms_ai_sessions_rep_state ON public.sms_ai_sessions USING btree (rep_id, state);

CREATE INDEX IF NOT EXISTS idx_sms_messages_lead ON public.sms_messages USING btree (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_messages_rep_inbound ON public.sms_messages USING btree (rep_id, created_at DESC) WHERE (direction = 'inbound'::text);

CREATE INDEX IF NOT EXISTS idx_sms_messages_session ON public.sms_messages USING btree (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_calls_final_disposition ON public.voice_calls USING btree (final_disposition) WHERE (final_disposition IS NOT NULL);

CREATE INDEX IF NOT EXISTS import_batches_rep_idx ON public.import_batches USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS import_batches_status_idx ON public.import_batches USING btree (rep_id, status) WHERE (status = ANY (ARRAY['pending'::text, 'active'::text, 'paused'::text]));

CREATE INDEX IF NOT EXISTS invoices_customer_idx ON public.invoices USING btree (stripe_customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS invoices_member_idx ON public.invoices USING btree (member_id, created_at DESC) WHERE (member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS invoices_rep_idx ON public.invoices USING btree (rep_id, created_at DESC) WHERE (rep_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices USING btree (status);

CREATE INDEX IF NOT EXISTS job_runs_failed_idx ON public.job_runs USING btree (started_at DESC) WHERE (ok = false);

CREATE INDEX IF NOT EXISTS job_runs_job_idx ON public.job_runs USING btree (job, started_at DESC);

CREATE UNIQUE INDEX kpi_cards_member_metric_idx ON public.kpi_cards USING btree (rep_id, COALESCE(member_id, '00000000-0000-0000-0000-000000000000'::uuid), metric_key, period) WHERE (archived_at IS NULL);

CREATE INDEX IF NOT EXISTS kpi_cards_reminder_idx ON public.kpi_cards USING btree (rep_id, reminder_cadence) WHERE ((reminder_cadence <> 'none'::text) AND (archived_at IS NULL));

CREATE INDEX IF NOT EXISTS kpi_cards_rep_active_idx ON public.kpi_cards USING btree (rep_id) WHERE (archived_at IS NULL);

CREATE UNIQUE INDEX kpi_entries_card_day_idx ON public.kpi_entries USING btree (kpi_card_id, day);

CREATE INDEX IF NOT EXISTS kpi_entries_member_day_idx ON public.kpi_entries USING btree (rep_id, member_id, day DESC);

CREATE INDEX IF NOT EXISTS lead_activities_lead_idx ON public.lead_activities USING btree (lead_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS lead_activities_rep_idx ON public.lead_activities USING btree (rep_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS lead_activities_type_idx ON public.lead_activities USING btree (rep_id, type);

CREATE INDEX IF NOT EXISTS lead_campaign_events_campaign_idx ON public.lead_campaign_events USING btree (campaign_id);

CREATE INDEX IF NOT EXISTS lead_campaign_events_lead_idx ON public.lead_campaign_events USING btree (lead_id);

CREATE UNIQUE INDEX lead_campaigns_active_unique ON public.lead_campaigns USING btree (lead_id, ai_salesperson_id) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS lead_campaigns_lead_id_idx ON public.lead_campaigns USING btree (lead_id);

CREATE INDEX IF NOT EXISTS lead_campaigns_rep_id_idx ON public.lead_campaigns USING btree (rep_id);

CREATE INDEX IF NOT EXISTS lead_campaigns_status_due_idx ON public.lead_campaigns USING btree (status, next_action_at) WHERE (status = 'active'::text);

CREATE INDEX IF NOT EXISTS lead_events_lead_id ON public.lead_events USING btree (lead_id);

CREATE INDEX IF NOT EXISTS lead_notes_lead_id ON public.lead_notes USING btree (lead_id);

CREATE INDEX IF NOT EXISTS leads_crm_contact_id_idx ON public.leads USING btree (rep_id, crm_contact_id) WHERE (crm_contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_crm_contact_idx ON public.leads USING btree (rep_id, crm_source, crm_contact_id) WHERE (crm_contact_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_crm_object_idx ON public.leads USING btree (rep_id, crm_source, crm_object_id) WHERE (crm_object_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_deal_value_idx ON public.leads USING btree (rep_id, deal_value DESC) WHERE (deal_value IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_dnc_idx ON public.leads USING btree (rep_id, do_not_call) WHERE (do_not_call = true);

CREATE INDEX IF NOT EXISTS leads_import_batch_idx ON public.leads USING btree (import_batch_id) WHERE (import_batch_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_owner_member_idx ON public.leads USING btree (rep_id, owner_member_id, status);

CREATE INDEX IF NOT EXISTS leads_phone_idx ON public.leads USING btree (rep_id, phone) WHERE (phone IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_pipeline_stage_idx ON public.leads USING btree (rep_id, pipeline_id, pipeline_stage_id);

CREATE INDEX IF NOT EXISTS leads_rep_id_idx ON public.leads USING btree (rep_id);

CREATE INDEX IF NOT EXISTS leads_rep_lastcontact_idx ON public.leads USING btree (rep_id, last_contact);

CREATE INDEX IF NOT EXISTS leads_rep_phone_idx ON public.leads USING btree (rep_id, phone) WHERE (phone IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_rep_phone_setter_idx ON public.leads USING btree (rep_id, ai_salesperson_id) WHERE (ai_salesperson_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_rep_status_idx ON public.leads USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS leads_rep_updated_idx ON public.leads USING btree (rep_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS leads_snoozed_idx ON public.leads USING btree (rep_id, snoozed_until) WHERE (snoozed_until IS NOT NULL);

CREATE INDEX IF NOT EXISTS leads_team_idx ON public.leads USING btree (rep_id, team_id) WHERE (team_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS liability_agreements_member_idx ON public.liability_agreements USING btree (member_id);

CREATE INDEX IF NOT EXISTS liability_agreements_rep_idx ON public.liability_agreements USING btree (rep_id);

CREATE INDEX IF NOT EXISTS local_presence_area_code_idx ON public.local_presence_numbers USING btree (rep_id, area_code) WHERE (active = true);

CREATE UNIQUE INDEX local_presence_e164_idx ON public.local_presence_numbers USING btree (rep_id, e164);

CREATE INDEX IF NOT EXISTS local_presence_rep_idx ON public.local_presence_numbers USING btree (rep_id, active);

CREATE INDEX IF NOT EXISTS mcp_tokens_rep_idx ON public.mcp_tokens USING btree (rep_id, created_at DESC);

CREATE UNIQUE INDEX mcp_tokens_token_hash_key ON public.mcp_tokens USING btree (token_hash);

CREATE INDEX IF NOT EXISTS meetings_dialer_window_idx ON public.meetings USING btree (rep_id, scheduled_at) WHERE ((status = 'scheduled'::text) AND (confirmation_attempts = 0));

CREATE INDEX IF NOT EXISTS meetings_lead_idx ON public.meetings USING btree (lead_id) WHERE (lead_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS meetings_rep_scheduled_idx ON public.meetings USING btree (rep_id, scheduled_at);

CREATE INDEX IF NOT EXISTS meetings_rep_status_idx ON public.meetings USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS member_addons_active_idx ON public.member_addons USING btree (rep_id, addon_key) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS member_message_triage_to_idx ON public.member_message_triage USING btree (rep_id, to_member_id);

CREATE INDEX IF NOT EXISTS member_messages_from_idx ON public.member_messages USING btree (from_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS member_messages_reply_idx ON public.member_messages USING btree (replied_to_id);

CREATE INDEX IF NOT EXISTS member_messages_search_idx ON public.member_messages USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS member_messages_to_idx ON public.member_messages USING btree (to_member_id, deliver_at DESC);

CREATE INDEX IF NOT EXISTS members_phone_idx ON public.members USING btree (phone) WHERE (phone IS NOT NULL);

CREATE UNIQUE INDEX members_rep_email_idx ON public.members USING btree (rep_id, lower(email));

CREATE INDEX IF NOT EXISTS members_rep_role_idx ON public.members USING btree (rep_id, role);

CREATE UNIQUE INDEX members_rep_slug_idx ON public.members USING btree (rep_id, slug) WHERE (slug IS NOT NULL);

CREATE INDEX IF NOT EXISTS members_reset_token_idx ON public.members USING btree (password_reset_token) WHERE (password_reset_token IS NOT NULL);

CREATE INDEX IF NOT EXISTS members_telegram_chat_idx ON public.members USING btree (telegram_chat_id) WHERE (telegram_chat_id IS NOT NULL);

CREATE UNIQUE INDEX members_telegram_link_code_idx ON public.members USING btree (telegram_link_code) WHERE (telegram_link_code IS NOT NULL);

CREATE INDEX IF NOT EXISTS onboarding_tokens_rep_idx ON public.onboarding_tokens USING btree (rep_id);

CREATE INDEX IF NOT EXISTS onboarding_tokens_session_idx ON public.onboarding_tokens USING btree (stripe_session_id) WHERE (stripe_session_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS org_billing_week_open_idx ON public.org_billing_week USING btree (rep_id) WHERE (status = 'open'::text);

CREATE INDEX IF NOT EXISTS org_billing_week_rep_idx ON public.org_billing_week USING btree (rep_id, iso_week DESC);

CREATE INDEX IF NOT EXISTS outbound_messages_lead_idx ON public.outbound_messages USING btree (lead_id);

CREATE UNIQUE INDEX outbound_messages_rep_external_idx ON public.outbound_messages USING btree (rep_id, external_id) WHERE (external_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS outbound_messages_rep_idx ON public.outbound_messages USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payroll_deposits_rep_idx ON public.payroll_deposits USING btree (rep_id, deposited_on DESC);

CREATE INDEX IF NOT EXISTS pinnacle_agent_writes_agent_idx ON public.pinnacle_agent_writes USING btree (agent, wrote);

CREATE INDEX IF NOT EXISTS pinnacle_agent_writes_wrote_idx ON public.pinnacle_agent_writes USING btree (wrote);

CREATE INDEX IF NOT EXISTS pinnacle_airtable_records_base_idx ON public.pinnacle_airtable_records USING btree (base_id, table_name);

CREATE INDEX IF NOT EXISTS pinnacle_airtable_records_fetched_idx ON public.pinnacle_airtable_records USING btree (fetched_at);

CREATE INDEX IF NOT EXISTS pinnacle_airtable_snapshots_date_idx ON public.pinnacle_airtable_snapshots USING btree (snapshot_date DESC);

CREATE INDEX IF NOT EXISTS pinnacle_airtable_sync_runs_started_idx ON public.pinnacle_airtable_sync_runs USING btree (started_at DESC);

CREATE INDEX IF NOT EXISTS pinnacle_daily_rollup_base_date_idx ON public.pinnacle_daily_rollup USING btree (base_id, d DESC);

CREATE INDEX IF NOT EXISTS pinnacle_dim_rollup_agent_first ON public.pinnacle_dim_rollup USING btree (label, d) WHERE ((dim = 'agent'::text) AND (policies > 0));

CREATE INDEX IF NOT EXISTS pinnacle_dim_rollup_dim_d ON public.pinnacle_dim_rollup USING btree (dim, d);

CREATE INDEX IF NOT EXISTS pinnacle_policy_mv_base ON public.pinnacle_policy_mv USING btree (base_id);

CREATE INDEX IF NOT EXISTS pinnacle_policy_mv_eff ON public.pinnacle_policy_mv USING btree (eff_date);

CREATE UNIQUE INDEX pinnacle_policy_mv_pk ON public.pinnacle_policy_mv USING btree (base_id, table_name, record_id);

CREATE INDEX IF NOT EXISTS pinnacle_status_rollup_date_idx ON public.pinnacle_status_rollup USING btree (d DESC);

CREATE INDEX IF NOT EXISTS pinnacle_sync_table_runs_pending_idx ON public.pinnacle_sync_table_runs USING btree (completed_at) WHERE (swept_at IS NULL);

CREATE INDEX IF NOT EXISTS pipeline_items_owner_idx ON public.pipeline_items USING btree (owner_member_id) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS pipeline_items_rep_idx ON public.pipeline_items USING btree (rep_id, pipeline_id);

CREATE INDEX IF NOT EXISTS pipeline_items_stage_idx ON public.pipeline_items USING btree (pipeline_stage_id);

CREATE INDEX IF NOT EXISTS pipeline_items_updated_idx ON public.pipeline_items USING btree (rep_id, pipeline_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS pipeline_stages_pipeline_idx ON public.pipeline_stages USING btree (pipeline_id, "position");

CREATE INDEX IF NOT EXISTS pipeline_stages_rep_idx ON public.pipeline_stages USING btree (rep_id);

CREATE INDEX IF NOT EXISTS pipelines_owner_idx ON public.pipelines USING btree (rep_id, owner_member_id) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS pipelines_rep_idx ON public.pipelines USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pipelines_rep_kind_idx ON public.pipelines USING btree (rep_id, kind, created_at DESC);

CREATE INDEX IF NOT EXISTS plaud_actions_member_idx ON public.plaud_actions USING btree (target_member_id) WHERE (target_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS plaud_actions_note_idx ON public.plaud_actions USING btree (note_id);

CREATE INDEX IF NOT EXISTS plaud_actions_pending_queue_idx ON public.plaud_actions USING btree (rep_id, kind, created_at) WHERE (status = 'pending'::text);

CREATE INDEX IF NOT EXISTS plaud_actions_rep_status_idx ON public.plaud_actions USING btree (rep_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS plaud_agent_guidance_rep_active_idx ON public.plaud_agent_guidance USING btree (rep_id, active, scope);

CREATE INDEX IF NOT EXISTS plaud_agent_guidance_rep_created_idx ON public.plaud_agent_guidance USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS plaud_daily_plans_rep_created_idx ON public.plaud_daily_plans USING btree (rep_id, created_at DESC);

CREATE UNIQUE INDEX plaud_daily_plans_rep_date_idx ON public.plaud_daily_plans USING btree (rep_id, plan_date);

CREATE INDEX IF NOT EXISTS plaud_notes_owner_idx ON public.plaud_notes USING btree (owner_member_id) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS plaud_notes_rep_occurred_idx ON public.plaud_notes USING btree (rep_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS plaud_notes_search_idx ON public.plaud_notes USING gin (search_tsv);

CREATE INDEX IF NOT EXISTS plaud_notes_triage_queue_idx ON public.plaud_notes USING btree (rep_id, occurred_at) WHERE (triage_class IS NULL);

CREATE INDEX IF NOT EXISTS plaud_plan_feedback_plan_idx ON public.plaud_plan_feedback USING btree (plan_id);

CREATE INDEX IF NOT EXISTS plaud_plan_feedback_rep_created_idx ON public.plaud_plan_feedback USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS project_sections_project_idx ON public.project_sections USING btree (project_id, "position");

CREATE INDEX IF NOT EXISTS project_sections_rep_idx ON public.project_sections USING btree (rep_id);

CREATE INDEX IF NOT EXISTS project_task_steps_project_idx ON public.project_task_steps USING btree (project_id);

CREATE INDEX IF NOT EXISTS project_task_steps_rep_idx ON public.project_task_steps USING btree (rep_id);

CREATE INDEX IF NOT EXISTS project_task_steps_task_idx ON public.project_task_steps USING btree (task_id, "position");

CREATE INDEX IF NOT EXISTS project_tasks_assigned_idx ON public.project_tasks USING btree (assigned_to) WHERE (assigned_to IS NOT NULL);

CREATE INDEX IF NOT EXISTS project_tasks_project_idx ON public.project_tasks USING btree (project_id, "position");

CREATE INDEX IF NOT EXISTS project_tasks_rep_idx ON public.project_tasks USING btree (rep_id);

CREATE INDEX IF NOT EXISTS project_tasks_section_idx ON public.project_tasks USING btree (section_id, "position");

CREATE INDEX IF NOT EXISTS projects_owner_idx ON public.projects USING btree (owner_member_id) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS projects_rep_id_idx ON public.projects USING btree (rep_id);

CREATE INDEX IF NOT EXISTS projects_rep_status_idx ON public.projects USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS prospects_cart_idx ON public.prospects USING btree (cart_id) WHERE (cart_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS prospects_created_idx ON public.prospects USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS prospects_email_idx ON public.prospects USING btree (lower(email));

CREATE INDEX IF NOT EXISTS prospects_pipeline_stage_idx ON public.prospects USING btree (pipeline_stage, pipeline_position) WHERE (pipeline_stage IS NOT NULL);

CREATE INDEX IF NOT EXISTS prospects_selected_addons_idx ON public.prospects USING gin (selected_addons);

CREATE UNIQUE INDEX prospects_source_external_idx ON public.prospects USING btree (source, external_id) WHERE (external_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS prospects_status_idx ON public.prospects USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS recommendations_rep_status_idx ON public.recommendations USING btree (rep_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS rep_addons_active_idx ON public.rep_addons USING btree (rep_id, addon_key) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS rep_api_keys_hash_idx ON public.rep_api_keys USING btree (key_hash) WHERE (revoked_at IS NULL);

CREATE INDEX IF NOT EXISTS rep_api_keys_rep_idx ON public.rep_api_keys USING btree (rep_id) WHERE (revoked_at IS NULL);

CREATE INDEX IF NOT EXISTS rep_contacts_aliases_idx ON public.rep_contacts USING gin (aliases);

CREATE INDEX IF NOT EXISTS rep_contacts_member_idx ON public.rep_contacts USING btree (member_id) WHERE (member_id IS NOT NULL);

CREATE UNIQUE INDEX rep_contacts_rep_email_idx ON public.rep_contacts USING btree (rep_id, lower(email)) WHERE (email IS NOT NULL);

CREATE INDEX IF NOT EXISTS rep_contacts_rep_name_idx ON public.rep_contacts USING btree (rep_id, lower(display_name));

CREATE INDEX IF NOT EXISTS reps_billing_status_idx ON public.reps USING btree (billing_status);

CREATE INDEX IF NOT EXISTS reps_google_oauth_client_idx ON public.reps USING btree ((((settings -> 'google_oauth'::text) ->> 'client_id'::text))) WHERE (((settings -> 'google_oauth'::text) ->> 'client_id'::text) IS NOT NULL);

CREATE INDEX IF NOT EXISTS reps_host_aliases_gin ON public.reps USING gin (host_aliases);

CREATE INDEX IF NOT EXISTS reps_pending_activation_idx ON public.reps USING btree (billing_status) WHERE (billing_status = 'pending_activation'::text);

CREATE INDEX IF NOT EXISTS reps_prospect_idx ON public.reps USING btree (prospect_id) WHERE (prospect_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS reps_stripe_sub_idx ON public.reps USING btree (stripe_subscription_id) WHERE (stripe_subscription_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS reps_telegram_chat_id_idx ON public.reps USING btree (telegram_chat_id);

CREATE UNIQUE INDEX reps_telegram_link_code_idx ON public.reps USING btree (telegram_link_code);

CREATE INDEX IF NOT EXISTS roleplay_assignments_assignee_idx ON public.roleplay_assignments USING btree (assignee_member_id, status, due_at) WHERE (assignee_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS roleplay_assignments_rep_status_idx ON public.roleplay_assignments USING btree (rep_id, status, due_at);

CREATE INDEX IF NOT EXISTS roleplay_assignments_team_idx ON public.roleplay_assignments USING btree (team_id, status, due_at) WHERE (team_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS roleplay_daily_rep_day_idx ON public.roleplay_daily_activity USING btree (rep_id, day DESC);

CREATE INDEX IF NOT EXISTS roleplay_docs_owner_idx ON public.roleplay_training_docs USING btree (owner_member_id, is_active, updated_at DESC) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS roleplay_docs_rep_scope_idx ON public.roleplay_training_docs USING btree (rep_id, scope, is_active, updated_at DESC);

CREATE UNIQUE INDEX roleplay_quotas_one_per_scope_idx ON public.roleplay_quotas USING btree (rep_id, COALESCE((team_id)::text, 'account'::text), cadence) WHERE (is_active = true);

CREATE INDEX IF NOT EXISTS roleplay_reviews_reviewer_idx ON public.roleplay_reviews USING btree (reviewer_member_id, created_at DESC);

CREATE UNIQUE INDEX roleplay_reviews_session_reviewer_idx ON public.roleplay_reviews USING btree (session_id, reviewer_member_id);

CREATE INDEX IF NOT EXISTS roleplay_scenario_docs_doc_idx ON public.roleplay_scenario_docs USING btree (doc_id);

CREATE INDEX IF NOT EXISTS roleplay_scenarios_created_by_idx ON public.roleplay_scenarios USING btree (created_by_member_id);

CREATE INDEX IF NOT EXISTS roleplay_scenarios_rep_idx ON public.roleplay_scenarios USING btree (rep_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS roleplay_sessions_member_idx ON public.roleplay_sessions USING btree (member_id, started_at DESC);

CREATE UNIQUE INDEX roleplay_sessions_provider_call_id_key ON public.roleplay_sessions USING btree (provider_call_id);

CREATE INDEX IF NOT EXISTS roleplay_sessions_rep_idx ON public.roleplay_sessions USING btree (rep_id, started_at DESC);

CREATE INDEX IF NOT EXISTS roleplay_sessions_scenario_idx ON public.roleplay_sessions USING btree (scenario_id, started_at DESC);

CREATE INDEX IF NOT EXISTS roleplay_sessions_status_idx ON public.roleplay_sessions USING btree (rep_id, status, started_at DESC);

CREATE INDEX IF NOT EXISTS roleplay_turns_session_idx ON public.roleplay_turns USING btree (session_id, created_at);

CREATE UNIQUE INDEX roleplay_turns_session_index_idx ON public.roleplay_turns USING btree (session_id, turn_index);

CREATE INDEX IF NOT EXISTS room_deliveries_relay_idx ON public.room_deliveries USING btree (tg_chat_id, tg_message_id);

CREATE UNIQUE INDEX room_deliveries_unique ON public.room_deliveries USING btree (message_id, recipient_member_id);

CREATE INDEX IF NOT EXISTS room_msgs_parent_idx ON public.room_messages USING btree (parent_message_id);

CREATE INDEX IF NOT EXISTS room_msgs_rep_aud_idx ON public.room_messages USING btree (rep_id, audience, created_at DESC);

CREATE INDEX IF NOT EXISTS room_msgs_sender_idx ON public.room_messages USING btree (sender_member_id, created_at DESC);

CREATE INDEX IF NOT EXISTS room_todos_assigned_idx ON public.room_todos USING btree (assigned_to, status);

CREATE INDEX IF NOT EXISTS room_todos_rep_aud_idx ON public.room_todos USING btree (rep_id, audience, status, created_at DESC);

CREATE INDEX IF NOT EXISTS stripe_events_type_idx ON public.stripe_events USING btree (type, received_at DESC);

CREATE INDEX IF NOT EXISTS stripe_events_unprocessed_idx ON public.stripe_events USING btree (received_at) WHERE (processed_at IS NULL);

CREATE INDEX IF NOT EXISTS targets_owner_member_idx ON public.targets USING btree (rep_id, owner_member_id, period_start DESC) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS targets_rep_period_idx ON public.targets USING btree (rep_id, period_type, period_start DESC);

CREATE INDEX IF NOT EXISTS targets_rep_status_idx ON public.targets USING btree (rep_id, status);

CREATE INDEX IF NOT EXISTS targets_rep_visibility_idx ON public.targets USING btree (rep_id, visibility);

CREATE INDEX IF NOT EXISTS targets_team_idx ON public.targets USING btree (rep_id, team_id, period_start DESC) WHERE (team_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS team_members_member_id_idx ON public.team_members USING btree (member_id) WHERE (member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS team_members_member_idx ON public.team_members USING btree (member_id);

CREATE INDEX IF NOT EXISTS team_members_rep_idx ON public.team_members USING btree (rep_id);

CREATE INDEX IF NOT EXISTS team_members_team_idx ON public.team_members USING btree (team_id);

CREATE UNIQUE INDEX team_members_team_member_idx ON public.team_members USING btree (team_id, member_id) WHERE (member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS teams_manager_member_idx ON public.teams USING btree (manager_member_id) WHERE (manager_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS teams_rep_id_idx ON public.teams USING btree (rep_id);

CREATE INDEX IF NOT EXISTS usage_events_occurred_idx ON public.usage_events USING btree (rep_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS usage_events_period_idx ON public.usage_events USING btree (period_year_month, addon_key);

CREATE INDEX IF NOT EXISTS usage_events_rep_addon_week_idx ON public.usage_events USING btree (rep_id, addon_key, period_year_week) WHERE (period_year_week IS NOT NULL);

CREATE INDEX IF NOT EXISTS usage_events_rep_period_idx ON public.usage_events USING btree (rep_id, addon_key, period_year_month);

CREATE INDEX IF NOT EXISTS voice_calls_lead_idx ON public.voice_calls USING btree (lead_id) WHERE (lead_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS voice_calls_meeting_idx ON public.voice_calls USING btree (meeting_id) WHERE (meeting_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS voice_calls_mode_idx ON public.voice_calls USING btree (rep_id, dialer_mode, created_at DESC);

CREATE INDEX IF NOT EXISTS voice_calls_outcome_idx ON public.voice_calls USING btree (rep_id, outcome) WHERE (outcome IS NOT NULL);

CREATE INDEX IF NOT EXISTS voice_calls_owner_member_idx ON public.voice_calls USING btree (rep_id, owner_member_id) WHERE (owner_member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS voice_calls_rep_created_idx ON public.voice_calls USING btree (rep_id, created_at DESC);

CREATE INDEX IF NOT EXISTS voice_calls_setter_idx ON public.voice_calls USING btree (ai_salesperson_id, started_at DESC) WHERE (ai_salesperson_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS voice_memos_lead_idx ON public.voice_memos USING btree (lead_id) WHERE (lead_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS voice_memos_parent_idx ON public.voice_memos USING btree (parent_memo_id);

CREATE INDEX IF NOT EXISTS voice_memos_recipient_idx ON public.voice_memos USING btree (recipient_member_id, status);

CREATE INDEX IF NOT EXISTS voice_memos_relay_idx ON public.voice_memos USING btree (tg_relay_chat_id, tg_relay_message_id);

CREATE INDEX IF NOT EXISTS voice_memos_rep_status_idx ON public.voice_memos USING btree (rep_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS voice_memos_sender_idx ON public.voice_memos USING btree (sender_member_id, created_at DESC);

CREATE TRIGGER agent_billing_touch BEFORE UPDATE ON public.agent_billing FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER agent_billing_week_touch BEFORE UPDATE ON public.agent_billing_week FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER agent_member_memory_touch BEFORE UPDATE ON public.agent_member_memory FOR EACH ROW EXECUTE FUNCTION agent_member_memory_touch();

CREATE TRIGGER ai_salespeople_set_updated_at BEFORE UPDATE ON public.ai_salespeople FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER ai_salesperson_followups_set_updated_at BEFORE UPDATE ON public.ai_salesperson_followups FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER billing_change_requests_touch BEFORE UPDATE ON public.billing_change_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER billing_periods_set_updated_at BEFORE UPDATE ON public.billing_periods FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER brain_items_set_updated_at BEFORE UPDATE ON public.brain_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER carts_touch BEFORE UPDATE ON public.carts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER client_addons_set_updated_at BEFORE UPDATE ON public.client_addons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER client_integrations_set_updated_at BEFORE UPDATE ON public.client_integrations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER cxo_board_cards_touch BEFORE UPDATE ON public.cxo_board_cards FOR EACH ROW EXECUTE FUNCTION cxo_boards_touch();

CREATE TRIGGER cxo_boards_touch BEFORE UPDATE ON public.cxo_boards FOR EACH ROW EXECUTE FUNCTION cxo_boards_touch();

CREATE TRIGGER cxo_partners_search_trg BEFORE INSERT OR UPDATE ON public.cxo_partners FOR EACH ROW EXECUTE FUNCTION cxo_partners_search_text();

CREATE TRIGGER cxo_partners_touch_trg BEFORE UPDATE ON public.cxo_partners FOR EACH ROW EXECUTE FUNCTION cxo_partners_touch();

CREATE TRIGGER cxo_todos_touch BEFORE UPDATE ON public.cxo_todos FOR EACH ROW EXECUTE FUNCTION cxo_todos_touch();

CREATE TRIGGER deferred_items_set_updated_at BEFORE UPDATE ON public.deferred_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER dialer_hour_grants_touch BEFORE UPDATE ON public.dialer_hour_grants FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER dialer_kpis_set_updated_at BEFORE UPDATE ON public.dialer_kpis FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER dialer_mode_allocations_touch BEFORE UPDATE ON public.dialer_mode_allocations FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER dialer_queue_set_updated_at BEFORE UPDATE ON public.dialer_queue FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER dialer_shifts_touch BEFORE UPDATE ON public.dialer_shifts FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER dialer_transfer_availability_set_updated_at BEFORE UPDATE ON public.dialer_transfer_availability FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER dialer_workflow_rules_set_updated_at BEFORE UPDATE ON public.dialer_workflow_rules FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER google_tokens_set_updated_at BEFORE UPDATE ON public.google_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER import_batches_set_updated_at BEFORE UPDATE ON public.import_batches FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER invoices_touch BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER lead_campaigns_updated_at BEFORE UPDATE ON public.lead_campaigns FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER leads_set_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER meetings_set_updated_at BEFORE UPDATE ON public.meetings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER member_addons_set_updated_at BEFORE UPDATE ON public.member_addons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER member_messages_same_org BEFORE INSERT OR UPDATE OF rep_id, from_member_id, to_member_id ON public.member_messages FOR EACH ROW EXECUTE FUNCTION member_messages_same_org();

CREATE TRIGGER members_set_updated_at BEFORE UPDATE ON public.members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER org_billing_week_touch BEFORE UPDATE ON public.org_billing_week FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pinnacle_trim_fields BEFORE INSERT OR UPDATE OF fields ON public.pinnacle_airtable_records FOR EACH ROW EXECUTE FUNCTION pinnacle_trim_fields();

CREATE TRIGGER pipeline_items_set_updated_at BEFORE UPDATE ON public.pipeline_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pipeline_stages_set_updated_at BEFORE UPDATE ON public.pipeline_stages FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pipelines_set_updated_at BEFORE UPDATE ON public.pipelines FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER project_tasks_set_updated_at BEFORE UPDATE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION set_updated_at_projects();

CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION set_updated_at_projects();

CREATE TRIGGER prospects_set_updated_at BEFORE UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER prospects_stage_changed_touch BEFORE UPDATE ON public.prospects FOR EACH ROW EXECUTE FUNCTION bump_stage_changed_at();

CREATE TRIGGER rep_addons_set_updated_at BEFORE UPDATE ON public.rep_addons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER reps_hosts_unique BEFORE INSERT OR UPDATE OF slug, host_aliases ON public.reps FOR EACH ROW EXECUTE FUNCTION reps_hosts_unique();

CREATE TRIGGER reps_set_updated_at BEFORE UPDATE ON public.reps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roleplay_assignments_set_updated_at BEFORE UPDATE ON public.roleplay_assignments FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roleplay_quotas_set_updated_at BEFORE UPDATE ON public.roleplay_quotas FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roleplay_reviews_set_updated_at BEFORE UPDATE ON public.roleplay_reviews FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roleplay_scenarios_set_updated_at BEFORE UPDATE ON public.roleplay_scenarios FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roleplay_sessions_completed_rollup AFTER INSERT OR UPDATE OF status, completed_at ON public.roleplay_sessions FOR EACH ROW EXECUTE FUNCTION trg_roleplay_session_completed();

CREATE TRIGGER roleplay_sessions_set_updated_at BEFORE UPDATE ON public.roleplay_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER roleplay_training_docs_set_updated_at BEFORE UPDATE ON public.roleplay_training_docs FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER room_todos_set_updated_at BEFORE UPDATE ON public.room_todos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER targets_set_updated_at BEFORE UPDATE ON public.targets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER team_members_set_updated_at BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER voice_calls_set_updated_at BEFORE UPDATE ON public.voice_calls FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER voice_memos_set_updated_at BEFORE UPDATE ON public.voice_memos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

alter table public.addon_requests enable row level security;

alter table public.agent_actions enable row level security;

alter table public.agent_billing enable row level security;

alter table public.agent_billing_event enable row level security;

alter table public.agent_billing_week enable row level security;

alter table public.agent_history enable row level security;

alter table public.agent_member_memory enable row level security;

alter table public.agent_runs enable row level security;

alter table public.agent_usage enable row level security;

alter table public.ai_salespeople enable row level security;

alter table public.ai_salesperson_campaigns enable row level security;

alter table public.ai_salesperson_followups enable row level security;

alter table public.ai_wallet_ledger enable row level security;

alter table public.ai_wallets enable row level security;

alter table public.app_errors enable row level security;

alter table public.audit_events enable row level security;

alter table public.billing_audit enable row level security;

alter table public.billing_change_requests enable row level security;

alter table public.billing_periods enable row level security;

alter table public.brain_dumps enable row level security;

alter table public.brain_items enable row level security;

alter table public.call_logs enable row level security;

alter table public.carts enable row level security;

alter table public.ciao_chat_folders enable row level security;

alter table public.ciao_conversations enable row level security;

alter table public.client_addons enable row level security;

alter table public.client_events enable row level security;

alter table public.client_integrations enable row level security;

alter table public.commission_entries enable row level security;

alter table public.cxo_activity enable row level security;

alter table public.cxo_allowance_tiers enable row level security;

alter table public.cxo_assistant_activity enable row level security;

alter table public.cxo_behind_watch enable row level security;

alter table public.cxo_board_card_assignees enable row level security;

alter table public.cxo_board_cards enable row level security;

alter table public.cxo_board_checklist_items enable row level security;

alter table public.cxo_board_lists enable row level security;

alter table public.cxo_board_updates enable row level security;

alter table public.cxo_boards enable row level security;

alter table public.cxo_book_policies enable row level security;

alter table public.cxo_book_producers enable row level security;

alter table public.cxo_ciao_pending enable row level security;

alter table public.cxo_comp_rates enable row level security;

alter table public.cxo_comp_tiers enable row level security;

alter table public.cxo_daily_queue_items enable row level security;

alter table public.cxo_daily_queue_runs enable row level security;

alter table public.cxo_decisions enable row level security;

alter table public.cxo_due_digests enable row level security;

alter table public.cxo_due_reminders enable row level security;

alter table public.cxo_employee_kpis enable row level security;

alter table public.cxo_employee_time_off enable row level security;

alter table public.cxo_employees enable row level security;

alter table public.cxo_exec_assistants enable row level security;

alter table public.cxo_followup_notices enable row level security;

alter table public.cxo_goals enable row level security;

alter table public.cxo_ics_feeds enable row level security;

alter table public.cxo_kpi_actuals enable row level security;

alter table public.cxo_meeting_agendas enable row level security;

alter table public.cxo_meeting_series enable row level security;

alter table public.cxo_mira_approvals enable row level security;

alter table public.cxo_mira_audit enable row level security;

alter table public.cxo_mira_corrections enable row level security;

alter table public.cxo_native_push_tokens enable row level security;

alter table public.cxo_onboarding enable row level security;

alter table public.cxo_one_on_one_items enable row level security;

alter table public.cxo_one_on_ones enable row level security;

alter table public.cxo_partner_actions enable row level security;

alter table public.cxo_partners enable row level security;

alter table public.cxo_payout_periods enable row level security;

alter table public.cxo_plan_targets enable row level security;

alter table public.cxo_plan_unit_econ enable row level security;

alter table public.cxo_plan_uploads enable row level security;

alter table public.cxo_praise enable row level security;

alter table public.cxo_qbo_connections enable row level security;

alter table public.cxo_qbo_employees enable row level security;

alter table public.cxo_qbo_expense_monthly enable row level security;

alter table public.cxo_qbo_pnl_monthly enable row level security;

alter table public.cxo_qbo_revenue_breakdown enable row level security;

alter table public.cxo_qbo_time_activity enable row level security;

alter table public.cxo_report_jobs enable row level security;

alter table public.cxo_reviews enable row level security;

alter table public.cxo_slack_installs enable row level security;

alter table public.cxo_slack_threads enable row level security;

alter table public.cxo_todo_note_scans enable row level security;

alter table public.cxo_todos enable row level security;

alter table public.cxo_weekly_status enable row level security;

alter table public.cxo_whop_webhook_events enable row level security;

alter table public.deferred_items enable row level security;

alter table public.dialer_hour_grants enable row level security;

alter table public.dialer_kpis enable row level security;

alter table public.dialer_mode_allocations enable row level security;

alter table public.dialer_queue enable row level security;

alter table public.dialer_queue_events enable row level security;

alter table public.dialer_shifts enable row level security;

alter table public.dialer_transfer_availability enable row level security;

alter table public.dialer_workflow_rules enable row level security;

alter table public.email_drafts enable row level security;

alter table public.email_messages enable row level security;

alter table public.email_threads enable row level security;

alter table public.feature_requests enable row level security;

alter table public.fix_requests enable row level security;

alter table public.gmail_sync_state enable row level security;

alter table public.google_tokens enable row level security;

alter table public.import_batches enable row level security;

alter table public.invoices enable row level security;

alter table public.job_runs enable row level security;

alter table public.kpi_cards enable row level security;

alter table public.kpi_entries enable row level security;

alter table public.lead_activities enable row level security;

alter table public.lead_campaign_events enable row level security;

alter table public.lead_campaigns enable row level security;

alter table public.lead_events enable row level security;

alter table public.lead_notes enable row level security;

alter table public.leads enable row level security;

alter table public.liability_agreements enable row level security;

alter table public.local_presence_numbers enable row level security;

alter table public.mcp_tokens enable row level security;

alter table public.meeting_inbound_tokens enable row level security;

alter table public.meetings enable row level security;

alter table public.member_addons enable row level security;

alter table public.member_message_triage enable row level security;

alter table public.member_messages enable row level security;

alter table public.members enable row level security;

alter table public.onboarding_tokens enable row level security;

alter table public.org_billing_week enable row level security;

alter table public.outbound_messages enable row level security;

alter table public.payroll_deposits enable row level security;

alter table public.payroll_settings enable row level security;

alter table public.pinnacle_agent_dir enable row level security;

alter table public.pinnacle_agent_writes enable row level security;

alter table public.pinnacle_airtable_records enable row level security;

alter table public.pinnacle_airtable_snapshots enable row level security;

alter table public.pinnacle_airtable_sync_runs enable row level security;

alter table public.pinnacle_daily_rollup enable row level security;

alter table public.pinnacle_dim_rollup enable row level security;

alter table public.pinnacle_dim_rollup_month enable row level security;

alter table public.pinnacle_maintenance_log enable row level security;

alter table public.pinnacle_name_map enable row level security;

alter table public.pinnacle_people_rollup enable row level security;

alter table public.pinnacle_rollup_cache enable row level security;

alter table public.pinnacle_status_rollup enable row level security;

alter table public.pinnacle_sync_cursor enable row level security;

alter table public.pinnacle_sync_state enable row level security;

alter table public.pinnacle_sync_table_runs enable row level security;

alter table public.pipeline_items enable row level security;

alter table public.pipeline_stages enable row level security;

alter table public.pipelines enable row level security;

alter table public.plaud_actions enable row level security;

alter table public.plaud_agent_guidance enable row level security;

alter table public.plaud_daily_plans enable row level security;

alter table public.plaud_notes enable row level security;

alter table public.plaud_plan_feedback enable row level security;

alter table public.plaud_settings enable row level security;

alter table public.project_sections enable row level security;

alter table public.project_task_steps enable row level security;

alter table public.project_tasks enable row level security;

alter table public.projects enable row level security;

alter table public.prospects enable row level security;

alter table public.rate_limit_buckets enable row level security;

alter table public.recommendation_suppressions enable row level security;

alter table public.recommendations enable row level security;

alter table public.rep_addons enable row level security;

alter table public.rep_api_keys enable row level security;

alter table public.rep_contacts enable row level security;

alter table public.reps enable row level security;

alter table public.roleplay_assignments enable row level security;

alter table public.roleplay_daily_activity enable row level security;

alter table public.roleplay_quotas enable row level security;

alter table public.roleplay_reviews enable row level security;

alter table public.roleplay_scenario_docs enable row level security;

alter table public.roleplay_scenarios enable row level security;

alter table public.roleplay_sessions enable row level security;

alter table public.roleplay_training_docs enable row level security;

alter table public.roleplay_turns enable row level security;

alter table public.room_deliveries enable row level security;

alter table public.room_messages enable row level security;

alter table public.room_todos enable row level security;

alter table public.sms_ai_sessions enable row level security;

alter table public.sms_messages enable row level security;

alter table public.stripe_events enable row level security;

alter table public.targets enable row level security;

alter table public.team_members enable row level security;

alter table public.teams enable row level security;

alter table public.usage_events enable row level security;

alter table public.voice_calls enable row level security;

alter table public.voice_memos enable row level security;

alter table public.worker_health enable row level security;

create policy feature_requests_tenant_read on public.feature_requests as PERMISSIVE for SELECT to public using ((rep_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'rep_id'::text)));

create policy kpi_cards_tenant_read on public.kpi_cards as PERMISSIVE for SELECT to public using ((rep_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'rep_id'::text)));

create policy kpi_entries_tenant_read on public.kpi_entries as PERMISSIVE for SELECT to public using ((rep_id = ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'rep_id'::text)));
