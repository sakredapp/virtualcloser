/**
 * Partner constants and row types that both the server (lib/partners.ts)
 * and the browser (PartnersBoard, the public demo) use. Nothing here touches
 * Supabase or Google, so client bundles can import it.
 */

export const PARTNER_KINDS = ['carrier', 'agency', 'board', 'vendor', 'producer', 'other'] as const
export type PartnerKind = (typeof PARTNER_KINDS)[number]

export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  carrier: 'Carrier',
  agency: 'Agency principal',
  board: 'Board member',
  vendor: 'Vendor',
  producer: 'Key producer',
  other: 'Other',
}

export type Partner = {
  id: string
  rep_id: string
  name: string
  org: string | null
  role: string | null
  kind: PartnerKind
  email: string | null
  phone: string | null
  notes: string | null
  tags: string[]
  owner_member_id: string | null
  created_at: string
  updated_at: string
}

export const ACTION_KINDS = ['note', 'email', 'report', 'task', 'meeting'] as const
export type ActionKind = (typeof ACTION_KINDS)[number]
export type ActionStatus = 'draft' | 'sent' | 'done'

export type PartnerAction = {
  id: string
  partner_id: string
  rep_id: string
  kind: ActionKind
  subject: string | null
  body: string | null
  status: ActionStatus
  sent_to: string | null
  channel: 'gmail' | 'ses' | 'none' | null
  /** Gmail message id once sent (or the SES message id). */
  provider_id: string | null
  /** Gmail draft id while status=draft and the draft lives in their Gmail. */
  draft_id: string | null
  /** Which connected Google account (email) the draft/send is from. */
  from_account: string | null
  /** Gmail thread id, for replies. */
  thread_id: string | null
  created_by: string | null
  created_at: string
  sent_at: string | null
  due_at: string | null
}

export type PartnerInput = {
  name: string
  org?: string | null
  role?: string | null
  kind?: PartnerKind
  email?: string | null
  phone?: string | null
  notes?: string | null
  tags?: string[]
  owner_member_id?: string | null
}

export const REPORT_LINES = ['Health', 'Life', 'Annuity'] as const
export type ReportLine = (typeof REPORT_LINES)[number]
export const REPORT_WINDOWS: ReadonlyArray<{ key: '3m' | '6m' | '12m' | 'ytd'; label: string }> = [
  { key: '3m', label: 'Last 3 months' },
  { key: '6m', label: 'Last 6 months' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'ytd', label: 'Year to date' },
]

/** Shown everywhere Partners would be, while its tables are not set up yet. */
export const PARTNERS_NOT_READY = 'Partners will appear here once setup finishes.'
