/**
 * Weekly status update (Suite CXO, Ciao): the database half. Runs on the
 * Hetzner worker (hetzner-worker/index.ts, CXO_WEEKLY_STATUS_EVERY_N_TICKS).
 *
 *  - Friday, from 2pm in each person's own zone: Ciao drafts their week from
 *    their own rows (to-dos done, board cards closed, meetings they own,
 *    open work, requests nobody answered) into cxo_weekly_status and asks in
 *    one in-app notice. "Looks right" confirms it in one tap; the status card
 *    on Today / their page edits it.
 *  - Monday, from 8am in the company's zone: the owner and admins get one
 *    rollup of last week, blockers first, then each team.
 *
 * Rules kept here:
 *  - Person-scoped: every read and write carries rep_id AND the member's id.
 *  - In-app only. No email, text or push. Model-free, cost 0.
 *  - Once per person per ISO week: (rep_id, member_id, week) is unique, and
 *    each notice key is a lock too (unique rep_id + key).
 *  - Kill switch CXO_WEEKLY_STATUS=off. Until the table exists, a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices } from '@/lib/followups/engine'
import { isPaused, nameOf } from '@/lib/followups/shared'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { isoWeekKey } from '@/lib/agent/weeklyLearningsSchedule'
import {
  WEEKLY_ROLLUP_ROLES,
  askNoticeText,
  composePrefill,
  composeRollup,
  isAskTime,
  isRollupTime,
  lastWeekKey,
  rollupKey,
  statusKey,
  teamName,
  weekStartIso,
  type RollupPerson,
  type StatusLines,
  type TeamFacts,
} from './weeklyShared'

export const WEEKLY_STATUS_ANCHOR = 'weekly-status'

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
class TableMissing extends Error {}

export function weeklyStatusOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CXO_WEEKLY_STATUS ?? '').trim().toLowerCase() !== 'off'
}

type TenantRow = { id: string; brand: string | null; timezone: string | null; settings: unknown }
type MemberRow = { id: string; rep_id: string; email: string | null; display_name: string | null; role: string | null; timezone: string | null; settings: unknown; is_active: boolean }

export type WeeklyStatusRow = StatusLines & {
  id: string
  rep_id: string
  member_id: string
  week: string
  asked_at: string
  confirmed_at: string | null
  edited: boolean
}
const COLS = 'id, rep_id, member_id, week, moved, next, blockers, asked_at, confirmed_at, edited'

const homeHref = (member: MemberRow, tenant: TenantRow) => `${isEmployeeOnlyMember(member, tenant) ? '/dashboard/me' : '/dashboard'}#${WEEKLY_STATUS_ANCHOR}`

/** Their week so far, from their own rows only. */
export async function gatherPrefill(repId: string, memberId: string, sinceIso: string, names: Map<string, string>, now = new Date()): Promise<StatusLines> {
  const twoDaysAgo = new Date(now.getTime() - 2 * 86_400_000).toISOString()
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString()
  const [doneT, openT, links, notes, sent] = await Promise.all([
    supabase.from('cxo_todos').select('body').eq('rep_id', repId).eq('member_id', memberId).is('deleted_at', null).gte('done_at', sinceIso).order('done_at', { ascending: true }).limit(40),
    supabase.from('cxo_todos').select('body, due_date, priority').eq('rep_id', repId).eq('member_id', memberId).is('deleted_at', null).is('done_at', null).limit(100),
    supabase.from('cxo_board_card_assignees').select('card_id').eq('rep_id', repId).eq('member_id', memberId).limit(500),
    supabase.from('plaud_notes').select('title').eq('rep_id', repId).eq('owner_member_id', memberId).gte('occurred_at', sinceIso).lte('occurred_at', now.toISOString()).order('occurred_at', { ascending: true }).limit(20),
    supabase.from('member_messages').select('id, to_member_id, body').eq('rep_id', repId).eq('from_member_id', memberId).eq('kind', 'request').gte('created_at', twoWeeksAgo).lte('created_at', twoDaysAgo).limit(50),
  ])
  const cardIds = ((links.data ?? []) as Array<{ card_id: string }>).map((l) => l.card_id)
  let doneCards: Array<{ title: string }> = []
  let openCards: Array<{ title: string; due_date: string | null }> = []
  if (cardIds.length) {
    const ids = cardIds.slice(0, 300)
    const [d, o] = await Promise.all([
      supabase.from('cxo_board_cards').select('title').eq('rep_id', repId).in('id', ids).gte('done_at', sinceIso).limit(40),
      supabase.from('cxo_board_cards').select('title, due_date').eq('rep_id', repId).in('id', ids).is('done_at', null).limit(100),
    ])
    doneCards = (d.data ?? []) as typeof doneCards
    openCards = (o.data ?? []) as typeof openCards
  }
  // A request counts as answered once anyone replied to it.
  const asks = (sent.data ?? []) as Array<{ id: string; to_member_id: string; body: string }>
  let waitingOn: Array<{ to: string; body: string }> = []
  if (asks.length) {
    const { data: replies } = await supabase.from('member_messages').select('replied_to_id').eq('rep_id', repId).in('replied_to_id', asks.map((a) => a.id))
    const answered = new Set(((replies ?? []) as Array<{ replied_to_id: string }>).map((r) => r.replied_to_id))
    waitingOn = asks.filter((a) => !answered.has(a.id)).map((a) => ({ to: names.get(a.to_member_id) ?? 'a colleague', body: a.body.slice(0, 160) }))
  }
  return composePrefill({
    doneTodos: (doneT.data ?? []) as Array<{ body: string }>,
    doneCards,
    meetings: (notes.data ?? []) as Array<{ title: string | null }>,
    openTodos: (openT.data ?? []) as Array<{ body: string; due_date: string | null; priority: string | null }>,
    openCards,
    waitingOn,
  })
}

