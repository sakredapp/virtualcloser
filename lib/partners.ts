/**
 * Partners — the people an executive keeps close: carrier reps, agency
 * principals, board members, vendors, key producers.
 *
 * This module owns the two tables (cxo_partners, cxo_partner_actions), the
 * "next meeting with us" lookup against the exec's Google calendar, and the
 * one outbound email path every partner message goes through:
 *
 *   1. Gmail, from the exec's own connected Google account (sends as them)
 *   2. Amazon SES, "<Exec> via Suite CXO" with the exec as reply-to
 *   3. Neither configured → the message is saved as a draft and the UI says
 *      "Ready to send: connect your email on Integrations".
 *
 * The number-crunching for "send a report" lives in lib/mcp/data.ts
 * (composePartnerMessage) so Mira, the MCP server and the page all draft
 * from the same rollups.
 */

import { supabase } from '@/lib/supabase'
import {
  listConnectedGoogleAccounts,
  listUpcomingEvents,
  sendGmailMessage,
  type ConnectedAccount,
  type GoogleCalEvent,
} from '@/lib/google'
import { sendSesEmail, sesConfigured, sesFromAddress } from '@/lib/ses'

export {
  PARTNER_KINDS,
  PARTNER_KIND_LABEL,
  ACTION_KINDS,
  type PartnerKind,
  type Partner,
  type ActionKind,
  type ActionStatus,
  type PartnerAction,
  type PartnerInput,
} from '@/lib/partnersShared'
import { PARTNER_KINDS, type PartnerKind, type Partner, type ActionKind, type ActionStatus, type PartnerAction, type PartnerInput } from '@/lib/partnersShared'

export function asKind(v: unknown): PartnerKind {
  return (PARTNER_KINDS as readonly string[]).includes(String(v)) ? (v as PartnerKind) : 'other'
}

const clean = (v: unknown, max = 300): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s ? s : null
}

function sanitize(input: PartnerInput): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (input.name !== undefined) out.name = clean(input.name, 120) ?? ''
  if (input.org !== undefined) out.org = clean(input.org, 160)
  if (input.role !== undefined) out.role = clean(input.role, 160)
  if (input.kind !== undefined) out.kind = asKind(input.kind)
  if (input.email !== undefined) out.email = clean(input.email, 200)?.toLowerCase() ?? null
  if (input.phone !== undefined) out.phone = clean(input.phone, 40)
  if (input.notes !== undefined) out.notes = clean(input.notes, 4000)
  if (input.tags !== undefined) {
    out.tags = (Array.isArray(input.tags) ? input.tags : [])
      .map((t) => clean(t, 40))
      .filter((t): t is string => Boolean(t))
      .slice(0, 20)
  }
  if (input.owner_member_id !== undefined) out.owner_member_id = input.owner_member_id ?? null
  return out
}

// ── Partners CRUD ───────────────────────────────────────────────────────────

export async function listPartners(repId: string, opts: { kind?: PartnerKind; q?: string } = {}): Promise<Partner[]> {
  let query = supabase.from('cxo_partners').select('*').eq('rep_id', repId).order('name', { ascending: true })
  if (opts.kind) query = query.eq('kind', opts.kind)
  const { data, error } = await query
  if (error) throw error
  let rows = (data ?? []) as Partner[]
  const q = opts.q?.trim().toLowerCase()
  if (q) {
    rows = rows.filter((p) =>
      [p.name, p.org, p.role, p.email, ...(p.tags ?? [])].some((s) => (s ?? '').toLowerCase().includes(q)),
    )
  }
  return rows
}

export async function getPartner(repId: string, id: string): Promise<Partner | null> {
  const { data, error } = await supabase.from('cxo_partners').select('*').eq('rep_id', repId).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Partner | null) ?? null
}

export async function createPartner(repId: string, input: PartnerInput): Promise<Partner> {
  const row: Record<string, unknown> = { ...sanitize(input), rep_id: repId }
  if (!row.name) throw new Error('Partner name is required.')
  const { data, error } = await supabase.from('cxo_partners').insert(row).select('*').single()
  if (error) throw error
  return data as Partner
}

export async function updatePartner(repId: string, id: string, input: PartnerInput): Promise<Partner> {
  const patch = sanitize(input)
  if ('name' in patch && !patch.name) throw new Error('Partner name is required.')
  const { data, error } = await supabase.from('cxo_partners').update(patch).eq('rep_id', repId).eq('id', id).select('*').single()
  if (error) throw error
  return data as Partner
}

export async function deletePartner(repId: string, id: string): Promise<void> {
  const { error } = await supabase.from('cxo_partners').delete().eq('rep_id', repId).eq('id', id)
  if (error) throw error
}

/**
 * Find a partner by what an executive would say: "Dana", "Dana at Mutual",
 * "Mutual of Omaha". Exact name first, then name/org contains, then every
 * word matches somewhere. Several hits → ambiguous; the caller asks.
 */
