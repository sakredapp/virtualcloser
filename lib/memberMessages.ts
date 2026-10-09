/**
 * Exec-to-exec messages through Mira (owner 10-09). Every Suite CXO login of
 * one agency shares a rep_id (the org); any member can message, ask, request
 * or leave a note for any other member of the same org, never across orgs
 * (the member_messages trigger enforces it). Text only, in-app only: a badge
 * on the Today rail item, the Messages card on Today, no email.
 *
 * Kinds: message | request (also lands on the recipient's to-dos, dismissable)
 * | question | note (no reply needed, just "Got it").
 */
import { supabase } from '@/lib/supabase'
import { addTodo } from '@/lib/today'

export const MESSAGE_KINDS = ['message', 'request', 'question', 'note'] as const
export type MessageKind = (typeof MESSAGE_KINDS)[number]
export const asMessageKind = (v: unknown): MessageKind => ((MESSAGE_KINDS as readonly string[]).includes(v as string) ? (v as MessageKind) : 'message')

export type OrgMember = { id: string; display_name: string | null; email: string | null; timezone: string | null }
export type MemberMessage = {
  id: string
  rep_id: string
  from_member_id: string
  to_member_id: string
  body: string
  kind: MessageKind
  deliver_at: string
  read_at: string | null
  replied_to_id: string | null
  created_at: string
}
export type MessageView = MemberMessage & { from_name: string; to_name: string; replies: MessageView[]; parent?: { body: string; from_name: string } | null }

const COLS = 'id, rep_id, from_member_id, to_member_id, body, kind, deliver_at, read_at, replied_to_id, created_at'

export function messagesMissing(err: unknown): boolean {
  const e = err as { code?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/** Every active login in the org. */
export async function orgMembers(repId: string): Promise<OrgMember[]> {
  const { data, error } = await supabase.from('members').select('id, display_name, email, timezone').eq('rep_id', repId).eq('is_active', true).order('display_name')
  if (error) throw error
  return (data ?? []) as OrgMember[]
}

/** What to call a member: their name, or their email's local part when the name is missing. */
export function memberLabel(m: Pick<OrgMember, 'display_name' | 'email'> | null | undefined): string {
  if (!m) return 'Someone'
  return (m.display_name || '').trim() || (m.email || '').split('@')[0] || 'Someone'
}
export const firstName = (m: Pick<OrgMember, 'display_name' | 'email'> | null | undefined) => memberLabel(m).split(/\s+/)[0]

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9@. ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * Find the recipient among the org's other members by name or email. Full
 * name, first name, last name or the email's local part ("spencer") all
 * match. Several hits = ambiguous; the caller asks which one.
 */
export async function resolveMember(repId: string, query: string, excludeId: string): Promise<{ member: OrgMember | null; candidates: OrgMember[]; others: OrgMember[] }> {
  const all = (await orgMembers(repId)).filter((m) => m.id !== excludeId)
  const q = norm(query)
  if (!q) return { member: null, candidates: [], others: all }
  const score = (m: OrgMember): number => {
    const name = norm(m.display_name || '')
    const email = norm(m.email || '')
    const local = email.split('@')[0]
    if (email && q === email) return 100
    if (name && q === name) return 90
    if (local && (q === local || local.split('.').includes(q))) return 80
    const parts = name.split(' ')
    if (parts.includes(q)) return 70
    if (q.split(' ').every((w) => parts.some((p) => p.startsWith(w)) || local.startsWith(w))) return 50
    return 0
  }
  const scored = all.map((m) => ({ m, s: score(m) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)
  if (!scored.length) return { member: null, candidates: [], others: all }
  const top = scored.filter((x) => x.s === scored[0].s).map((x) => x.m)
  return top.length === 1 ? { member: top[0], candidates: top, others: all } : { member: null, candidates: top, others: all }
}

/** Wall-clock time in a zone → UTC instant. */
function zonedToUtc(dateIso: string, hour: number, minute: number, tz: string): Date {
  const [y, mo, d] = dateIso.split('-').map(Number)
  const guess = new Date(Date.UTC(y, mo - 1, d, hour, minute))
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(guess)
      .map((p) => [p.type, p.value]),
  )
  const asIfUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour) % 24, Number(parts.minute))
  return new Date(guess.getTime() - (asIfUtc - guess.getTime()))
}
const dayIn = (at: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)

/**
 * When the message shows up. Empty/"now" = now. "tomorrow" = 8am tomorrow in
 * the recipient's timezone; "tomorrow 2pm", a bare date (8am that day) or a
 * full ISO time also work. Never in the past.
 */
export function deliverAtFor(when: string | null | undefined, recipientTz: string, now = new Date()): Date {
  const w = (when || '').trim().toLowerCase()
  if (!w || w === 'now' || w === 'asap' || w === 'today') return now
  const tz = recipientTz || 'America/New_York'
  const at = (dayIso: string, rest: string) => {
    const m = rest.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
    let h = 8
    let min = 0
    if (m) {
      h = Number(m[1]) % 24
      min = Number(m[2] || 0)
      if (m[3] === 'pm' && h < 12) h += 12
      if (m[3] === 'am' && h === 12) h = 0
    }
    return zonedToUtc(dayIso, h, min, tz)
  }
  let out: Date | null = null
  if (w.startsWith('tomorrow')) {
    const t = new Date(Date.parse(dayIn(now, tz) + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)
    out = at(t, w.slice(8))
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(w)) out = at(w, '')
  else if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/.test(w)) {
    out = /z$|[+-]\d{2}:?\d{2}$/.test(w) ? new Date(when as string) : zonedToUtc(w.slice(0, 10), Number(w.slice(11, 13)), Number(w.slice(14, 16)), tz)
  } else {
    const p = Date.parse(when as string)
    out = Number.isFinite(p) ? new Date(p) : null
  }
  return !out || Number.isNaN(out.getTime()) || out.getTime() < now.getTime() ? now : out
}

/** "now", "tomorrow at 8:00 AM", "Mon, Oct 12 at 2:00 PM" in the recipient's zone. */
export function deliveryPhrase(at: Date, tz: string, now = new Date()): string {
  if (at.getTime() <= now.getTime() + 60_000) return 'now'
  const zone = tz || 'America/New_York'
  const time = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit' }).format(at)
  const d = dayIn(at, zone)
  const today = dayIn(now, zone)
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86_400_000).toISOString().slice(0, 10)
  if (d === today) return `today at ${time}`
  if (d === tomorrow) return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: 'numeric', hourCycle: 'h23' }).format(at)) < 12 ? 'tomorrow morning' : `tomorrow at ${time}`
  return new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric' }).format(at) + ` at ${time}`
}

