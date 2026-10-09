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
  createGmailDraft,
  sendGmailDraft,
  deleteGmailDraft,
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
import { PARTNER_KINDS, directorySort, kindsForType, type ContactType, type DirectoryScope, type ImportResult, type PartnerKind, type Partner, type ActionKind, type ActionStatus, type PartnerAction, type PartnerInput } from '@/lib/partnersShared'

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
  if (input.email_secondary !== undefined) out.email_secondary = clean(input.email_secondary, 200)?.toLowerCase() ?? null
  if (input.email_support !== undefined) out.email_support = clean(input.email_support, 200)?.toLowerCase() ?? null
  if (input.phone_office !== undefined) out.phone_office = clean(input.phone_office, 40)
  if (input.phone_office_ext !== undefined) out.phone_office_ext = clean(input.phone_office_ext, 12)
  if (input.website !== undefined) out.website = clean(input.website, 300)
  if (input.address !== undefined) out.address = clean(input.address, 400)
  if (input.on_platform !== undefined) out.on_platform = input.on_platform === true
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

/** A Supabase/PostgREST error that means the table itself is missing (migration not run). */
export function isMissingTable(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  if (!e) return false
  if (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST204') return true
  return /does not exist|could not find the table|schema cache/i.test(e.message ?? '')
}

let readyCache: { ok: boolean; at: number } | null = null
/**
 * Are the Partners tables there? True is remembered for good; false is
 * re-checked after a minute so the page opens by itself once the migration
 * runs. A probe that fails for another reason (network) counts as ready, so
 * the real error surfaces where it happens instead of a misleading message.
 */
export async function partnersReady(): Promise<boolean> {
  if (readyCache && (readyCache.ok || Date.now() - readyCache.at < 60_000)) return readyCache.ok
  const probe = await Promise.race([
    Promise.all([
      // A real GET, not a HEAD: on a missing table a HEAD request comes back
      // 404 with no body, so the error carries no code or message and the
      // probe wrongly read "ready" (production 10-09: PGRST205 500s).
      supabase.from('cxo_partners').select('id').limit(1),
      supabase.from('cxo_partner_actions').select('id').limit(1),
    ]).then(([a, b]) => !(isMissingTable(a.error) || isMissingTable(b.error) || (a.error && a.status === 404) || (b.error && b.status === 404))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]).catch(() => false)
  readyCache = { ok: probe, at: Date.now() }
  return probe
}

/** Columns the directory carries, minus the internal search blob. */
const PARTNER_COLS = 'id, rep_id, name, org, role, kind, email, phone, notes, tags, owner_member_id, created_at, updated_at, on_platform, email_secondary, email_support, phone_office, phone_office_ext, website, address'

/**
 * The org's contacts. q is matched server-side: every word must appear
 * (ILIKE) in search_text, which holds name, company, role, every email, every
 * phone (as typed and digits only) and tags. A phone-looking word is matched
 * on its digits, so "402-555" finds "(402) 555-0141".
 * Sorted executive partners first, then A–Z.
 */
export async function listPartners(repId: string, opts: { kind?: PartnerKind; type?: ContactType; scope?: DirectoryScope; q?: string; limit?: number } = {}): Promise<Partner[]> {
  let query = supabase.from('cxo_partners').select(PARTNER_COLS).eq('rep_id', repId).order('name', { ascending: true }).limit(Math.min(Math.max(opts.limit ?? 2000, 1), 5000))
  if (opts.kind) query = query.eq('kind', opts.kind)
  else if (opts.type) query = query.in('kind', kindsForType(opts.type))
  // The Execs page holds executive partners; the Partners page everyone else.
  if (!opts.kind && opts.scope === 'execs') query = query.eq('kind', 'executive')
  else if (!opts.kind && opts.scope === 'partners') query = query.neq('kind', 'executive')
  for (const word of searchWords(opts.q)) query = query.ilike('search_text', `%${word}%`)
  const { data, error } = await query
  if (error) {
    // Tables not there yet: an empty list, never a 500.
    if (isMissingTable(error)) {
      readyCache = { ok: false, at: Date.now() }
      return []
    }
    throw error
  }
  return ((data ?? []) as unknown as Partner[]).sort(directorySort)
}

/** Lowercased search words, LIKE wildcards escaped; phone-looking words become digits. */
export function searchWords(q: string | undefined): string[] {
  const raw = (q ?? '').trim().toLowerCase().slice(0, 120)
  if (!raw) return []
  return raw
    .split(/\s+/)
    .map((w) => (/^[+\d().\-]+$/.test(w) && /\d/.test(w) ? w.replace(/\D/g, '') : w))
    .filter(Boolean)
    .slice(0, 6)
    .map((w) => w.replace(/[\\%_]/g, (c) => `\\${c}`))
}

/**
 * A user-driven import (CSV or vCard the exec uploaded). Dedupe: email
 * first (primary, secondary or support), then name + company. A match only
 * fills or changes the fields the file has; nothing in the file is
 * ever blanked out. Rows without a name are skipped.
 */
export async function importPartners(repId: string, rows: PartnerInput[], ownerMemberId: string | null): Promise<ImportResult> {
  const existing = await listPartners(repId, { limit: 5000 })
  const byEmail = new Map<string, Partner>()
  const byNameOrg = new Map<string, Partner>()
  const nameKey = (name: string, org: string | null | undefined) => `${name.trim().toLowerCase()}|${(org ?? '').trim().toLowerCase()}`
  const index = (p: Partner) => {
    for (const e of [p.email, p.email_secondary, p.email_support]) if (e) byEmail.set(e.toLowerCase(), p)
    byNameOrg.set(nameKey(p.name, p.org), p)
  }
  existing.forEach(index)
  const result: ImportResult = { added: 0, updated: 0, skipped: 0 }
  for (const input of rows.slice(0, 5000)) {
    const clean = sanitize(input)
    const name = typeof clean.name === 'string' ? clean.name : ''
    if (!name) { result.skipped++; continue }
    const emails = [clean.email, clean.email_secondary, clean.email_support].filter((e): e is string => typeof e === 'string' && Boolean(e))
    const match = emails.map((e) => byEmail.get(e)).find(Boolean) ?? byNameOrg.get(nameKey(name, clean.org as string | null))
    if (match) {
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(clean)) {
        if (v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue
        if (k === 'kind' && v === 'other') continue
        if (k === 'on_platform' && v === false) continue
        const cur = (match as Record<string, unknown>)[k]
        if (k === 'tags') {
          const merged = Array.from(new Set([...(match.tags ?? []), ...(v as string[])])).slice(0, 20)
          if (merged.length !== (match.tags ?? []).length) patch.tags = merged
          continue
        }
        if (cur !== v) patch[k] = v
      }
      if (Object.keys(patch).length === 0) { result.skipped++; continue }
      const { data, error } = await supabase.from('cxo_partners').update(patch).eq('rep_id', repId).eq('id', match.id).select(PARTNER_COLS).single()
      if (error) { result.skipped++; continue }
      index(data as unknown as Partner)
      result.updated++
    } else {
      const { data, error } = await supabase.from('cxo_partners').insert({ ...clean, rep_id: repId, owner_member_id: ownerMemberId }).select(PARTNER_COLS).single()
      if (error) { result.skipped++; continue }
      index(data as unknown as Partner)
      result.added++
    }
  }
  return result
}

export async function getPartner(repId: string, id: string): Promise<Partner | null> {
  const { data, error } = await supabase.from('cxo_partners').select(PARTNER_COLS).eq('rep_id', repId).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as unknown as Partner | null) ?? null
}

export async function createPartner(repId: string, input: PartnerInput): Promise<Partner> {
  const row: Record<string, unknown> = { ...sanitize(input), rep_id: repId }
  if (!row.name) throw new Error('Partner name is required.')
  const { data, error } = await supabase.from('cxo_partners').insert(row).select(PARTNER_COLS).single()
  if (error) throw error
  return data as unknown as Partner
}

export async function updatePartner(repId: string, id: string, input: PartnerInput): Promise<Partner> {
  const patch = sanitize(input)
  if ('name' in patch && !patch.name) throw new Error('Partner name is required.')
  const { data, error } = await supabase.from('cxo_partners').update(patch).eq('rep_id', repId).eq('id', id).select(PARTNER_COLS).single()
  if (error) throw error
  return data as unknown as Partner
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
  const hay = (p: Partner) => `${p.name} ${p.org ?? ''} ${p.role ?? ''} ${p.email ?? ''} ${(p.tags ?? []).join(' ')}`.toLowerCase()
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
  draftId?: string | null
  fromAccount?: string | null
  threadId?: string | null
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
      draft_id: input.draftId ?? null,
      from_account: input.fromAccount ?? null,
      thread_id: input.threadId ?? null,
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
  sent: { channel: PartnerAction['channel']; providerId: string | null; sentTo: string; subject?: string; body?: string; fromAccount?: string | null; threadId?: string | null },
): Promise<PartnerAction> {
  const patch: Record<string, unknown> = { status: 'sent', channel: sent.channel, provider_id: sent.providerId, sent_to: sent.sentTo, sent_at: new Date().toISOString(), draft_id: null }
  if (sent.fromAccount !== undefined) patch.from_account = sent.fromAccount
  if (sent.threadId !== undefined) patch.thread_id = sent.threadId
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
  | { sent: true; channel: 'gmail' | 'ses'; providerId: string | null; threadId?: string | null; from: string }
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

// ── Draft-first ─────────────────────────────────────────────────────────────
//
// Every partner message is a row in cxo_partner_actions with status=draft
// first. When the exec has Gmail connected the same draft is also saved in
// their Gmail Drafts (drafts.create), so they can read it here or in Gmail.
// Sending a draft is drafts.send on that exact draft; the Gmail message id
// (and thread id) land on the row as the send log. Both the Partners page
// and Mira's tools go through createPartnerDraft + sendPartnerDraft — one
// code path.

export type DraftInput = {
  repId: string
  memberId: string | null
  partnerId: string
  kind: 'note' | 'email' | 'report'
  subject: string
  body: string
  to: string | null
  senderName: string
  senderEmail: string | null
  /** Connected Google account (email) to draft on when the exec has several. */
  fromAccount?: string | null
  createdBy: string | null
}

/** Save the draft row and, when Gmail is connected, the matching Gmail draft. */
export async function createPartnerDraft(input: DraftInput): Promise<PartnerAction> {
  const { account } = await pickSenderAccount(input.repId, input.memberId, input.fromAccount)
  let draftId: string | null = null
  let channel: PartnerAction['channel'] = null
  if (account && input.to) {
    const r = await createGmailDraft(input.repId, {
      to: input.to,
      subject: input.subject,
      body: input.body,
      memberId: account.memberId,
      accountId: account.accountId,
    }).catch(() => ({ ok: false as const }))
    if (r.ok && r.draftId) {
      draftId = r.draftId
      channel = 'gmail'
    }
  }
  return recordPartnerAction({
    repId: input.repId,
    partnerId: input.partnerId,
    kind: input.kind,
    subject: input.subject,
    body: input.body,
    status: 'draft',
    sentTo: input.to,
    channel,
    draftId,
    fromAccount: account?.email ?? null,
    createdBy: input.createdBy,
  })
}

/**
 * Send a saved draft as the executive. The Gmail draft is sent as-is when it
 * still matches (same account, same text, same recipient); otherwise the
 * message goes through deliverPartnerEmail and the stale Gmail draft is
 * discarded. The row becomes the send log either way.
 */
export async function sendPartnerDraft(input: {
  repId: string
  memberId: string | null
  action: PartnerAction
  senderName: string
  senderEmail: string | null
  to?: string | null
  subject?: string | null
  body?: string | null
  fromAccount?: string | null
}): Promise<{ outcome: SendOutcome; action: PartnerAction }> {
  const a = input.action
  const to = (input.to ?? '').trim() || a.sent_to || null
  const subject = (input.subject ?? '').trim() || a.subject || ''
  const body = (input.body ?? '').trim() || a.body || ''
  const wantFrom = (input.fromAccount ?? '').trim() || a.from_account || null
  const unchanged = to === a.sent_to && subject === (a.subject ?? '') && body === (a.body ?? '') && (!input.fromAccount || input.fromAccount.toLowerCase() === (a.from_account ?? '').toLowerCase())

  if (a.draft_id && a.channel === 'gmail' && unchanged) {
    const { account } = await pickSenderAccount(input.repId, input.memberId, wantFrom)
    if (account) {
      const r = await sendGmailDraft(input.repId, a.draft_id, { memberId: account.memberId, accountId: account.accountId }).catch(() => ({ ok: false as const, error: 'gmail_failed' }))
      if (r.ok) {
        const outcome: SendOutcome = { sent: true, channel: 'gmail', providerId: r.messageId ?? null, threadId: r.threadId ?? null, from: account.email ?? input.senderEmail ?? 'your Google account' }
        const row = await markActionSent(input.repId, a.id, { channel: 'gmail', providerId: outcome.providerId, sentTo: to!, fromAccount: account.email, threadId: r.threadId ?? null })
        return { outcome, action: row }
      }
    }
  }

  const outcome = await deliverPartnerEmail({
    repId: input.repId,
    memberId: input.memberId,
    senderName: input.senderName,
    senderEmail: input.senderEmail,
    to,
    subject,
    body,
    fromAccount: wantFrom,
  })
  if (!outcome.sent) return { outcome, action: a }
  if (a.draft_id) {
    const { account } = await pickSenderAccount(input.repId, input.memberId, a.from_account)
    if (account) await deleteGmailDraft(input.repId, a.draft_id, { memberId: account.memberId, accountId: account.accountId }).catch(() => false)
  }
  const row = await markActionSent(input.repId, a.id, { channel: outcome.channel, providerId: outcome.providerId, sentTo: to!, subject, body, fromAccount: outcome.channel === 'gmail' ? outcome.from : null, threadId: outcome.threadId ?? null })
  return { outcome, action: row }
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
