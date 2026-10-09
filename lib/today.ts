/**
 * Today — the exec's home. One to-do list fed by: the exec (manual), their
 * meeting notes and recordings (Wispr, Plaud, Zapier inbound; extracted once
 * per note), partner emails they choose to keep, and board cards assigned to
 * them. Plus today's meetings, one line each.
 */
import { supabase } from '@/lib/supabase'
import { googleOauthConfigured, listCalendars, listConnectedGoogleAccounts, listUpcomingEvents } from '@/lib/google'
import { loadPartnersToday } from '@/lib/partnersToday'

export type Todo = {
  id: string
  body: string
  source: 'manual' | 'meeting' | 'partner' | 'mira' | 'message'
  note_id: string | null
  meeting_title: string | null
  meeting_at: string | null
  partner_id: string | null
  partner_name: string | null
  thread_id: string | null
  done_at: string | null
  created_at: string
  kind: TodoKind
  priority: TodoPriority
  due_date: string | null
  assignee_partner_id: string | null
  assignee_name: string | null
  link_kind: 'partner' | 'agent' | 'meeting' | 'card' | 'message' | null
  link_id: string | null
  link_label: string | null
  link_url: string | null
  link_phone: string | null
  link_email: string | null
  mentions: number
  source_label: string | null
}

export const TODO_KINDS = ['task', 'email', 'call', 'prep', 'team', 'personal'] as const
export type TodoKind = (typeof TODO_KINDS)[number]
export const TODO_PRIORITIES = ['high', 'normal', 'low'] as const
export type TodoPriority = (typeof TODO_PRIORITIES)[number]
export const asKind = (v: unknown): TodoKind => (TODO_KINDS as readonly string[]).includes(v as string) ? (v as TodoKind) : 'task'
export const asPriority = (v: unknown): TodoPriority => (TODO_PRIORITIES as readonly string[]).includes(v as string) ? (v as TodoPriority) : 'normal'

export type PartnerSuggestion = { partner_id: string; partner_name: string; thread_id: string; subject: string | null; snippet: string; at: string | null }

const COLS =
  'id, body, source, note_id, meeting_title, meeting_at, partner_id, partner_name, thread_id, done_at, created_at, kind, priority, due_date, assignee_partner_id, assignee_name, link_kind, link_id, link_label, link_url, link_phone, link_email, mentions, source_label'
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export function todosMissing(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return !!e && (e.code === '42P01' || e.code === 'PGRST205')
}

