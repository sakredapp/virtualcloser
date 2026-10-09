/**
 * Mira's Partners + calendar tools (Suite CXO tenants only).
 *
 * Partners: list_partners, get_partner, add_partner, compose_partner_message,
 * send_partner_message. Every message is drafted first (a row in
 * cxo_partner_actions with status=draft); send_partner_message turns that
 * draft into a real send through the executive's own Gmail (or SES when no
 * Google account is connected) and records the provider id on the row.
 *
 * Calendar: find_open_slots, create_calendar_event, update_calendar_event,
 * cancel_calendar_event, schedule_call_with_partner — real Google Calendar
 * writes with invites, checked for clashes across every connected calendar.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { AgentContext, ToolHandlerResult } from '@/lib/agent/tools'
import {
  createPartner,
  createPartnerDraft,
  getPartner,
  getPartnerAction,
  listPartnerActions,
  listPartners,
  loadPartnerCalendar,
  markActionSent,
  meetingsForPartner,
  pickSenderAccount,
  recordPartnerAction,
  resolvePartner,
  sendPartnerDraft,
  senderStatus,
  asKind,
  type Partner,
} from '@/lib/partners'
import { createGmailDraft, getGmailThread, getGmailThreadMetadata, listGmailThreads, replyToGmailThread, sendGmailDraft } from '@/lib/google'
import { CONNECT_EMAIL_HINT, partnersReady } from '@/lib/partners'
import { PARTNERS_NOT_READY } from '@/lib/partnersShared'
import { asReportLine, asWindow, composePartnerReport } from '@/lib/partnerReport'
import { Loader } from '@/lib/mcp/data'
import {
  CalendarWriteError,
  cancelEventWithNotice,
  createEventWithInvites,
  findOpenSlots,
  fmtInTz,
  listWritableCalendars,
  updateEventWithNotice,
} from '@/lib/cxoCalendar'

type Handler = (ctx: AgentContext, args: Record<string, unknown>) => Promise<ToolHandlerResult>
const j = (payload: unknown): ToolHandlerResult => ({ text: JSON.stringify(payload) })
const str = (v: unknown, max = 4000): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || fallback)

function companyOf(ctx: AgentContext): string {
  return ctx.tenant.company || ctx.tenant.display_name
}

function briefPartner(p: Partner) {
  return { id: p.id, name: p.name, org: p.org, role: p.role, kind: p.kind, email: p.email, phone: p.phone, tags: p.tags }
}

async function resolveOrAsk(ctx: AgentContext, query: string): Promise<{ partner: Partner } | { error: ToolHandlerResult }> {
  if (!query) return { error: j({ ok: false, error: 'partner required' }) }
  const r = await resolvePartner(ctx.tenant.id, query)
  if (r.partner) return { partner: r.partner }
  if (r.candidates.length > 1) {
    return {
      error: j({ ok: false, ambiguous: true, ask: `Which one: ${r.candidates.map((c) => `${c.name}${c.org ? ` (${c.org})` : ''}`).join(', ')}?`, candidates: r.candidates.map(briefPartner) }),
    }
  }
  return { error: j({ ok: false, not_found: true, ask: `I don't have a partner called "${query}". Add them on the Partners page, or tell me their name, company and email and I will add them.` }) }
}

// ── Partners ────────────────────────────────────────────────────────────────

const handle_list_partners: Handler = async (ctx, args) => {
  const q = str(args.q, 100)
  const kindRaw = str(args.kind, 20)
  const kind = kindRaw ? asKind(kindRaw) : undefined
  const rows = await listPartners(ctx.tenant.id, { q: q || undefined, kind })
  return j({ items: rows.map(briefPartner), total: rows.length })
}

const handle_get_partner: Handler = async (ctx, args) => {
  const r = await resolveOrAsk(ctx, str(args.partner, 120))
  if ('error' in r) return r.error
  const p = r.partner
  const [events, actions] = await Promise.all([
    loadPartnerCalendar(ctx.tenant.id, ctx.caller.id, { timeZone: ctx.timezone }),
    listPartnerActions(ctx.tenant.id, p.id, 10),
  ])
  const meetings = meetingsForPartner(p, events, 3).map((m) => ({ when: m.start, when_local: fmtInTz(m.start, ctx.timezone), title: m.summary, link: m.htmlLink }))
  return j({
    partner: { ...briefPartner(p), notes: p.notes },
    next_meetings: meetings,
    calendar_connected: events !== null,
    recent_actions: actions.map((a) => ({ id: a.id, kind: a.kind, status: a.status, subject: a.subject, when: a.sent_at ?? a.created_at, channel: a.channel })),
  })
}

const handle_add_partner: Handler = async (ctx, args) => {
  const name = str(args.name, 120)
  if (!name) return j({ ok: false, error: 'name required' })
  const p = await createPartner(ctx.tenant.id, {
    name,
    org: str(args.org, 160) || null,
    role: str(args.role, 160) || null,
    kind: asKind(str(args.kind, 20) || 'other'),
    email: str(args.email, 200) || null,
    phone: str(args.phone, 40) || null,
    notes: str(args.notes, 4000) || null,
    owner_member_id: ctx.caller.id,
  })
  return j({ ok: true, partner: briefPartner(p) })
}

const handle_compose_partner_message: Handler = async (ctx, args) => {
  const r = await resolveOrAsk(ctx, str(args.partner, 120))
  if ('error' in r) return r.error
  const p = r.partner
  const kindRaw = str(args.kind, 20).toLowerCase()
  const kind = kindRaw === 'report' ? 'report' : kindRaw === 'note' ? 'note' : 'email'
  let subject = str(args.subject, 200)
  let body = str(args.body, 8000)
  let report: Awaited<ReturnType<typeof composePartnerReport>> | null = null

  if (kind === 'report') {
    const itemsRaw = Array.isArray(args.report_items) ? (args.report_items as Array<Record<string, unknown>>) : []
    const items = itemsRaw.map((it) => ({ line: asReportLine(it.line), window: asWindow(it.window) }))
    if (items.length === 0) return j({ ok: false, error: 'report_items required: e.g. [{line:"Health",window:"3m"},{line:"Life",window:"6m"}]' })
    report = await composePartnerReport(new Loader(ctx.tenant), p, { items, intro: str(args.intro, 600) || null, closing: str(args.closing, 600) || null }, { name: ctx.caller.display_name, company: companyOf(ctx) })
    subject = subject || report.subject
    body = report.body
  } else if (!body) {
    return j({ ok: false, error: 'body required' })
  }
  if (!subject) subject = kind === 'note' ? `Note from ${ctx.caller.display_name}` : `From ${ctx.caller.display_name}, ${companyOf(ctx)}`

  // Row + Gmail draft (drafts.create) when Google is connected — same path as the Partners page.
  const action = await createPartnerDraft({
    repId: ctx.tenant.id,
    memberId: ctx.caller.id,
    partnerId: p.id,
    kind,
    subject,
    body,
    to: p.email,
    senderName: ctx.caller.display_name,
    senderEmail: ctx.caller.email,
    fromAccount: str(args.from_account, 200) || null,
    createdBy: ctx.caller.id,
  })
  const status = await senderStatus(ctx.tenant.id, ctx.caller.id, ctx.caller.display_name)
  return j({
    ok: true,
    draft_id: action.id,
    in_gmail_drafts: Boolean(action.draft_id),
    from: action.from_account ?? status.from,
    partner: briefPartner(p),
    to: p.email,
    subject,
    body,
    sections: report?.sections,
    data_through: report?.data_through,
    windows_without_data: report?.missing ?? [],
    sender: status,
    next: status.ready
      ? `Draft saved. Show it to ${ctx.caller.display_name.split(' ')[0]}; send only when they say so, via send_partner_message with this draft_id.`
      : 'Draft saved. No email path is connected: tell them to connect Google on the Calendar page, then send.',
  })
}

const handle_send_partner_message: Handler = async (ctx, args) => {
  const draftId = str(args.draft_id, 60)
  let draft: Awaited<ReturnType<typeof getPartnerAction>> = null
  if (draftId) {
    draft = await getPartnerAction(ctx.tenant.id, draftId)
    if (!draft) return j({ ok: false, error: 'draft not found' })
    if (draft.status === 'sent') return j({ ok: false, error: 'already sent', sent_at: draft.sent_at })
  } else {
    // No draft yet (the exec dictated "send Dana an email saying ...") — draft first, then send. Still one row.
    const r = await resolveOrAsk(ctx, str(args.partner, 120))
    if ('error' in r) return r.error
    const subject = str(args.subject, 200)
    const body = str(args.body, 8000)
    if (!subject || !body) return j({ ok: false, error: 'subject and body required' })
    draft = await createPartnerDraft({
      repId: ctx.tenant.id,
      memberId: ctx.caller.id,
      partnerId: r.partner.id,
      kind: 'email',
      subject,
      body,
      to: str(args.to, 200) || r.partner.email,
      senderName: ctx.caller.display_name,
      senderEmail: ctx.caller.email,
      fromAccount: str(args.from_account, 200) || null,
      createdBy: ctx.caller.id,
    })
  }
  const partner = await getPartner(ctx.tenant.id, draft.partner_id)
  if (!partner) return j({ ok: false, error: 'partner not found' })
  const { outcome, action } = await sendPartnerDraft({
    repId: ctx.tenant.id,
    memberId: ctx.caller.id,
    action: draft,
    senderName: ctx.caller.display_name,
    senderEmail: ctx.caller.email,
    to: str(args.to, 200) || partner.email,
    subject: str(args.subject, 200) || null,
    body: str(args.body, 8000) || null,
    fromAccount: str(args.from_account, 200) || null,
  })
  if (!outcome.sent) return j({ ok: false, sent: false, saved_as_draft: true, draft_id: action.id, reason: outcome.reason, gap: outcome.gap })
  return j({ ok: true, sent: true, action_id: action.id, to: action.sent_to, subject: action.subject, via: outcome.channel, from: outcome.from, provider_id: outcome.providerId, thread_id: action.thread_id })
}

// ── Inbox (the exec's Gmail) ────────────────────────────────────────────────

async function senderAccount(ctx: AgentContext, prefer: string | null) {
  const { account, choices } = await pickSenderAccount(ctx.tenant.id, ctx.caller.id, prefer)
  return { account, choices }
}

const handle_list_inbox: Handler = async (ctx, args) => {
  const { account } = await senderAccount(ctx, str(args.from_account, 200) || null)
  if (!account) return j({ ok: false, error: 'not_connected', say: CONNECT_EMAIL_HINT })
  let q = str(args.q, 300)
  let partner: Partner | null = null
  const who = str(args.partner, 120)
  if (who) {
    const r = await resolveOrAsk(ctx, who)
    if ('error' in r) return r.error
    partner = r.partner
    if (!partner.email) return j({ ok: false, error: 'partner has no email on file', partner: briefPartner(partner) })
    q = `${q ? `${q} ` : ''}(from:${partner.email} OR to:${partner.email})`
  }
  const limit = Math.min(Math.max(Math.round(num(args.limit, 8)), 1), 20)
  const list = await listGmailThreads(ctx.tenant.id, account.memberId, { q: q || 'in:inbox', maxResults: limit, accountId: account.accountId })
  if (!list.ok) return j({ ok: false, error: list.error, say: list.error === 'gmail_scope_missing' ? 'Reconnect Google on the Calendar page to let me read your inbox.' : 'Gmail did not answer.' })
  const threads = await Promise.all(
    (list.threads ?? []).map(async (t) => {
      const m = await getGmailThreadMetadata(ctx.tenant.id, account.memberId, t.id, { accountId: account.accountId }).catch(() => ({ ok: false as const }))
      const meta = m.ok ? m.meta : undefined
      return { thread_id: t.id, subject: meta?.subject ?? null, from: meta?.fromName ?? meta?.fromAddress ?? null, from_email: meta?.fromAddress ?? null, snippet: (meta?.snippet ?? t.snippet ?? '').slice(0, 200), last_at: meta?.lastMessageAt ?? null }
    }),
  )
  return j({ ok: true, account: account.email, partner: partner ? briefPartner(partner) : undefined, threads })
}

const handle_read_thread: Handler = async (ctx, args) => {
  const threadId = str(args.thread_id, 80)
  if (!threadId) return j({ ok: false, error: 'thread_id required' })
  const { account } = await senderAccount(ctx, str(args.from_account, 200) || null)
  if (!account) return j({ ok: false, error: 'not_connected', say: CONNECT_EMAIL_HINT })
  const t = await getGmailThread(ctx.tenant.id, account.memberId, threadId, { accountId: account.accountId })
  if (!t.ok) return j({ ok: false, error: t.error })
  const messages = (t.messages ?? []).map((m) => ({
    id: m.id,
    at: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    from: m.fromName ? `${m.fromName} <${m.fromAddress}>` : m.fromAddress,
    to: m.toAddresses,
    subject: m.subject,
    text: (m.bodyText ?? m.snippet ?? '').replace(/\r/g, '').trim().slice(0, 4000),
  }))
  return j({ ok: true, account: account.email, thread_id: threadId, subject: messages[messages.length - 1]?.subject ?? null, messages })
}

/** Draft (default) or send a reply in an existing thread, from the exec's Gmail. */
const handle_reply_to_thread: Handler = async (ctx, args) => {
  const threadId = str(args.thread_id, 80)
  const body = str(args.body, 8000)
  const mode = str(args.mode, 10).toLowerCase() === 'send' ? 'send' : 'draft'
  const { account } = await senderAccount(ctx, str(args.from_account, 200) || null)
  if (!account) return j({ ok: false, error: 'not_connected', say: CONNECT_EMAIL_HINT })

  // "send it" on a reply we already drafted: drafts.send on that Gmail draft.
  const gmailDraftId = str(args.gmail_draft_id, 120)
  if (mode === 'send' && gmailDraftId && !body) {
    const r = await sendGmailDraft(ctx.tenant.id, gmailDraftId, { memberId: account.memberId, accountId: account.accountId })
    if (!r.ok) return j({ ok: false, error: r.error })
    const actionId = str(args.action_id, 60)
    if (actionId) await markActionSent(ctx.tenant.id, actionId, { channel: 'gmail', providerId: r.messageId ?? null, sentTo: str(args.to, 200) || '', fromAccount: account.email, threadId: r.threadId ?? threadId }).catch(() => null)
    return j({ ok: true, sent: true, thread_id: r.threadId ?? threadId, message_id: r.messageId, from: account.email })
  }

  if (!threadId || !body) return j({ ok: false, error: 'thread_id and body required' })
  const t = await getGmailThread(ctx.tenant.id, account.memberId, threadId, { accountId: account.accountId })
  if (!t.ok || !t.messages?.length) return j({ ok: false, error: t.error ?? 'thread not found' })
  const me = (account.email ?? '').toLowerCase()
  const last = [...t.messages].reverse().find((m) => m.fromAddress.toLowerCase() !== me) ?? t.messages[t.messages.length - 1]
  const to = str(args.to, 200) || last.fromAddress
  const subject = /^re:/i.test(last.subject) ? last.subject : `Re: ${last.subject}`
  const partner = await resolvePartner(ctx.tenant.id, to).then((r) => r.partner ?? null).catch(() => null)

  if (mode === 'draft') {
    const d = await createGmailDraft(ctx.tenant.id, { to, subject, body, threadId, memberId: account.memberId, accountId: account.accountId })
    if (!d.ok) return j({ ok: false, error: d.error })
    const action = partner
      ? await recordPartnerAction({ repId: ctx.tenant.id, partnerId: partner.id, kind: 'email', subject, body, status: 'draft', sentTo: to, channel: 'gmail', draftId: d.draftId ?? null, fromAccount: account.email, threadId, createdBy: ctx.caller.id }).catch(() => null)
      : null
    return j({ ok: true, sent: false, gmail_draft_id: d.draftId, action_id: action?.id, to, subject, body, from: account.email, partner: partner ? briefPartner(partner) : undefined, next: `Reply drafted in ${account.email}'s Gmail. Show it; send only when they say so (mode=send with gmail_draft_id${action ? ' and action_id' : ''}).` })
  }

  const r = await replyToGmailThread(ctx.tenant.id, { threadId, to, subject, body, inReplyTo: last.messageIdHeader, references: last.referencesHeader, memberId: account.memberId, accountId: account.accountId })
  if (!r.ok) return j({ ok: false, error: r.error })
  const action = partner
    ? await recordPartnerAction({ repId: ctx.tenant.id, partnerId: partner.id, kind: 'email', subject, body, status: 'sent', sentTo: to, channel: 'gmail', providerId: r.messageId ?? null, fromAccount: account.email, threadId, createdBy: ctx.caller.id }).catch(() => null)
    : null
  return j({ ok: true, sent: true, thread_id: threadId, message_id: r.messageId, to, subject, from: account.email, action_id: action?.id, readback: `Replied to ${to} from ${account.email}: ${subject}` })
}

