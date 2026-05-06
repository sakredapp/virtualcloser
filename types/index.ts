export type LeadStatus = 'hot' | 'warm' | 'cold' | 'dormant'

export type Lead = {
  id: string
  rep_id: string
  name: string
  email: string | null
  company: string | null
  status: LeadStatus
  last_contact: string | null
  notes: string | null
  source: string | null
  external_id: string | null
  deal_value: number | null
  deal_currency: string | null
  snoozed_until: string | null
  owner_member_id: string | null
  team_id: string | null
  crm_contact_id: string | null
  created_at: string
  updated_at: string
}

export type AgentAction = {
  id: string
  rep_id: string
  lead_id: string | null
  action_type: 'email_draft' | 'classification' | 'alert' | 'dormant_flag'
  content: string
  status: 'pending' | 'sent' | 'dismissed'
  created_at: string
}

export type AgentRun = {
  id: string
  rep_id: string
  run_type: 'morning_scan' | 'dormant_check' | 'hot_pulse' | 'midday_pulse' | 'coach'
  leads_processed: number
  actions_created: number
  status: 'success' | 'error'
  error: string | null
  created_at: string
}

export type EmailDraft = {
  subject: string
  body: string
}

export type LeadClassification = {
  status: LeadStatus
  reason: string
}

export type BrainItemType = 'task' | 'goal' | 'idea' | 'plan' | 'note'
export type BrainItemHorizon = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'none'
export type BrainItemStatus = 'open' | 'done' | 'dismissed'

export type BrainDump = {
  id: string
  rep_id: string
  raw_text: string
  summary: string | null
  source: 'mic' | 'manual' | 'import'
  created_at: string
}

export type BrainItem = {
  id: string
  rep_id: string
  brain_dump_id: string | null
  lead_id: string | null
  item_type: BrainItemType
  content: string
  priority: 'low' | 'normal' | 'high'
  horizon: BrainItemHorizon | null
  due_date: string | null
  status: BrainItemStatus
  created_at: string
  updated_at: string
}

export type CallOutcome =
  | 'positive'
  | 'neutral'
  | 'negative'
  | 'no_answer'
  | 'voicemail'
  | 'booked'
  | 'closed_won'
  | 'closed_lost'

export type CallLog = {
  id: string
  rep_id: string
  lead_id: string | null
  contact_name: string
  summary: string
  outcome: CallOutcome | null
  next_step: string | null
  duration_minutes: number | null
  occurred_at: string
  created_at: string
  commission_amount?: number | null
  commission_currency?: string | null
}

export type TargetPeriod = 'day' | 'week' | 'month' | 'quarter' | 'year'
export type TargetMetric =
  | 'calls'
  | 'conversations'
  | 'meetings_booked'
  | 'deals_closed'
  | 'revenue'
  | 'custom'
export type TargetStatus = 'active' | 'hit' | 'missed' | 'archived'

export type TargetScope = 'personal' | 'team' | 'account'
export type TargetVisibility = 'all' | 'managers' | 'owners'

export type Target = {
  id: string
  rep_id: string
  period_type: TargetPeriod
  period_start: string // YYYY-MM-DD
  metric: TargetMetric
  target_value: number
  current_value: number
  notes: string | null
  status: TargetStatus
  scope: TargetScope
  visibility: TargetVisibility
  owner_member_id: string | null
  team_id: string | null
  created_at: string
  updated_at: string
}

// ── Members + permissions ────────────────────────────────────────────────
export type MemberRole = 'owner' | 'admin' | 'manager' | 'rep' | 'observer'

