/**
 * Follow-up engine, the pure part (no DB). Shared by the Hetzner sweep,
 * Mira's follow-up tools, the reports and the tests.
 *
 * Mira chases every open commitment until it is closed:
 *   - requests: an in-app request message that became the recipient's to-do
 *   - board cards with an owner and a due date
 *   - meeting action items (to-dos from a meeting note)
 *
 * Rules (owner 10-10):
 *   - due today or tomorrow  -> one nudge to the person responsible
 *   - overdue                -> one escalation to the asker (or card owner)
 *   - done                   -> close it, tell the asker once
 * Every notice has a key; a key already sent is never sent again. Nothing is
 * planned when there is nothing to act on. Notices wait for the recipient's
 * working hours (members.timezone, default Mon–Fri 9–7) and for a pause to
 * end; no key is written until the notice actually goes out. Executive
 * assistants are never nudged, and never get escalations or close notes.
 */
import { OVERDUE_WINDOW_DAYS, dayInZone, daysBetween, dueDateLabel } from '@/lib/dueRemindersShared'

export type ItemKind = 'request' | 'card' | 'meeting'

export type FollowItem = {
  kind: ItemKind
  id: string
  rep_id: string
  title: string
  /** Member ids who owe it (to-do owner, or every member assignee of a card). */
  responsible: string[]
  /** Who is waiting on it: request sender, card creator, meeting sender. */
  asker: string | null
  due_date: string | null
  created_at: string
  done_at: string | null
  href: string
}

export type FollowMember = {
  id: string
  rep_id: string
  role: string | null
  is_active: boolean
  timezone: string | null
  display_name: string | null
  email: string | null
  settings: unknown
}

export type NoticeKind = 'nudge' | 'escalate' | 'close'

export type PlannedNotice = {
  rep_id: string
  member_id: string
  key: string
  kind: NoticeKind
  item_kind: ItemKind
  item_id: string
  title: string
  body: string
  href: string
  due_date: string | null
}

/** A request or meeting item with no due date is chased this many days after it was made. */
export const IMPLIED_DUE_DAYS = 3
/** An item younger than this is never nudged (they just got it). */
export const NUDGE_MIN_AGE_MS = 2 * 3600_000
/** A close note goes out only for items finished within this window. */
export const CLOSE_WINDOW_MS = 48 * 3600_000

const DEFAULT_TZ = 'America/New_York'

function settingsOf(m: Pick<FollowMember, 'settings'>): Record<string, unknown> {
  return m.settings && typeof m.settings === 'object' ? (m.settings as Record<string, unknown>) : {}
}

export function isAssistant(m: Pick<FollowMember, 'role'> | null | undefined): boolean {
  return String(m?.role ?? '') === 'assistant'
}

/** Working hours from members.settings.work_hours, default Mon–Fri 9:00–19:00. */
export function workHours(m: Pick<FollowMember, 'settings'>): { start: number; end: number; days: number[] } {
  const w = settingsOf(m).work_hours as { start?: unknown; end?: unknown; days?: unknown } | undefined
  const start = Number.isInteger(w?.start) && (w!.start as number) >= 0 && (w!.start as number) <= 23 ? (w!.start as number) : 9
  const end = Number.isInteger(w?.end) && (w!.end as number) >= 1 && (w!.end as number) <= 24 ? (w!.end as number) : 19
  const days = Array.isArray(w?.days) && (w!.days as unknown[]).every((d) => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6)
    ? (w!.days as number[])
    : [1, 2, 3, 4, 5]
  return { start, end: end > start ? end : 19, days }
}

/** Local weekday (0=Sun) and hour for an instant in a time zone. */
export function localParts(at: Date, tz: string): { weekday: number; hour: number; minute: number } {
  let zone = tz || DEFAULT_TZ
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
  } catch {
    zone = DEFAULT_TZ
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { weekday, hour: Number(get('hour')) % 24, minute: Number(get('minute')) }
}

export function inWorkingHours(m: Pick<FollowMember, 'settings' | 'timezone'>, now: Date): boolean {
  const { start, end, days } = workHours(m)
  const p = localParts(now, m.timezone || DEFAULT_TZ)
  return days.includes(p.weekday) && p.hour >= start && p.hour < end
}