// ── Calendar ────────────────────────────────────────────────────────────────

function calErr(err: unknown): ToolHandlerResult {
  if (err instanceof CalendarWriteError) return j({ ok: false, error: err.code, say: err.message })
  return j({ ok: false, error: 'calendar_failed', say: err instanceof Error ? err.message : 'Calendar call failed.' })
}

function isoOrDay(v: unknown, tz: string, endOfDay = false): string | null {
  const s = str(v, 40)
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // A bare date: interpret in the exec's timezone.
    const probe = new Date(`${s}T${endOfDay ? '23:59:59' : '00:00:00'}Z`)
    const offsetMin = tzOffsetMinutes(probe, tz)
    return new Date(probe.getTime() - offsetMin * 60_000).toISOString()
  }
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  // "2026-10-09T14:00:00" without a zone → the exec's timezone.
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const naive = new Date(`${s}Z`)
    return new Date(naive.getTime() - tzOffsetMinutes(naive, tz) * 60_000).toISOString()
  }
  return d.toISOString()
}

function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return Math.round((asUtc - at.getTime()) / 60_000)
}

async function attendeesFrom(ctx: AgentContext, raw: unknown): Promise<{ attendees: Array<{ email: string; displayName?: string }>; partners: Partner[]; ask?: string }> {
  const list = Array.isArray(raw) ? raw.map((x) => str(x, 200)).filter(Boolean) : str(raw, 200) ? [str(raw, 200)] : []
  const attendees: Array<{ email: string; displayName?: string }> = []
  const partners: Partner[] = []
  for (const item of list) {
    if (item.includes('@')) {
      attendees.push({ email: item.toLowerCase() })
      continue
    }
    const r = await resolvePartner(ctx.tenant.id, item)
    if (r.partner) {
      partners.push(r.partner)
      if (r.partner.email) attendees.push({ email: r.partner.email, displayName: r.partner.name })
      else return { attendees, partners, ask: `${r.partner.name} has no email on file, so I can't invite them. Add one on the Partners page.` }
    } else if (r.candidates.length > 1) {
      return { attendees, partners, ask: `Which ${item}: ${r.candidates.map((c) => `${c.name}${c.org ? ` (${c.org})` : ''}`).join(', ')}?` }
    } else {
      return { attendees, partners, ask: `I don't have "${item}" as a partner or an email address. Give me their email or add them on the Partners page.` }
    }
  }
  return { attendees, partners }
}

