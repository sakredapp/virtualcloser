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