/** Open items plus anything ticked today (so a tick does not vanish mid-glance). */
export async function listTodos(repId: string, memberId: string): Promise<Todo[]> {
  const since = new Date(Date.now() - 18 * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('cxo_todos')
    .select(COLS)
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .is('deleted_at', null)
    .or(`done_at.is.null,done_at.gte.${since}`)
    .order('position', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  return (data ?? []) as Todo[]
}

export async function addTodo(repId: string, memberId: string, body: string, extra: Partial<Todo> & { source_key?: string } = {}): Promise<Todo> {
  const text = clean(body, 500)
  if (!text) throw new Error('Write the to-do first.')
  const { data, error } = await supabase
    .from('cxo_todos')
    .insert({ rep_id: repId, member_id: memberId, body: text, source: extra.source ?? 'manual', ...stripTodo(extra) })
    .select(COLS)
    .single()
  if (error) throw error
  return data as Todo
}

function stripTodo(t: Partial<Todo> & { source_key?: string }) {
  const out: Record<string, unknown> = {}
  for (const k of ['note_id', 'meeting_title', 'meeting_at', 'partner_id', 'partner_name', 'thread_id', 'source_key', 'kind', 'priority', 'due_date', 'assignee_partner_id', 'assignee_name', 'link_kind', 'link_id', 'link_label', 'link_url', 'link_phone', 'link_email', 'source_label'] as const) {
    if (t[k] !== undefined) out[k] = t[k]
  }
  return out
}

export async function updateTodo(
  repId: string,
  memberId: string,
  id: string,
  patch: { done?: boolean; body?: string; kind?: unknown; priority?: unknown; due_date?: string | null; assignee_partner_id?: string | null; assignee_name?: string | null },
) {
  const row: Record<string, unknown> = {}
  if (patch.kind !== undefined) row.kind = asKind(patch.kind)
  if (patch.priority !== undefined) row.priority = asPriority(patch.priority)
  if (patch.due_date !== undefined) row.due_date = patch.due_date && /^\d{4}-\d{2}-\d{2}$/.test(patch.due_date) ? patch.due_date : null
  if (patch.assignee_partner_id !== undefined) {
    row.assignee_partner_id = patch.assignee_partner_id || null
    row.assignee_name = patch.assignee_partner_id ? clean(patch.assignee_name, 120) || null : null
  }
  if (patch.done !== undefined) row.done_at = patch.done ? new Date().toISOString() : null
  if (patch.body !== undefined) {
    const b = clean(patch.body, 500)
    if (b) row.body = b
  }
  const { error } = await supabase.from('cxo_todos').update(row).eq('rep_id', repId).eq('member_id', memberId).eq('id', id)
  if (error) throw error
}

/** Soft delete: an extracted item stays gone on the next scan. */
export async function deleteTodo(repId: string, memberId: string, id: string) {
  const { error } = await supabase.from('cxo_todos').update({ deleted_at: new Date().toISOString() }).eq('rep_id', repId).eq('member_id', memberId).eq('id', id)
  if (error) throw error
}

/** Recent partner emails not already on the list (null = no Gmail connected). */
export async function partnerSuggestions(repId: string, memberId: string, tz: string): Promise<PartnerSuggestion[] | null> {
  const t = await loadPartnersToday(repId, memberId, tz).catch(() => null)
  const inbound = t?.inbound ?? null
  if (!inbound) return inbound
  if (!inbound.length) return []
  const { data } = await supabase
    .from('cxo_todos')
    .select('thread_id')
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .in('thread_id', inbound.map((m) => m.thread_id))
  const have = new Set(((data ?? []) as Array<{ thread_id: string }>).map((r) => r.thread_id))
  return inbound.filter((m) => !have.has(m.thread_id)).slice(0, 4)
}

export async function addFromPartner(repId: string, memberId: string, s: { partner_id: string; partner_name: string; thread_id: string; body: string }) {
  const { data: p } = await supabase.from('cxo_partners').select('id, name').eq('rep_id', repId).eq('id', s.partner_id).maybeSingle()
  if (!p) throw new Error('That partner is not on this account.')
  return addTodo(repId, memberId, s.body, {
    source: 'partner',
    partner_id: (p as { id: string }).id,
    partner_name: (p as { name: string }).name,
    thread_id: clean(s.thread_id, 200) || null,
    source_key: s.thread_id ? `thread:${clean(s.thread_id, 200)}` : undefined,
  })
}

// ── Today's meetings, one line each ─────────────────────────────────────────

export type TodayMeeting = { id: string; title: string; start: string; end: string; allDay: boolean; link: string | null; htmlLink: string | null; attendees: Array<{ email: string; name: string | null }> }

function startOfTodayIn(tz: string): Date {
  const parts = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
    const g = (t: string) => Number(p.find((x) => x.type === t)?.value ?? '0')
    return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour') % 24, mm: g('minute') }
  }
  const now = parts(new Date())
  const wall = Date.UTC(now.y, now.m - 1, now.d)
  const l = parts(new Date(wall))
  const offset = Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm) - wall
  return new Date(wall - offset)
}

/** null = no calendar connected. */
export async function todaysMeetings(repId: string, memberId: string, tz: string, days = 1): Promise<TodayMeeting[] | null> {
  if (!googleOauthConfigured()) return null
  const accounts = (await listConnectedGoogleAccounts(repId).catch(() => [])).filter((a) => a.isShared || a.memberId === memberId)
  if (!accounts.length) return null
  const from = startOfTodayIn(tz)
  const to = new Date(from.getTime() + days * 86_400_000)
  const lists = await Promise.all(accounts.map((a) => listCalendars(repId, { memberId: a.memberId, accountId: a.accountId }).catch(() => null)))
  const sources = accounts.flatMap((a, i) => (lists[i] ?? []).map((c) => ({ a, calendarId: c.id })))
  const results = await Promise.all(
    sources.slice(0, 12).map((s) =>
      listUpcomingEvents(repId, { fromIso: from.toISOString(), toIso: to.toISOString(), maxResults: 50, timeZone: tz, memberId: s.a.memberId, accountId: s.a.accountId, calendarId: s.calendarId }).catch(() => null),
    ),
  )
  const out: TodayMeeting[] = []
  const seen = new Set<string>()
  for (const list of results) {
    for (const e of list ?? []) {
      if (e.eventType && e.eventType !== 'default') continue
      const allDay = e.start.length === 10
      const key = `${e.start}|${e.summary}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({
        id: e.id,
        title: e.summary || 'Untitled meeting',
        start: e.start,
        end: e.end,
        allDay,
        link: (e as { conferenceLink?: string }).conferenceLink ?? e.htmlLink ?? null,
        htmlLink: e.htmlLink ?? null,
        attendees: (e.attendees ?? []).filter((a) => a.email).map((a) => ({ email: a.email.toLowerCase(), name: a.displayName ?? null })),
      })
    }
  }
  out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1))
  return out
}
