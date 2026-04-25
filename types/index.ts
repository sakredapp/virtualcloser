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
  run_type: 'morning_scan' | 'dormant_check' | 'hot_pulse' | 'midday_pulse'
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