/** members.settings.followups_paused_until (ISO); paused while it is in the future. */
export function isPaused(m: Pick<FollowMember, 'settings'>, now: Date): boolean {
  const until = settingsOf(m).followups_paused_until
  if (typeof until !== 'string') return false
  const t = Date.parse(until)
  return Number.isFinite(t) && t > now.getTime()
}

/**
 * Can this member get a notice now?
 *   'never' - not on the team, inactive, or an exec assistant
 *   'later' - paused, or outside their working hours (no key is written)
 *   'now'   - send
 */
export function notifyStatus(m: FollowMember | undefined, repId: string, now: Date): 'never' | 'later' | 'now' {
  if (!m || !m.is_active || m.rep_id !== repId || isAssistant(m)) return 'never'
  if (isPaused(m, now) || !inWorkingHours(m, now)) return 'later'
  return 'now'
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso.slice(0, 10) + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)

/** The due date Mira chases: the item's own, else (requests, meeting items) a few days after it was made. Cards need a real one. */
export function effectiveDue(item: Pick<FollowItem, 'kind' | 'due_date' | 'created_at'>): string | null {
  if (item.due_date) return item.due_date.slice(0, 10)
  if (item.kind === 'card') return null
  return addDays(item.created_at, IMPLIED_DUE_DAYS)
}

export function nameOf(m: Pick<FollowMember, 'display_name' | 'email'> | undefined | null): string {
  return (m?.display_name || m?.email || 'Someone').trim()
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'They'
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export const noticeKey = (kind: NoticeKind, item: Pick<FollowItem, 'kind' | 'id'>, memberId?: string) =>
  memberId ? `${kind}|${item.kind}|${item.id}|${memberId}` : `${kind}|${item.kind}|${item.id}`

const ITEM_WORD: Record<ItemKind, string> = { request: 'request', card: 'card', meeting: 'meeting item' }

/**
 * Every notice that should go out now. `sent` holds keys already delivered.
 * `cardNudgesCovered` (default true): board cards already get due-date
 * reminders from the daily reminder job, so the engine adds only the
 * escalation and the close note for cards (never a second nudge).
 */
export function planFollowups(input: {
  items: FollowItem[]
  members: FollowMember[]
  sent: Set<string>
  now: Date
  cardNudgesCovered?: boolean
}): PlannedNotice[] {
  const byId = new Map(input.members.map((m) => [m.id, m]))
  const now = input.now
  const cardCovered = input.cardNudgesCovered !== false
  const out: PlannedNotice[] = []
  const seen = new Set<string>()
  const push = (n: PlannedNotice) => {
    if (input.sent.has(n.key) || seen.has(n.key)) return
    seen.add(n.key)
    out.push(n)
  }

  for (const item of input.items) {
    const responsible = [...new Set(item.responsible)].filter((id) => byId.get(id)?.rep_id === item.rep_id)
    if (!responsible.length) continue
    const asker = item.asker ? byId.get(item.asker) : undefined
    const owers = responsible.filter((id) => id !== item.asker).map((id) => nameOf(byId.get(id)))
    const word = ITEM_WORD[item.kind]

    // Done: tell the asker once (only recent closes; never a backfill flood).
    if (item.done_at) {
      const doneMs = Date.parse(item.done_at)
      if (!Number.isFinite(doneMs) || now.getTime() - doneMs > CLOSE_WINDOW_MS) continue
      if (!asker || owers.length === 0) continue
      if (notifyStatus(asker, item.rep_id, now) !== 'now') continue
      push({
        rep_id: item.rep_id,
        member_id: asker.id,
        key: noticeKey('close', item),
        kind: 'close',
        item_kind: item.kind,
        item_id: item.id,
        title: `Done: ${item.title}`.slice(0, 300),
        body: `${joinNames(owers)} closed the ${word} you were waiting on.`,
        href: item.href,
        due_date: item.due_date,
      })
      continue
    }

    const due = effectiveDue(item)
    if (!due) continue

    // Due soon: one nudge to each person responsible.
    if (!(item.kind === 'card' && cardCovered) && now.getTime() - Date.parse(item.created_at) >= NUDGE_MIN_AGE_MS) {
      for (const id of responsible) {
        const m = byId.get(id)
        if (notifyStatus(m, item.rep_id, now) !== 'now') continue
        const left = daysBetween(dayInZone(now, m!.timezone || DEFAULT_TZ), due)
        if (left !== 0 && left !== 1) continue
        push({
          rep_id: item.rep_id,
          member_id: id,
          key: noticeKey('nudge', item, id),
          kind: 'nudge',
          item_kind: item.kind,
          item_id: item.id,
          title: `${left === 0 ? 'Due today' : 'Due tomorrow'}: ${item.title}`.slice(0, 300),
          body: asker && asker.id !== id ? `${nameOf(asker)} is waiting on this ${word}.` : `Your ${word} is due ${left === 0 ? 'today' : 'tomorrow'}.`,
          href: item.href,
          due_date: due,
        })
      }
    }

    // Overdue: one escalation to the asker, about the people who still owe it.
    if (asker && owers.length > 0 && notifyStatus(asker, item.rep_id, now) === 'now') {
      const left = daysBetween(dayInZone(now, asker.timezone || DEFAULT_TZ), due)
      if (left <= -1 && left >= -OVERDUE_WINDOW_DAYS) {
        push({
          rep_id: item.rep_id,
          member_id: asker.id,
          key: noticeKey('escalate', item),
          kind: 'escalate',
          item_kind: item.kind,
          item_id: item.id,
          title: `Overdue: ${item.title}`.slice(0, 300),
          body: `${joinNames(owers)} ${owers.length === 1 ? 'has' : 'have'} not closed this ${word}. It was due ${dueDateLabel(due)}.`,
          href: item.href,
          due_date: due,
        })
      }
    }
  }
  return out
}

// ── Views: who owes what (Mira's tools and the reports) ─────────────────────

export type OpenRow = { kind: ItemKind; id: string; title: string; owes: string[]; asker: string | null; due: string | null; days_left: number | null; overdue: boolean; href: string }

function openRow(item: FollowItem, byId: Map<string, FollowMember>, today: string): OpenRow {
  const due = effectiveDue(item)
  const left = due ? daysBetween(today, due) : null
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    owes: item.responsible.map((id) => nameOf(byId.get(id))),
    asker: item.asker ? nameOf(byId.get(item.asker)) : null,
    due,
    days_left: left,
    overdue: left !== null && left < 0,
    href: item.href,
  }
}