const handle_find_open_slots: Handler = async (ctx, args) => {
  const tz = ctx.timezone
  const from = isoOrDay(args.from, tz) ?? new Date().toISOString()
  const to = isoOrDay(args.to, tz, true) ?? new Date(new Date(from).getTime() + 5 * 86400_000).toISOString()
  try {
    const r = await findOpenSlots(ctx.tenant.id, {
      fromIso: from,
      toIso: to,
      durationMin: num(args.duration_min, 30),
      tz,
      startHour: num(args.start_hour, 9),
      endHour: num(args.end_hour, 17),
      count: num(args.count, 5),
    })
    return j({ ok: true, timezone: tz, checked_calendars: r.checkedCalendars, slots: r.slots.map((s) => ({ start: s.startIso, end: s.endIso, local: s.label })) })
  } catch (err) {
    return calErr(err)
  }
}

async function logMeeting(ctx: AgentContext, partners: Partner[], subject: string, body: string) {
  for (const p of partners) {
    await recordPartnerAction({ repId: ctx.tenant.id, partnerId: p.id, kind: 'meeting', subject, body, status: 'done', createdBy: ctx.caller.id }).catch(() => null)
  }
}

const handle_create_calendar_event: Handler = async (ctx, args) => {
  const tz = ctx.timezone
  const title = str(args.title, 200)
  const start = isoOrDay(args.start, tz)
  if (!title || !start) return j({ ok: false, error: 'title and start required' })
  const end = isoOrDay(args.end, tz) ?? new Date(new Date(start).getTime() + num(args.duration_min, 30) * 60_000).toISOString()
  const who = await attendeesFrom(ctx, args.attendees)
  if (who.ask) return j({ ok: false, ask: who.ask })
  try {
    const ev = await createEventWithInvites(ctx.tenant.id, ctx.caller.id, {
      calendar: str(args.calendar, 120) || null,
      title,
      description: str(args.description, 4000) || null,
      location: str(args.location, 400) || null,
      startIso: start,
      endIso: end,
      tz,
      attendees: who.attendees,
      addMeet: args.video === true || args.video === 'true',
      allowConflict: args.allow_conflict === true,
    })
    const readback = `${title} — ${fmtInTz(ev.startIso, tz)} to ${fmtInTz(ev.endIso, tz).replace(/^.*?, /, '')}, on ${ev.calendar.name} (${ev.calendar.accountEmail ?? ev.calendar.accountLabel})${who.attendees.length ? `, invites to ${who.attendees.map((a) => a.email).join(', ')}` : ''}.`
    await logMeeting(ctx, who.partners, `Meeting booked: ${title}`, `${readback}\n${ev.htmlLink}`)
    return j({ ok: true, event_id: ev.id, link: ev.htmlLink, meet_link: ev.meetLink, readback })
  } catch (err) {
    return calErr(err)
  }
}

