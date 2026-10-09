/**
 * Partner constants and row types that both the server (lib/partners.ts)
 * and the browser (PartnersBoard, the public demo) use. Nothing here touches
 * Supabase or Google, so client bundles can import it.
 */

export const PARTNER_KINDS = ['executive', 'carrier', 'agency', 'board', 'vendor', 'producer', 'other'] as const
export type PartnerKind = (typeof PARTNER_KINDS)[number]

export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  executive: 'Executive partner',
  carrier: 'Carrier rep',
  agency: 'Agency principal',
  board: 'Board member',
  vendor: 'Vendor',
  producer: 'Key producer',
  other: 'Other',
}

/**
 * The directory's four types. The older kinds (agency, board, producer) stay
 * valid in the table and are filed under "Other".
 */
export const CONTACT_TYPES = ['executive', 'carrier', 'vendor', 'other'] as const
export type ContactType = (typeof CONTACT_TYPES)[number]
export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  executive: 'Executive partner',
  carrier: 'Carrier rep',
  vendor: 'Vendor',
  other: 'Other',
}
export const CONTACT_TYPE_PLURAL: Record<ContactType, string> = {
  executive: 'Executive partners',
  carrier: 'Carrier reps',
  vendor: 'Vendors',
  other: 'Other',
}
/** Which stored kinds a type filter covers. */
export function kindsForType(t: ContactType): PartnerKind[] {
  return t === 'other' ? ['other', 'agency', 'board', 'producer'] : [t]
}
export function typeOfKind(k: PartnerKind): ContactType {
  return k === 'executive' || k === 'carrier' || k === 'vendor' ? k : 'other'
}

/**
 * The two directory pages. Execs = executive partners (the ones on Suite CXO
 * first); Partners = carrier reps, vendors and everyone else.
 */
export type DirectoryScope = 'execs' | 'partners'
export const DIRECTORY_SCOPES: readonly DirectoryScope[] = ['execs', 'partners']
/** Types a scope's filter chips offer. */
export function typesForScope(scope: DirectoryScope): ContactType[] {
  return scope === 'execs' ? ['executive'] : CONTACT_TYPES.filter((t) => t !== 'executive')
}
/** Which page a contact lives on. */
export function scopeOfKind(kind: PartnerKind): DirectoryScope {
  return kind === 'executive' ? 'execs' : 'partners'
}

/** Executives on Suite CXO first, then other executives, then everyone else A–Z. */
export function directorySort(a: Partner, b: Partner): number {
  const ea = a.kind === 'executive' ? (a.on_platform ? 0 : 1) : 2
  const eb = b.kind === 'executive' ? (b.on_platform ? 0 : 1) : 2
  if (ea !== eb) return ea - eb
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' })
}

/** Soft format checks for the form and import: a hint, never a block. */
export function looksLikeEmail(v: string | null | undefined): boolean {
  const s = (v ?? '').trim()
  return !s || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)
}
export function looksLikePhone(v: string | null | undefined): boolean {
  const s = (v ?? '').trim()
  if (!s) return true
  const digits = s.replace(/\D/g, '')
  return /^[+\d\s().\-x/]+$/i.test(s) && digits.length >= 7 && digits.length <= 15
}
/** tel: href — digits and a leading +, extension as ;ext= */
export function telHref(phone: string, ext?: string | null): string {
  const base = phone.trim().replace(/[^\d+]/g, '')
  const x = (ext ?? '').replace(/\D/g, '')
  return `tel:${base}${x ? `;ext=${x}` : ''}`
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
  /** Executive partner who also has Suite CXO. */
  on_platform?: boolean
  email_secondary?: string | null
  email_support?: string | null
  phone_office?: string | null
  phone_office_ext?: string | null
  website?: string | null
  address?: string | null
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
  on_platform?: boolean
  email_secondary?: string | null
  email_support?: string | null
  phone_office?: string | null
  phone_office_ext?: string | null
  website?: string | null
  address?: string | null
}

/** What an import sends: rows already mapped to contact fields. */
export type ImportResult = { added: number; updated: number; skipped: number }

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

/** The Partners page "Today" view: who you meet today, what they sent, your notes. */
export type PartnersToday = {
  /** Meetings today that involve a partner, in start order. */
  meetings: Array<{ partner_id: string; partner_name: string; org: string | null; id: string; summary: string; start: string; end: string; htmlLink: string; conferenceLink?: string }>
  /** Recent mail from partners (newest first). null = no Gmail connected / readable. */
  inbound: Array<{ partner_id: string; partner_name: string; thread_id: string; subject: string | null; snippet: string; at: string | null }> | null
  /** Notes and open tasks across partners (newest first). */
  notes: Array<{ partner_id: string; partner_name: string; action: PartnerAction }>
  calendar_connected: boolean
  timezone: string
  /** The demo pins its clock; the live page leaves this unset (now). */
  now?: string
}