/** Keys already handled in this process. */
const handled = new Set<string>()
let handledWeek = ''

async function askMember(tenant: TenantRow, member: MemberRow, names: Map<string, string>, now: Date): Promise<number> {
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  if (!isAskTime(now, tz) || isPaused(member, now)) return 0
  const week = isoWeekKey(now, tz)
  const key = statusKey(week, member.id)
  if (handled.has(key)) return 0
  const { data: have, error: hErr } = await supabase.from('cxo_weekly_status').select('id').eq('rep_id', tenant.id).eq('member_id', member.id).eq('week', week).limit(1)
  if (hErr) {
    if (missing(hErr)) throw new TableMissing()
    throw new Error(hErr.message)
  }
  if (have?.length) {
    handled.add(key)
    return 0
  }
  const prefill = await gatherPrefill(tenant.id, member.id, weekStartIso(now, tz), names, now)
  const { data: ins, error: iErr } = await supabase
    .from('cxo_weekly_status')
    .upsert([{ rep_id: tenant.id, member_id: member.id, week, ...prefill, prefill, asked_at: now.toISOString() }], { onConflict: 'rep_id,member_id,week', ignoreDuplicates: true })
    .select('id')
  if (iErr) {
    if (missing(iErr)) throw new TableMissing()
    throw new Error(iErr.message)
  }
  handled.add(key)
  const row = ((ins ?? []) as Array<{ id: string }>)[0]
  if (!row) return 0 // another check got there first
  const text = askNoticeText(prefill)
  const rows = await insertNotices([
    { rep_id: tenant.id, member_id: member.id, key, kind: 'report', item_kind: 'report', item_id: row.id, title: text.title.slice(0, 300), body: text.body.slice(0, 8000), href: homeHref(member, tenant), due_date: null },
  ])
  return rows.length
}

async function teamsFor(repId: string, memberIds: string[]): Promise<Map<string, TeamFacts>> {
  const out = new Map<string, TeamFacts>()
  if (!memberIds.length) return out
  const { data, error } = await supabase.from('cxo_employees').select('id, member_id, name, department, manager_id').eq('rep_id', repId).limit(2000)
  if (error) return out
  const emps = (data ?? []) as Array<{ id: string; member_id: string | null; name: string; department: string | null; manager_id: string | null }>
  const byId = new Map(emps.map((e) => [e.id, e]))
  for (const e of emps) {
    if (!e.member_id || !memberIds.includes(e.member_id)) continue
    out.set(e.member_id, { department: e.department, manager: e.manager_id ? byId.get(e.manager_id)?.name ?? null : null })
  }
  return out
}

/** The statuses of one ISO week with each person's name and team. Exec-side reads (rollup, agenda). */
export async function weekRollupPeople(repId: string, week: string, names: Map<string, string>): Promise<Array<RollupPerson & { member_id: string }>> {
  const { data, error } = await supabase.from('cxo_weekly_status').select(COLS).eq('rep_id', repId).eq('week', week).limit(2000)
  if (missing(error)) return []
  if (error) throw new Error(`cxo_weekly_status: ${error.message}`)
  const rows = ((data ?? []) as WeeklyStatusRow[]).filter((r) => names.has(r.member_id))
  const teams = await teamsFor(repId, rows.map((r) => r.member_id))
  return rows.map((r) => ({
    member_id: r.member_id,
    name: names.get(r.member_id) ?? 'Someone',
    team: teamName(teams.get(r.member_id)),
    moved: r.moved ?? [],
    next: r.next ?? [],
    blockers: r.blockers ?? [],
    confirmed: !!r.confirmed_at,
  }))
}