const handle_update_calendar_event: Handler = async (ctx, args) => {
  const tz = ctx.timezone
  const eventId = str(args.event_id, 200)
  if (!eventId) return j({ ok: false, error: 'event_id required' })
  const start = isoOrDay(args.start, tz)
  let end = isoOrDay(args.end, tz)
  if (start && !end) end = new Date(new Date(start).getTime() + num(args.duration_min, 30) * 60_000).toISOString()
  const who = await attendeesFrom(ctx, args.add_attendees)
  if (who.ask) return j({ ok: false, ask: who.ask })
  try {
    const ev = await updateEventWithNotice(ctx.tenant.id, ctx.caller.id, eventId, {
      title: str(args.title, 200) || undefined,
      description: typeof args.description === 'string' ? str(args.description, 4000) : undefined,
      location: typeof args.location === 'string' ? str(args.location, 400) : undefined,
      startIso: start ?? undefined,
      endIso: end ?? undefined,
      tz,
      addAttendees: who.attendees.map((a) => a.email),
    })
    const readback = `Updated on ${ev.calendar.name}${start ? `: now ${fmtInTz(start, tz)}` : ''}. Attendees notified.`
    await logMeeting(ctx, who.partners, 'Meeting updated', `${readback}\n${ev.htmlLink}`)
    return j({ ok: true, event_id: ev.id, link: ev.htmlLink, readback })
  } catch (err) {
    return calErr(err)
  }
}