export async function sendMemberMessage(input: {
  repId: string
  fromId: string
  toId: string
  body: string
  kind?: unknown
  deliverAt?: Date
  repliedToId?: string | null
}): Promise<{ message: MemberMessage; todoId: string | null }> {
  const body = input.body.trim().slice(0, 4000)
  if (!body) throw new Error('Write the message first.')
  const kind = asMessageKind(input.kind)
  const members = await orgMembers(input.repId)
  const from = members.find((m) => m.id === input.fromId)
  const to = members.find((m) => m.id === input.toId)
  if (!from || !to) throw new Error('They are not on your team in Suite CXO.')
  const { data, error } = await supabase
    .from('member_messages')
    .insert({
      rep_id: input.repId,
      from_member_id: input.fromId,
      to_member_id: input.toId,
      body,
      kind,
      deliver_at: (input.deliverAt ?? new Date()).toISOString(),
      replied_to_id: input.repliedToId ?? null,
    })
    .select(COLS)
    .single()
  if (error) throw error
  const message = data as MemberMessage
  let todoId: string | null = null
  // A request goes straight onto their list; they can dismiss it there.
  if (kind === 'request' && !input.repliedToId) {
    const t = await addTodo(input.repId, input.toId, body.slice(0, 500), {
      source: 'message',
      source_label: memberLabel(from),
      kind: 'task',
      link_kind: 'message',
      link_id: message.id,
      link_label: null,
      due_date: dayIn(new Date(message.deliver_at), to.timezone || 'America/New_York'),
    }).catch((e) => {
      console.error('[member-messages] request to-do', e)
      return null
    })
    todoId = t?.id ?? null
  }
  return { message, todoId }
}

/** Reply to a message you received (or a reply in your own thread). Marks it read. */
export async function replyToMessage(repId: string, memberId: string, messageId: string, body: string) {
  const { data: orig, error } = await supabase.from('member_messages').select(COLS).eq('rep_id', repId).eq('id', messageId).maybeSingle()
  if (error) throw error
  const o = orig as MemberMessage | null
  if (!o || (o.to_member_id !== memberId && o.from_member_id !== memberId)) throw new Error('That message is not yours to answer.')
  const other = o.to_member_id === memberId ? o.from_member_id : o.to_member_id
  const root = o.replied_to_id ?? o.id
  const r = await sendMemberMessage({ repId, fromId: memberId, toId: other, body, kind: 'message', repliedToId: root })
  if (o.to_member_id === memberId && !o.read_at) await markRead(repId, memberId, o.id)
  return r.message
}