export async function resolvePartner(
  repId: string,
  query: string,
): Promise<{ partner: Partner | null; candidates: Partner[] }> {
  const all = await listPartners(repId)
  const q = query.trim().toLowerCase()
  if (!q) return { partner: null, candidates: [] }
  const hay = (p: Partner) => `${p.name} ${p.org ?? ''} ${p.role ?? ''} ${p.email ?? ''}`.toLowerCase()
  let hits = all.filter((p) => p.name.toLowerCase() === q)
  if (hits.length === 0) hits = all.filter((p) => p.name.toLowerCase().includes(q))
  if (hits.length === 0) hits = all.filter((p) => hay(p).includes(q))
  if (hits.length === 0) {
    const words = q.split(/\s+/).filter((w) => w.length > 1 && !['at', 'from', 'the', 'of', 'and'].includes(w))
    if (words.length) hits = all.filter((p) => words.every((w) => hay(p).includes(w)))
  }
  if (hits.length === 1) return { partner: hits[0], candidates: hits }
  return { partner: null, candidates: hits.slice(0, 6) }
}

// ── Actions ─────────────────────────────────────────────────────────────────

export async function listPartnerActions(repId: string, partnerId: string, limit = 25): Promise<PartnerAction[]> {
  const { data, error } = await supabase
    .from('cxo_partner_actions')
    .select('*')
    .eq('rep_id', repId)
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as PartnerAction[]
}

export async function recordPartnerAction(input: {
  repId: string
  partnerId: string
  kind: ActionKind
  subject?: string | null
  body?: string | null
  status: ActionStatus
  sentTo?: string | null
  channel?: PartnerAction['channel']
  providerId?: string | null
  createdBy?: string | null
  dueAt?: string | null
}): Promise<PartnerAction> {
  const { data, error } = await supabase
    .from('cxo_partner_actions')
    .insert({
      rep_id: input.repId,
      partner_id: input.partnerId,
      kind: input.kind,
      subject: input.subject ?? null,
      body: input.body ?? null,
      status: input.status,
      sent_to: input.sentTo ?? null,
      channel: input.channel ?? null,
      provider_id: input.providerId ?? null,
      created_by: input.createdBy ?? null,
      sent_at: input.status === 'sent' ? new Date().toISOString() : null,
      due_at: input.dueAt ?? null,
    })
    .select('*')
    .single()
  if (error) throw error
  return data as PartnerAction
}

export async function markActionStatus(repId: string, actionId: string, status: ActionStatus): Promise<void> {
  const { error } = await supabase.from('cxo_partner_actions').update({ status }).eq('rep_id', repId).eq('id', actionId)
  if (error) throw error
}

export async function getPartnerAction(repId: string, actionId: string): Promise<PartnerAction | null> {
  const { data, error } = await supabase.from('cxo_partner_actions').select('*').eq('rep_id', repId).eq('id', actionId).maybeSingle()
  if (error) throw error
  return (data as PartnerAction | null) ?? null
}

export async function markActionSent(
  repId: string,
  actionId: string,
  sent: { channel: PartnerAction['channel']; providerId: string | null; sentTo: string; subject?: string; body?: string },
): Promise<PartnerAction> {
  const patch: Record<string, unknown> = { status: 'sent', channel: sent.channel, provider_id: sent.providerId, sent_to: sent.sentTo, sent_at: new Date().toISOString() }
  if (sent.subject !== undefined) patch.subject = sent.subject
  if (sent.body !== undefined) patch.body = sent.body
  const { data, error } = await supabase.from('cxo_partner_actions').update(patch).eq('rep_id', repId).eq('id', actionId).select('*').single()
  if (error) throw error
  return data as PartnerAction
}

// ── Next meeting with us ────────────────────────────────────────────────────

export type PartnerMeeting = {
  id: string
  summary: string
  start: string
  end: string
  htmlLink: string
  conferenceLink?: string
  matched_by: 'email' | 'name' | 'org'
}

function tokensOf(s: string | null | undefined): string[] {
  return (s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !['the', 'and', 'inc', 'llc', 'group', 'life', 'financial'].includes(w))
}

function matchEvent(p: Partner, e: GoogleCalEvent): PartnerMeeting['matched_by'] | null {
  const email = p.email?.toLowerCase()
  if (email && (e.attendees ?? []).some((a) => a.email?.toLowerCase() === email)) return 'email'
  const title = (e.summary ?? '').toLowerCase()
  const nameWords = tokensOf(p.name)
  if (nameWords.length && nameWords.every((w) => title.includes(w))) return 'name'
  const orgWords = tokensOf(p.org)
  if (orgWords.length && orgWords.every((w) => title.includes(w))) return 'org'
  return null
}

/**
 * Upcoming calendar events in the next `days` that involve a partner —
 * matched by attendee email first, then the partner's name or org in the
 * title. Returns null when no Google calendar is connected.
 */
export async function loadPartnerCalendar(
  repId: string,
  memberId: string | null,
  opts: { days?: number; timeZone?: string } = {},
): Promise<GoogleCalEvent[] | null> {
  const days = Math.min(Math.max(opts.days ?? 60, 1), 120)
  try {
    return await listUpcomingEvents(repId, {
      memberId,
      toIso: new Date(Date.now() + days * 86400_000).toISOString(),
      maxResults: 250,
      timeZone: opts.timeZone,
    })
  } catch {
    return null
  }
}