const handle_cancel_calendar_event: Handler = async (ctx, args) => {
  const eventId = str(args.event_id, 200)
  if (!eventId) return j({ ok: false, error: 'event_id required' })
  try {
    const r = await cancelEventWithNotice(ctx.tenant.id, ctx.caller.id, eventId)
    const who = await attendeesFrom(ctx, args.partners)
    await logMeeting(ctx, who.partners, 'Meeting cancelled', `Cancelled on ${r.calendar.name}; attendees notified.`)
    return j({ ok: true, readback: `Cancelled on ${r.calendar.name}. Attendees notified.` })
  } catch (err) {
    return calErr(err)
  }
}

const handle_schedule_call_with_partner: Handler = async (ctx, args) => {
  const tz = ctx.timezone
  const r = await resolveOrAsk(ctx, str(args.partner, 120))
  if ('error' in r) return r.error
  const p = r.partner
  if (!p.email) return j({ ok: false, ask: `${p.name} has no email on file, so I can't send an invite. Add one on the Partners page.` })
  const duration = num(args.duration_min, 30)
  const title = str(args.title, 200) || `${companyOf(ctx)} × ${p.org ?? p.name}: ${ctx.caller.display_name.split(' ')[0]} / ${p.name.split(' ')[0]}`
  let start = isoOrDay(args.start, tz)
  try {
    if (!start) {
      const from = isoOrDay(args.window_from, tz) ?? new Date().toISOString()
      const to = isoOrDay(args.window_to, tz, true) ?? new Date(new Date(from).getTime() + 5 * 86400_000).toISOString()
      const open = await findOpenSlots(ctx.tenant.id, { fromIso: from, toIso: to, durationMin: duration, tz, startHour: num(args.start_hour, 9), endHour: num(args.end_hour, 17), count: 3 })
      if (open.slots.length === 0) return j({ ok: false, ask: `Nothing open between ${fmtInTz(from, tz)} and ${fmtInTz(to, tz)} across your ${open.checkedCalendars} calendars. Widen the window?` })
      if (args.pick_first !== true && open.slots.length > 1) {
        return j({ ok: false, choose: true, ask: `Open for ${p.name}: ${open.slots.map((s) => s.label).join('; ')}. Which one?`, slots: open.slots.map((s) => ({ start: s.startIso, local: s.label })) })
      }
      start = open.slots[0].startIso
    }
    const end = new Date(new Date(start).getTime() + duration * 60_000).toISOString()
    const ev = await createEventWithInvites(ctx.tenant.id, ctx.caller.id, {
      calendar: str(args.calendar, 120) || null,
      title,
      description: str(args.description, 4000) || `Call with ${p.name}${p.org ? `, ${p.org}` : ''}.`,
      startIso: start,
      endIso: end,
      tz,
      attendees: [{ email: p.email, displayName: p.name }],
      addMeet: args.video !== false,
    })
    const readback = `${title} — ${fmtInTz(ev.startIso, tz)}, ${duration} min, on ${ev.calendar.name} (${ev.calendar.accountEmail ?? ev.calendar.accountLabel}), invite sent to ${p.email}.`
    await logMeeting(ctx, [p], `Call booked: ${title}`, `${readback}\n${ev.htmlLink}`)
    return j({ ok: true, event_id: ev.id, link: ev.htmlLink, meet_link: ev.meetLink, readback })
  } catch (err) {
    return calErr(err)
  }
}

