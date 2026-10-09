/**
 * Today — the exec's home. One to-do list fed by: the exec (manual), their
 * meeting notes and recordings (Wispr, Plaud, Zapier inbound; extracted once
 * per note), partner emails they choose to keep, and board cards assigned to
 * them. Plus today's meetings, one line each.
 */
import Anthropic from '@anthropic-ai/sdk'
import { supabase } from '@/lib/supabase'
import { googleOauthConfigured, listCalendars, listConnectedGoogleAccounts, listUpcomingEvents } from '@/lib/google'
import { loadPartnersToday } from '@/lib/partnersToday'

export type Todo = {
  id: string
  body: string
  source: 'manual' | 'meeting' | 'partner' | 'mira'
  note_id: string | null
  meeting_title: string | null
  meeting_at: string | null
  partner_id: string | null
  partner_name: string | null
  thread_id: string | null
  done_at: string | null
  created_at: string
}

export type PartnerSuggestion = { partner_id: string; partner_name: string; thread_id: string; subject: string | null; snippet: string; at: string | null }

const COLS = 'id, body, source, note_id, meeting_title, meeting_at, partner_id, partner_name, thread_id, done_at, created_at'
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
  for (const k of ['note_id', 'meeting_title', 'meeting_at', 'partner_id', 'partner_name', 'thread_id', 'source_key'] as const) {
    if (t[k] !== undefined) out[k] = t[k]
  }
  return out
}

export async function updateTodo(repId: string, memberId: string, id: string, patch: { done?: boolean; body?: string }) {
  const row: Record<string, unknown> = {}
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

// ── Extraction from meeting notes ───────────────────────────────────────────

const MODEL = process.env.ANTHROPIC_MODEL_SMART || 'claude-sonnet-4-5'

async function extractActionItems(title: string, text: string): Promise<string[]> {
  if (!process.env.ANTHROPIC_API_KEY) return []
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 700,
    messages: [
      {
        role: 'user',
        content: `These are notes from a meeting the executive was in ("${title.slice(0, 120)}"). List the concrete follow-ups the executive owns or must chase: things to send, decide, call, schedule or check. Each one short, starting with a verb, naming the person or company when the notes do. Skip small talk and anything already done. Return ONLY a JSON array of strings (at most 8). Return [] if there are none.

Notes:
${text.slice(0, 12000)}`,
      },
    ],
  })
  const raw = msg.content[0]?.type === 'text' ? msg.content[0].text : ''
  const m = raw.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    const arr = JSON.parse(m[0]) as unknown[]
    return arr.map((x) => String(x).trim()).filter((s) => s.length > 2).slice(0, 8)
  } catch {
    return []
  }
}

/**
 * Turn new meeting notes into to-dos, once per note. Notes that already carry
 * action items use them as they are; the rest are read by Mira. Looks back
 * 21 days; at most `max` notes per call so the page stays quick.
 */
export async function scanMeetingNotes(repId: string, memberId: string, max = 4): Promise<{ scanned: number; added: number; pending: number }> {
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString()
  const { data: notes, error } = await supabase
    .from('plaud_notes')
    .select('id, title, summary, transcript, action_items, occurred_at, owner_member_id')
    .eq('rep_id', repId)
    .gte('occurred_at', since)
    .or(`owner_member_id.is.null,owner_member_id.eq.${memberId}`)
    .order('occurred_at', { ascending: false })
    .limit(60)
  if (error) throw error
  const all = (notes ?? []) as Array<{ id: string; title: string | null; summary: string | null; transcript: string | null; action_items: string[] | null; occurred_at: string }>
  if (!all.length) return { scanned: 0, added: 0, pending: 0 }
  const { data: done } = await supabase.from('cxo_todo_note_scans').select('note_id').in('note_id', all.map((n) => n.id))
  const seen = new Set(((done ?? []) as Array<{ note_id: string }>).map((d) => d.note_id))
  const todo = all.filter((n) => !seen.has(n.id))
  const batch = todo.slice(0, max)
  let added = 0
  await Promise.all(
    batch.map(async (n) => {
      const title = n.title || 'Meeting'
      let items = (n.action_items ?? []).map((s) => String(s).trim()).filter(Boolean)
      if (!items.length) {
        const text = [n.summary, n.transcript].filter(Boolean).join('\n\n')
        if (text.trim().length > 40) items = await extractActionItems(title, text).catch(() => [])
      }
      if (items.length) {
        const rows = items.slice(0, 12).map((body, i) => ({
          rep_id: repId,
          member_id: memberId,
          body: body.slice(0, 500),
          source: 'meeting',
          note_id: n.id,
          meeting_title: title.slice(0, 200),
          meeting_at: n.occurred_at,
          source_key: `note:${n.id}:${i}`,
        }))
        const { error: insErr } = await supabase.from('cxo_todos').insert(rows)
        if (!insErr) added += rows.length
        else if (insErr.code !== '23505') throw insErr
      }
      await supabase.from('cxo_todo_note_scans').upsert({ note_id: n.id, rep_id: repId, items: items.length })
    }),
  )
  return { scanned: batch.length, added, pending: Math.max(0, todo.length - batch.length) }
}

// ── Partner messages ────────────────────────────────────────────────────────

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

export type TodayMeeting = { id: string; title: string; start: string; end: string; allDay: boolean; link: string | null }

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
export async function todaysMeetings(repId: string, memberId: string, tz: string): Promise<TodayMeeting[] | null> {
  if (!googleOauthConfigured()) return null
  const accounts = (await listConnectedGoogleAccounts(repId).catch(() => [])).filter((a) => a.isShared || a.memberId === memberId)
  if (!accounts.length) return null
  const from = startOfTodayIn(tz)
  const to = new Date(from.getTime() + 86_400_000)
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
      out.push({ id: e.id, title: e.summary || 'Untitled meeting', start: e.start, end: e.end, allDay, link: (e as { conferenceLink?: string }).conferenceLink ?? e.htmlLink ?? null })
    }
  }
  out.sort((a, b) => (a.allDay === b.allDay ? a.start.localeCompare(b.start) : a.allDay ? -1 : 1))
  return out
}