export async function markRead(repId: string, memberId: string, id: string) {
  const { error } = await supabase
    .from('member_messages')
    .update({ read_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('to_member_id', memberId)
    .eq('id', id)
    .is('read_at', null)
  if (error) throw error
}

export async function unreadCount(repId: string, memberId: string): Promise<number> {
  const { count, error } = await supabase
    .from('member_messages')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('to_member_id', memberId)
    .is('read_at', null)
    .lte('deliver_at', new Date().toISOString())
  if (error) throw error
  return count ?? 0
}

/** Newest delivered unread message to me, for the browser alert. */
export async function latestUnread(repId: string, memberId: string): Promise<{ from: string; body: string } | null> {
  const { data, error } = await supabase
    .from('member_messages')
    .select('body, from_member_id')
    .eq('rep_id', repId)
    .eq('to_member_id', memberId)
    .is('read_at', null)
    .lte('deliver_at', new Date().toISOString())
    .order('deliver_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { body: string; from_member_id: string }
  const from = (await orgMembers(repId)).find((m) => m.id === row.from_member_id)
  return { from: memberLabel(from), body: row.body }
}

/**
 * The Messages card: unread messages to me (delivered), and what I sent in
 * the last 14 days with read state and replies threaded under each.
 */
export async function listMessages(repId: string, memberId: string): Promise<{ inbox: MessageView[]; sent: MessageView[]; members: OrgMember[] }> {
  const nowIso = new Date().toISOString()
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const [members, inboxQ, sentQ] = await Promise.all([
    orgMembers(repId),
    supabase.from('member_messages').select(COLS).eq('rep_id', repId).eq('to_member_id', memberId).is('read_at', null).lte('deliver_at', nowIso).order('deliver_at', { ascending: false }).limit(50),
    supabase.from('member_messages').select(COLS).eq('rep_id', repId).eq('from_member_id', memberId).is('replied_to_id', null).gte('created_at', since).order('created_at', { ascending: false }).limit(30),
  ])
  if (inboxQ.error) throw inboxQ.error
  if (sentQ.error) throw sentQ.error
  const byId = new Map(members.map((m) => [m.id, m]))
  const view = (m: MemberMessage): MessageView => ({ ...m, from_name: memberLabel(byId.get(m.from_member_id)), to_name: memberLabel(byId.get(m.to_member_id)), replies: [] })
  const inbox = ((inboxQ.data ?? []) as MemberMessage[]).map(view)
  const sent = ((sentQ.data ?? []) as MemberMessage[]).map(view)
  // Threads: replies under each sent message; for an inbox reply, the message it answers.
  const roots = [...new Set([...sent.map((m) => m.id), ...inbox.map((m) => m.replied_to_id).filter((x): x is string => !!x)])]
  if (roots.length) {
    const [rq, pq] = await Promise.all([
      supabase.from('member_messages').select(COLS).eq('rep_id', repId).in('replied_to_id', sent.map((m) => m.id).concat('00000000-0000-0000-0000-000000000000')).lte('deliver_at', nowIso).order('created_at'),
      supabase.from('member_messages').select('id, body, from_member_id').eq('rep_id', repId).in('id', roots),
    ])
    const replies = ((rq.data ?? []) as MemberMessage[]).map(view)
    for (const s of sent) s.replies = replies.filter((r) => r.replied_to_id === s.id)
    const parents = new Map(((pq.data ?? []) as Array<{ id: string; body: string; from_member_id: string }>).map((p) => [p.id, p]))
    for (const m of inbox) {
      const p = m.replied_to_id ? parents.get(m.replied_to_id) : null
      m.parent = p ? { body: p.body, from_name: memberLabel(byId.get(p.from_member_id)) } : null
    }
  }
  return { inbox, sent, members: members.filter((m) => m.id !== memberId) }
}

/** For Mira: recent messages either way, newest first. */
export async function recentMessages(repId: string, memberId: string, box: 'inbox' | 'sent' | 'all', limit = 20) {
  const members = await orgMembers(repId)
  const byId = new Map(members.map((m) => [m.id, m]))
  let q = supabase.from('member_messages').select(COLS).eq('rep_id', repId).lte('deliver_at', box === 'sent' ? '9999-12-31' : new Date().toISOString())
  if (box === 'inbox') q = q.eq('to_member_id', memberId)
  else if (box === 'sent') q = q.eq('from_member_id', memberId)
  else q = q.or(`to_member_id.eq.${memberId},from_member_id.eq.${memberId}`)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return ((data ?? []) as MemberMessage[]).map((m) => ({
    id: m.id,
    from: memberLabel(byId.get(m.from_member_id)),
    to: memberLabel(byId.get(m.to_member_id)),
    mine: m.from_member_id === memberId,
    kind: m.kind,
    body: m.body,
    sent_at: m.created_at,
    delivers_at: m.deliver_at,
    read: !!m.read_at,
    reply_to: m.replied_to_id,
  }))
}