const handle_list_calendars: Handler = async (ctx) => {
  const cals = await listWritableCalendars(ctx.tenant.id, ctx.caller.id)
  return j({ items: cals.map((c) => ({ name: c.name, account: c.accountEmail ?? c.accountLabel, primary: c.primary })), total: cals.length, connected: cals.length > 0 })
}

/** Partner tools answer plainly, never error, while the Partners tables are not set up. */
function whenPartnersReady(h: Handler): Handler {
  return async (ctx, args) => {
    if (!(await partnersReady())) return j({ ok: false, not_ready: true, message: PARTNERS_NOT_READY, say: 'Tell the executive exactly: "Partners will appear here once setup finishes." Do not retry.' })
    return h(ctx, args)
  }
}

export const CXO_TOOL_HANDLERS: Record<string, Handler> = {
  list_inbox: handle_list_inbox,
  read_thread: handle_read_thread,
  reply_to_thread: handle_reply_to_thread,
  list_partners: whenPartnersReady(handle_list_partners),
  get_partner: whenPartnersReady(handle_get_partner),
  add_partner: whenPartnersReady(handle_add_partner),
  compose_partner_message: whenPartnersReady(handle_compose_partner_message),
  send_partner_message: whenPartnersReady(handle_send_partner_message),
  list_calendars: handle_list_calendars,
  find_open_slots: handle_find_open_slots,
  create_calendar_event: handle_create_calendar_event,
  update_calendar_event: handle_update_calendar_event,
  cancel_calendar_event: handle_cancel_calendar_event,
  schedule_call_with_partner: whenPartnersReady(handle_schedule_call_with_partner),
}