export type FollowView = 'waiting_on' | 'owed_by_me' | 'company' | 'overdue'

/**
 * Open items for one view. waiting_on: things the member asked for that
 * others still owe. owed_by_me: things the member owes. company / overdue:
 * everything open (or overdue) in the org, optionally for one person.
 * The caller decides who may see company-wide views.
 */
export function openItemsFor(input: { items: FollowItem[]; members: FollowMember[]; memberId: string; view: FollowView; personId?: string | null; now: Date; tz: string }): OpenRow[] {
  const byId = new Map(input.members.map((m) => [m.id, m]))
  const today = dayInZone(input.now, input.tz || DEFAULT_TZ)
  const open = input.items.filter((i) => !i.done_at)
  let pick: FollowItem[]
  if (input.view === 'waiting_on') pick = open.filter((i) => i.asker === input.memberId && i.responsible.some((r) => r !== input.memberId))
  else if (input.view === 'owed_by_me') pick = open.filter((i) => i.responsible.includes(input.memberId))
  else pick = open
  if (input.personId) pick = pick.filter((i) => i.responsible.includes(input.personId!))
  let rows = pick.map((i) => openRow(i, byId, today))
  if (input.view === 'overdue') rows = rows.filter((r) => r.overdue)
  return rows.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'))
}

/** Group open rows by the person who owes them. */
export function groupByPerson(rows: OpenRow[]): Array<{ person: string; rows: OpenRow[] }> {
  const map = new Map<string, OpenRow[]>()
  for (const r of rows) for (const p of r.owes.length ? r.owes : ['Unassigned']) map.set(p, [...(map.get(p) ?? []), r])
  return [...map.entries()].map(([person, rs]) => ({ person, rows: rs })).sort((a, b) => b.rows.length - a.rows.length || a.person.localeCompare(b.person))
}