export type Member = {
  id: string
  rep_id: string
  email: string
  display_name: string
  slug: string | null
  role: MemberRole
  password_hash: string | null
  is_active: boolean
  telegram_chat_id: string | null
  telegram_link_code: string | null
  timezone: string | null
  last_login_at: string | null
  invited_by: string | null
  invited_at: string | null
  accepted_at: string | null
  settings: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type AuditEvent = {
  id: string
  rep_id: string
  member_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  diff: Record<string, unknown> | null
  ip: string | null
  user_agent: string | null
  created_at: string
}

// ── Appointment Setter ────────────────────────────────────────────────────

/**
 * @deprecated Single-config legacy shape. Replaced by the multi-setter
 * `AiSalesperson` model below. Kept for back-compat with `client_integrations`
 * row key='appointment_setter_config'; all new code should read/write
 * AiSalesperson rows. The legacy row is migrated lazily into the rep's
 * default salesperson by `getOrCreateDefaultSalesperson()` in lib/ai-salesperson.ts.
 */
export type AppointmentSetterConfig = {
  active_days: number[]
  start_hour: number
  end_hour: number
  timezone: string
  daily_appt_target: number
  max_daily_dials: number
  leads_per_hour: number
  leads_per_day: number
  max_daily_hours: number
  preferred_call_windows: string
  booking_calendar_url: string
  ghl_calendar_id: string
  booking_rep_name: string
  opener: string
  qualification_questions: string
  objections: string
  ai_name: string
  role_title: string
  role_mission: string
  disqualify_rules: string
  enabled: boolean
}

// ── AI Salesperson (multi-setter model) ───────────────────────────────────
// Mirrors the JSONB shapes in supabase/ai_salesperson_migration.sql.
// Each rep_id can own N salespeople; legacy AppointmentSetterConfig is
// the seed for the rep's first ("default") salesperson.

export type AiSalespersonStatus = 'draft' | 'active' | 'paused' | 'archived'

export type AiSalespersonProductIntent = {
  name?: string
  explanation?: string
  audience?: string
  opt_in_reason?: string
  talking_points?: string
  avoid?: string
  compliance_notes?: string
}

export type AiSalespersonVoicePersona = {
  ai_name?: string
  role_title?: string
  tone?: string           // e.g. 'friendly_professional' | 'direct' | 'consultative'
  voice_id?: string       // provider voice id (Vapi/RevRing)
  opener?: string
}

export type AiSalespersonCallScript = {
  opening?: string
  confirmation?: string
  reason?: string
  qualifying?: string[]   // questions in order
  pitch?: string
  close?: string
  compliance?: string
  escalation_rules?: string
  record_calls?: boolean
  recording_disclosure?: string  // injected into opener when record_calls is true
}

export type AiSalespersonSmsScripts = {
  first?: string
  second?: string
  followup?: string
  confirm?: string
  missed?: string
  reschedule?: string
  no_response?: string
  stop_text?: string
}

export type AiSalespersonEmailTemplates = {
  initial?: string
  followup?: string
  confirmation?: string
  missed?: string
  reschedule?: string
  longterm?: string
}

export type AiSalespersonObjection = {
  trigger: string
  response: string
}

export type AiSalespersonSchedule = {
  active_days?: number[]            // 0=Sun..6=Sat
  start_hour?: number               // 0-23
  end_hour?: number                 // 0-23
  timezone?: string
  max_calls_per_day?: number
  max_attempts_per_lead?: number
  retry_delay_min?: number
  leads_per_hour?: number
  leads_per_day?: number
  max_daily_hours?: number
  quiet_hours?: string              // e.g. '21:00-08:00'
}

export type AiSalespersonCalendar = {
  provider?: 'ghl' | 'google' | 'cal' | 'manual'
  calendar_id?: string
  calendar_url?: string
  buffer_min?: number
  max_appts_per_day?: number
  confirmation_sms?: boolean
  confirmation_email?: boolean
  reminder_sms?: boolean
  reminder_email?: boolean
}

export type AiSalespersonCrmPush = {
  // GHL is the default and is ALWAYS-ON when an appointment is booked
  // (locked decision #1). The fields here describe the resolved target;
  // when target_pipeline_id/target_stage_id is null the UI shows
  // "Connect a GHL calendar to enable CRM push."
  provider?: 'ghl' | 'hubspot' | 'pipedrive' | 'salesforce' | 'custom_webhook'
  target_pipeline_id?: string | null
  target_pipeline_name?: string | null
  target_stage_id?: string | null
  target_stage_name?: string | null
  assigned_user?: string | null
  webhook_url?: string | null       // for provider='custom_webhook'
  last_resolved_at?: string | null
}

export type AiSalesperson = {
  id: string
  rep_id: string
  name: string
  status: AiSalespersonStatus
  product_category: string | null
  assigned_member_id: string | null
  appointment_type: string | null
  appointment_duration_min: number | null
  product_intent: AiSalespersonProductIntent
  voice_persona: AiSalespersonVoicePersona
  call_script: AiSalespersonCallScript
  sms_scripts: AiSalespersonSmsScripts
  email_templates: AiSalespersonEmailTemplates
  objection_responses: AiSalespersonObjection[]
  schedule: AiSalespersonSchedule
  calendar: AiSalespersonCalendar
  crm_push: AiSalespersonCrmPush
  phone_number: string | null
  phone_provider: 'revring' | 'twilio' | null
  created_by_member_id: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type AiSalespersonInput = Partial<Omit<AiSalesperson, 'id' | 'rep_id' | 'created_at' | 'updated_at' | 'archived_at'>> & {
  name: string
}

export type AiSalespersonFollowup = {
  id: string
  rep_id: string
  ai_salesperson_id: string
  lead_id: string | null
  queue_id: string | null
  source_call_id: string | null
  due_at: string
  channel: 'call' | 'sms' | 'email'
  reason: string | null
  status: 'pending' | 'queued' | 'done' | 'cancelled'
  created_at: string
  updated_at: string
}

export type AiSalespersonCampaign = {
  id: string
  rep_id: string
  ai_salesperson_id: string
  name: string
  source: string | null
  opt_in_confirmed: boolean
  notes: string | null
  created_by_member_id: string | null
  created_at: string
}

export type AiSalespersonLeadConflict = {
  phone: string
  existing_setter_id: string
  existing_setter_name: string
  existing_lead_id: string | null
}