const partnerProp = { type: 'string', description: 'Who, as the executive says it: a name, "Dana at Mutual of Omaha", or a company. Ambiguous → the tool returns candidates; ask which.' } as const
const whenProp = (what: string) => ({ type: 'string', description: `${what} as ISO 8601 (e.g. 2026-10-09T14:00:00). No zone = the executive's timezone. A bare date (YYYY-MM-DD) is allowed where a day is enough.` }) as const

export const CXO_TOOL_DEFS: Anthropic.Tool[] = [
  {
    name: 'list_partners',
    description: 'The executive\'s partners: carrier reps, agency principals, board members, vendors, key producers. Optional text search and kind filter.',
    input_schema: { type: 'object', properties: { q: { type: 'string' }, kind: { type: 'string', enum: ['carrier', 'agency', 'board', 'vendor', 'producer', 'other'] } }, additionalProperties: false },
  },
  {
    name: 'get_partner',
    description: 'One partner in full: details, their next meetings with us (from the calendar), and the last notes/emails/reports sent to them.',
    input_schema: { type: 'object', properties: { partner: partnerProp }, required: ['partner'], additionalProperties: false },
  },
  {
    name: 'add_partner',
    description: 'Add a partner when the executive names someone new ("add Dana Whitfield at Mutual of Omaha, dana@..."). Kind: carrier | agency | board | vendor | producer | other.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' }, org: { type: 'string' }, role: { type: 'string' }, kind: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, notes: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'compose_partner_message',
    description:
      'Draft a note, email or production REPORT for a partner and save it as a draft (never sends). For kind=report pass report_items: one per product line with its own window — e.g. "health premium for the last 3 months and life premium for the last 6 months" → [{line:"Health",window:"3m"},{line:"Life",window:"6m"}]. Windows: 3m, 6m, 12m, ytd, mtd, qtd, last_month, last_year, or {start,end}. The numbers come from the live book; a window with no data is called out, never sent as zero. Returns the draft text and whether a send path is ready.',
    input_schema: {
      type: 'object',
      properties: {
        partner: partnerProp,
        kind: { type: 'string', enum: ['note', 'email', 'report'] },
        subject: { type: 'string' },
        body: { type: 'string', description: 'For note/email: the full message in the executive\'s voice.' },
        report_items: { type: 'array', items: { type: 'object', properties: { line: { type: 'string', enum: ['Health', 'Life', 'Annuity', 'All'] }, window: { type: 'string' } }, required: ['line', 'window'] } },
        intro: { type: 'string', description: 'Optional opening sentence for a report.' },
        closing: { type: 'string', description: 'Optional closing sentence for a report.' },
        from_account: { type: 'string', description: 'Which connected Google account (email) to draft on, when the executive has several and named one.' },
      },
      required: ['partner', 'kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'send_partner_message',
    description:
      'SEND a saved draft (draft_id from compose_partner_message) as the executive, from their own Gmail (or the Suite CXO mailer with them as reply-to). Only call after the executive explicitly asked to send ("send it", "go ahead"). Read back one line first: to whom, subject. Records the send on the partner.',
    input_schema: {
      type: 'object',
      properties: {
        draft_id: { type: 'string' },
        partner: partnerProp,
        subject: { type: 'string' },
        body: { type: 'string' },
        to: { type: 'string', description: 'Override recipient email (defaults to the partner\'s).' },
        from_account: { type: 'string', description: 'Which connected Google account to send from, by email, when the executive has several.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_inbox',
    description:
      'Recent threads in the executive\'s own Gmail inbox (read-only). Pass partner to see only mail with that partner, or q for a Gmail search ("is:unread", "subject:renewal"). Returns thread ids for read_thread / reply_to_thread.',
    input_schema: {
      type: 'object',
      properties: { partner: partnerProp, q: { type: 'string' }, limit: { type: 'number' }, from_account: { type: 'string', description: 'Which connected Google account (email), when they have several.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'read_thread',
    description: 'Every message in one Gmail thread (from, when, text). Use before summarising or replying.',
    input_schema: { type: 'object', properties: { thread_id: { type: 'string' }, from_account: { type: 'string' } }, required: ['thread_id'], additionalProperties: false },
  },
  {
    name: 'reply_to_thread',
    description:
      'Reply in a Gmail thread as the executive. mode=draft (default) saves the reply in their Gmail Drafts and returns gmail_draft_id — show the text and stop. mode=send only after they explicitly say to send: pass gmail_draft_id (and action_id if returned) to send that exact draft, or thread_id + body to send straight away. Read back one line first (to whom, subject). If the recipient is a partner the reply is recorded on them.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string' },
        body: { type: 'string', description: 'The reply, in the executive\'s voice. Plain text.' },
        mode: { type: 'string', enum: ['draft', 'send'] },
        gmail_draft_id: { type: 'string' },
        action_id: { type: 'string' },
        to: { type: 'string', description: 'Override recipient; default is the last person who wrote in the thread.' },
        from_account: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'list_calendars',
    description: 'The calendars the executive can book on, across every connected Google account. Use when they say "put it on my board calendar" or you need to ask which calendar.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'find_open_slots',
    description: 'Open times across EVERY connected calendar, inside working hours in the executive\'s timezone. Default window: next 5 days, 9–17, 30 minutes.',
    input_schema: {
      type: 'object',
      properties: {
        from: whenProp('Window start'),
        to: whenProp('Window end'),
        duration_min: { type: 'number' },
        start_hour: { type: 'number', description: 'Working-day start, local hour (default 9).' },
        end_hour: { type: 'number', description: 'Working-day end, local hour (default 17).' },
        count: { type: 'number', description: 'How many slots (default 5).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_calendar_event',
    description:
      'Create a real Google Calendar event with invites (attendees get the email). Attendees may be email addresses or partner names. Default calendar: the executive\'s primary; pass calendar to choose another. Refuses a time that clashes with anything on any connected calendar unless allow_conflict=true. Returns a one-line readback to repeat to the executive.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start: whenProp('Start'),
        end: whenProp('End'),
        duration_min: { type: 'number', description: 'Used when end is omitted (default 30).' },
        attendees: { type: 'array', items: { type: 'string' }, description: 'Emails or partner names.' },
        description: { type: 'string' },
        location: { type: 'string', description: 'Place or a video link.' },
        video: { type: 'boolean', description: 'Add a Google Meet link.' },
        calendar: { type: 'string', description: 'Calendar name or account email.' },
        allow_conflict: { type: 'boolean' },
      },
      required: ['title', 'start'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_calendar_event',
    description: 'Move or edit an event (attendees are notified). Get event_id from get_partner next_meetings or list_calendar_events.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        title: { type: 'string' },
        start: whenProp('New start'),
        end: whenProp('New end'),
        duration_min: { type: 'number' },
        description: { type: 'string' },
        location: { type: 'string' },
        add_attendees: { type: 'array', items: { type: 'string' } },
      },
      required: ['event_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'cancel_calendar_event',
    description: 'Cancel an event; attendees are notified. Pass partners involved so the cancellation is logged on them.',
    input_schema: { type: 'object', properties: { event_id: { type: 'string' }, partners: { type: 'array', items: { type: 'string' } } }, required: ['event_id'], additionalProperties: false },
  },
  {
    name: 'schedule_call_with_partner',
    description:
      'Book a call with a partner end to end: resolve the partner, find an open slot (or use the exact start given), create the event with a Google Meet link and send the invite. With a window and no exact start it returns up to three open times to choose from unless pick_first=true. Returns a readback line: exact time in the executive\'s timezone, calendar, invitee.',
    input_schema: {
      type: 'object',
      properties: {
        partner: partnerProp,
        start: whenProp('Exact start, if the executive named one'),
        window_from: whenProp('Earliest acceptable'),
        window_to: whenProp('Latest acceptable'),
        duration_min: { type: 'number' },
        title: { type: 'string' },
        description: { type: 'string' },
        calendar: { type: 'string' },
        video: { type: 'boolean', description: 'Google Meet link (default true).' },
        pick_first: { type: 'boolean', description: 'Book the first open slot without asking.' },
        start_hour: { type: 'number' },
        end_hour: { type: 'number' },
      },
      required: ['partner'],
      additionalProperties: false,
    },
  },
]