async function rollupTenant(tenant: TenantRow, members: MemberRow[], names: Map<string, string>, now: Date): Promise<number> {
  const tz = tenant.timezone || 'America/New_York'
  if (!isRollupTime(now, tz)) return 0
  const week = lastWeekKey(now, tz)
  const execs = members.filter((m) => (WEEKLY_ROLLUP_ROLES as readonly string[]).includes(String(m.role)))
  const todo = execs.filter((m) => !handled.has(rollupKey(week, m.id)))
  if (!todo.length) return 0
  const { data: have, error: hErr } = await supabase.from('cxo_followup_notices').select('key').eq('rep_id', tenant.id).in('key', todo.map((m) => rollupKey(week, m.id)))
  if (hErr) {
    if (missing(hErr)) throw new TableMissing()
    throw new Error(hErr.message)
  }
  const sent = new Set(((have ?? []) as Array<{ key: string }>).map((h) => h.key))
  const due = todo.filter((m) => !sent.has(rollupKey(week, m.id)))
  for (const m of todo) handled.add(rollupKey(week, m.id))
  if (!due.length) return 0
  const people = await weekRollupPeople(tenant.id, week, names)
  const text = composeRollup(week, people)
  if (!text) return 0
  const rows = await insertNotices(
    due.map((m) => ({
      rep_id: tenant.id,
      member_id: m.id,
      key: rollupKey(week, m.id),
      kind: 'report',
      item_kind: 'report',
      item_id: null,
      title: text.title.slice(0, 300),
      body: text.body.slice(0, 8000),
      href: `/dashboard#${WEEKLY_STATUS_ANCHOR}`,
      due_date: null,
    })),
  )
  return rows.length
}

export type WeeklyStatusTickResult = { tenants: number; asked: number; rollups: number; errors: number }

/** One check across every Suite CXO tenant. Never throws. */
export async function runWeeklyStatusTick(now = new Date()): Promise<WeeklyStatusTickResult> {
  const out: WeeklyStatusTickResult = { tenants: 0, asked: 0, rollups: 0, errors: 0 }
  if (!weeklyStatusOn()) return out
  const week = isoWeekKey(now, 'UTC')
  if (handledWeek !== week) {
    handled.clear()
    handledWeek = week
  }
  const { data, error } = await supabase.from('reps').select('id, brand, timezone, settings').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[weekly-status] tenants', error.message)
    out.errors++
    return out
  }
  for (const tenant of (data ?? []) as TenantRow[]) {
    try {
      const { data: ms, error: mErr } = await supabase
        .from('members')
        .select('id, rep_id, email, display_name, role, timezone, settings, is_active')
        .eq('rep_id', tenant.id)
        .eq('is_active', true)
        .neq('role', 'assistant')
        .limit(1000)
      if (mErr) throw new Error(mErr.message)
      const members = (ms ?? []) as MemberRow[]
      if (!members.length) continue
      out.tenants++
      const names = new Map(members.map((m) => [m.id, nameOf(m)]))
      for (const member of members) {
        try {
          out.asked += await askMember(tenant, member, names, now)
        } catch (err) {
          if (err instanceof TableMissing) throw err
          out.errors++
          console.error('[weekly-status] member', tenant.id, member.id, err instanceof Error ? err.message : err)
        }
      }
      out.rollups += await rollupTenant(tenant, members, names, now)
    } catch (err) {
      if (err instanceof TableMissing) return out
      out.errors++
      console.error('[weekly-status] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** The signed-in member's status for this ISO week (Friday's ask stays through Sunday). Their own row only. */
export async function getMyStatus(repId: string, memberId: string, now = new Date(), tz = 'America/New_York'): Promise<WeeklyStatusRow | null> {
  const { data, error } = await supabase.from('cxo_weekly_status').select(COLS).eq('rep_id', repId).eq('member_id', memberId).eq('week', isoWeekKey(now, tz)).limit(1)
  if (missing(error)) return null
  if (error) throw new Error(`cxo_weekly_status: ${error.message}`)
  return ((data ?? []) as WeeklyStatusRow[])[0] ?? null
}

async function clearAsk(repId: string, memberId: string, week: string) {
  const { error } = await supabase
    .from('cxo_followup_notices')
    .update({ read_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('key', statusKey(week, memberId))
    .is('read_at', null)
  if (error && !missing(error)) console.error('[weekly-status] clear ask', error.message)
}

/** One tap: their draft as it stands goes to the rollup. */
export async function confirmMyStatus(repId: string, memberId: string, id: string): Promise<WeeklyStatusRow | null> {
  const { data, error } = await supabase
    .from('cxo_weekly_status')
    .update({ confirmed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('id', id)
    .select(COLS)
  if (error) throw new Error(`cxo_weekly_status: ${error.message}`)
  const row = ((data ?? []) as WeeklyStatusRow[])[0] ?? null
  if (row) await clearAsk(repId, memberId, row.week)
  return row
}

/** Their edit: replaces the three lists and confirms. */
export async function saveMyStatus(repId: string, memberId: string, id: string, lines: StatusLines): Promise<WeeklyStatusRow | null> {
  const at = new Date().toISOString()
  const { data, error } = await supabase
    .from('cxo_weekly_status')
    .update({ moved: lines.moved, next: lines.next, blockers: lines.blockers, edited: true, confirmed_at: at, updated_at: at })
    .eq('rep_id', repId)
    .eq('member_id', memberId)
    .eq('id', id)
    .select(COLS)
  if (error) throw new Error(`cxo_weekly_status: ${error.message}`)
  const row = ((data ?? []) as WeeklyStatusRow[])[0] ?? null
  if (row) await clearAsk(repId, memberId, row.week)
  return row
}