export function meetingsForPartner(p: Partner, events: GoogleCalEvent[] | null, limit = 3): PartnerMeeting[] {
  if (!events) return []
  const out: PartnerMeeting[] = []
  for (const e of events) {
    const by = matchEvent(p, e)
    if (!by) continue
    out.push({ id: e.id, summary: e.summary, start: e.start, end: e.end, htmlLink: e.htmlLink, conferenceLink: e.conferenceLink, matched_by: by })
    if (out.length >= limit) break
  }
  return out
}

// ── Sending ─────────────────────────────────────────────────────────────────

export type SendOutcome =
  | { sent: true; channel: 'gmail' | 'ses'; providerId: string | null; from: string }
  | { sent: false; channel: 'none'; reason: string; gap: 'no_email_on_partner' | 'not_connected' | 'provider_error' }

export const CONNECT_EMAIL_HINT = 'Ready to send: connect your Google account on the Calendar page and I will send as you.'

/**
 * Which connected Google account an executive sends from. Their own
 * connection(s) first, then the workspace account. `prefer` picks one by
 * email when a person has several (e.g. "send it from my pinnacle address").
 */
export async function pickSenderAccount(
  repId: string,
  memberId: string | null,
  prefer?: string | null,
): Promise<{ account: ConnectedAccount | null; choices: ConnectedAccount[] }> {
  const all = await listConnectedGoogleAccounts(repId).catch(() => [] as ConnectedAccount[])
  const mine = all.filter((a) => a.memberId === memberId)
  const choices = mine.length ? mine : all
  if (prefer) {
    const hit = all.find((a) => (a.email ?? '').toLowerCase() === prefer.toLowerCase())
    if (hit) return { account: hit, choices }
  }
  return { account: choices[0] ?? null, choices }
}

/**
 * Send one message to a partner as the executive. Gmail (their own account)
 * first; Amazon SES with them as reply-to second; otherwise report the gap so
 * the caller saves a draft.
 */
export async function deliverPartnerEmail(input: {
  repId: string
  memberId: string | null
  senderName: string
  senderEmail: string | null
  to: string | null
  subject: string
  body: string
  /** Send from this connected Google account (email) when the exec has several. */
  fromAccount?: string | null
}): Promise<SendOutcome> {
  const to = input.to?.trim()
  if (!to) return { sent: false, channel: 'none', reason: 'This partner has no email address on file.', gap: 'no_email_on_partner' }

  // 1. The exec's own Gmail.
  const { account } = await pickSenderAccount(input.repId, input.memberId, input.fromAccount)
  let gmailError: string | null = null
  if (account) {
    const gmail = await sendGmailMessage(input.repId, {
      to,
      subject: input.subject,
      body: input.body,
      fromName: input.senderName,
      memberId: account.memberId,
      accountId: account.accountId,
    }).catch((err: unknown) => ({ ok: false as const, error: err instanceof Error ? err.message : 'gmail_failed' }))
    if (gmail.ok) return { sent: true, channel: 'gmail', providerId: gmail.messageId ?? null, from: account.email ?? input.senderEmail ?? 'your Google account' }
    gmailError = gmail.error ?? 'gmail_failed'
  }

  // 2. Amazon SES, reply-to the exec.
  if (sesConfigured()) {
    const from = sesFromAddress(input.senderName)
    const res = await sendSesEmail({ from, to, subject: input.subject, text: input.body, replyTo: input.senderEmail })
    if (res.ok) return { sent: true, channel: 'ses', providerId: res.messageId ?? null, from }
    return { sent: false, channel: 'none', reason: res.error ?? 'The mail service rejected the message.', gap: 'provider_error' }
  }

  if (!account || gmailError === 'google_not_connected' || gmailError === 'gmail_scope_missing') {
    return { sent: false, channel: 'none', reason: CONNECT_EMAIL_HINT, gap: 'not_connected' }
  }
  return { sent: false, channel: 'none', reason: `Gmail could not send (${gmailError}).`, gap: 'provider_error' }
}

export type SenderStatus = {
  ready: boolean
  via: 'gmail' | 'ses' | null
  /** The address mail goes out from, for the composer's "From" line. */
  from: string | null
  /** Every Google account the exec could send from. */
  accounts: Array<{ email: string | null; label: string }>
}

/** What the UI shows on the Actions menu before anyone tries to send. */
export async function senderStatus(repId: string, memberId: string | null, senderName = 'Suite CXO'): Promise<SenderStatus> {
  const { account, choices } = await pickSenderAccount(repId, memberId)
  const accounts = choices.map((a) => ({ email: a.email, label: a.label }))
  if (account) return { ready: true, via: 'gmail', from: account.email, accounts }
  if (sesConfigured()) return { ready: true, via: 'ses', from: sesFromAddress(senderName), accounts }
  return { ready: false, via: null, from: null, accounts }
}
