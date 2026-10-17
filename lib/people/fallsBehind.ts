/**
 * "Someone fell behind" (Suite CXO, Ciao): the database half. Runs on the
 * Hetzner worker (hetzner-worker/index.ts, CXO_FALLS_BEHIND_EVERY_N_TICKS).
 *
 *  - Weekdays from 9am in the company's zone, once a day per company: every
 *    employee's quotas (quotaLine pace) and bonus plan (payoutFor status) are
 *    checked, the same rules as employee_quota_status / bonus_on_track.
 *  - Someone newly behind, or worse than last told: their manager gets one
 *    in-app notice with the numbers and a 1:1 talking point. "Add to 1:1"
 *    puts the talking point on that person's 1:1 agenda (kind 'agenda').
 *  - No manager with a login: the owner and admins. Never the person, never
 *    their peers. Bonus lines only for readers who may see comp, and never a
 *    dollar of bonus or pay.
 *
 * Rules kept here:
 *  - Scoped: every read and write carries rep_id.
 *  - In-app only. No email, text or push. Model-free, cost 0.
 *  - Once per behind-episode: cxo_behind_watch holds what was last told; each
 *    notice key (behind-<week>-<employee>-<member>) is a lock too.
 *  - Kill switch CXO_FALLS_BEHIND=off. Until the table exists, a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { insertNotices } from '@/lib/followups/engine'
import { isPaused } from '@/lib/followups/shared'
import { NoticeActionRefused } from '@/lib/followups/noticeActions'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { loadEmployees } from '@/lib/employees/data'
import { canViewComp, elapsedShare, employeeSnapshot, monthKey, payoutsForAll, quarterKey, type PayoutLine } from '@/lib/employees/shared'
import { isoWeekKey, localParts } from '@/lib/agent/weeklyLearningsSchedule'
import { dayWords } from './shared'
import {
  EXEC_ROLES,
  behindItems,
  behindKey,
  composeNotice,
  decide,
  isCheckTime,
  recipientsFor,
  talkingPointFrom,
  type BonusFacts,
  type MemberLite,
  type WatchState,
} from './fallsBehindShared'

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
class TableMissing extends Error {}

export function fallsBehindOn(env: Record<string, string | undefined> = process.env): boolean {
  return String(env.CXO_FALLS_BEHIND ?? '').trim().toLowerCase() !== 'off'
}

type TenantRow = { id: string; brand: string | null; timezone: string | null }
type MemberRow = { id: string; email: string | null; display_name: string | null; role: string | null; settings: Record<string, unknown> | null; is_active: boolean }
type WatchRow = WatchState & { employee_id: string; notified_worst: number | string | null }

const dayIn = (now: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const sameState = (a: WatchState | null, b: WatchState) =>
  !!a && a.behind === b.behind && a.last_week === b.last_week && (a.notified_worst ?? null) === (b.notified_worst ?? null) && a.notified_items.join('|') === b.notified_items.join('|')

/** Companies already checked today in this process (the watch table is the real lock). */
const checked = new Map<string, string>()

export type FallsBehindTickResult = { tenants: number; checked: number; behind: number; written: number; errors: number }

async function runTenant(tenant: TenantRow, now: Date, out: FallsBehindTickResult): Promise<void> {
  const tz = tenant.timezone || 'America/New_York'
  if (!isCheckTime(localParts(now, tz))) return
  const today = dayIn(now, tz)
  if (checked.get(tenant.id) === today) return
  const week = isoWeekKey(now, tz)

  const { data: ws, error: wErr } = await supabase.from('cxo_behind_watch').select('employee_id, behind, notified_items, notified_worst, last_week').eq('rep_id', tenant.id).limit(5000)
  if (wErr) {
    if (missing(wErr)) throw new TableMissing()
    throw new Error(wErr.message)
  }
  const watch = new Map(((ws ?? []) as WatchRow[]).map((w) => [w.employee_id, { ...w, notified_items: w.notified_items ?? [], notified_worst: w.notified_worst == null ? null : Number(w.notified_worst) } as WatchState]))

  const data = await loadEmployees(tenant.id, true, today)
  checked.set(tenant.id, today)
  if (!data.employees.length || !data.kpis.length) return
  out.tenants++

  const { data: ms, error: mErr } = await supabase.from('members').select('id, email, display_name, role, settings, is_active').eq('rep_id', tenant.id).eq('is_active', true).neq('role', 'assistant').limit(1000)
  if (mErr) throw new Error(mErr.message)
  const members = (ms ?? []) as MemberRow[]
  const byId = new Map(members.map((m) => [m.id, m]))
  const lite: MemberLite[] = members.map((m) => ({ id: m.id, role: m.role, employee_only: isEmployeeOnlyMember(m, tenant) }))

  const bonusBy = new Map<string, BonusFacts[]>()
  for (const key of [monthKey(today), quarterKey(today)]) {
    const elapsed = elapsedShare(key, today)
    for (const l of payoutsForAll(data, key, today) as PayoutLine[]) bonusBy.set(l.employee_id, [...(bonusBy.get(l.employee_id) ?? []), { period_key: l.period_key, status: l.status, overallAtt: l.overallAtt, elapsed }])
  }

  for (const emp of data.employees) {
    try {
      out.checked++
      const snap = employeeSnapshot(emp, data, today)
      const items = behindItems(snap.quotas, bonusBy.get(emp.id) ?? [])
      if (items.length) out.behind++
      const prev = watch.get(emp.id) ?? null
      const d = decide(prev, items, week)
      let store = !sameState(prev, d.next) && (!!prev || d.next.behind)
      if (d.notify) {
        const to = recipientsFor(emp, data.employees, lite)
          .map((id) => byId.get(id))
          .filter((m): m is MemberRow => !!m && !isPaused(m, now))
        const rows = to
          .map((m) => {
            const text = composeNotice(emp.name, items, { comp: canViewComp(m) })
            if (!text) return null
            return {
              rep_id: tenant.id,
              member_id: m.id,
              key: behindKey(week, emp.id, m.id),
              kind: 'report',
              item_kind: 'employee',
              item_id: emp.id,
              title: text.title.slice(0, 300),
              body: text.body.slice(0, 8000),
              href: isEmployeeOnlyMember(m, tenant) ? '/dashboard/me' : '/dashboard/employees?tab=oneonones',
              due_date: null,
            }
          })
          .filter((r): r is NonNullable<typeof r> => !!r)
        // Nobody could be told this time: keep the old row so it is due again next check.
        store = rows.length > 0
        if (rows.length) out.written += (await insertNotices(rows)).length
      }
      if (store) {
        const { error } = await supabase
          .from('cxo_behind_watch')
          .upsert([{ rep_id: tenant.id, employee_id: emp.id, ...d.next, updated_at: now.toISOString() }], { onConflict: 'rep_id,employee_id' })
        if (error) {
          if (missing(error)) throw new TableMissing()
          throw new Error(error.message)
        }
      }
    } catch (err) {
      if (err instanceof TableMissing) throw err
      out.errors++
      console.error('[falls-behind] employee', tenant.id, emp.id, err instanceof Error ? err.message : err)
    }
  }
}

/** One check across every Suite CXO company. Never throws. */
export async function runFallsBehindTick(now = new Date()): Promise<FallsBehindTickResult> {
  const out: FallsBehindTickResult = { tenants: 0, checked: 0, behind: 0, written: 0, errors: 0 }
  if (!fallsBehindOn()) return out
  const { data, error } = await supabase.from('reps').select('id, brand, timezone').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[falls-behind] tenants', error.message)
    out.errors++
    return out
  }
  for (const tenant of (data ?? []) as TenantRow[]) {
    try {
      await runTenant(tenant, now, out)
    } catch (err) {
      if (err instanceof TableMissing) return out
      out.errors++
      console.error('[falls-behind] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}

const first = (name: string) => name.trim().split(/\s+/)[0] || name

/**
 * "Add to 1:1": the notice's talking point goes on that person's 1:1 agenda.
 * Only their manager, whoever runs their 1:1, or the owner/admin. Sets up
 * the 1:1 (no date yet) when there is none.
 */
export async function addTalkingPointToOneOnOne(repId: string, memberId: string, employeeId: string, body: string | null): Promise<string> {
  const talk = talkingPointFrom(body)
  if (!talk || !employeeId) throw new NoticeActionRefused('Nothing to add.')
  const [{ data: emp }, { data: me }] = await Promise.all([
    supabase.from('cxo_employees').select('id, name, manager_id, member_id').eq('rep_id', repId).eq('id', employeeId).eq('active', true).maybeSingle(),
    supabase.from('members').select('id, role, display_name, email').eq('rep_id', repId).eq('id', memberId).maybeSingle(),
  ])
  const person = emp as { id: string; name: string; manager_id: string | null; member_id: string | null } | null
  const viewer = me as { id: string; role: string | null; display_name: string | null; email: string | null } | null
  if (!person || !viewer) throw new NoticeActionRefused('That person is no longer on the team.')

  const { data: ooRow, error: ooErr } = await supabase.from('cxo_one_on_ones').select('id, next_date, manager_member_id').eq('rep_id', repId).eq('employee_id', person.id).maybeSingle()
  if (ooErr) {
    if (missing(ooErr)) throw new NoticeActionRefused('1:1s are still being switched on for your company. Try again shortly.')
    throw new Error(ooErr.message)
  }
  let oo = ooRow as { id: string; next_date: string | null; manager_member_id: string | null } | null

  let mayRun = (EXEC_ROLES as readonly string[]).includes(String(viewer.role)) || (!!oo?.manager_member_id && oo.manager_member_id === memberId)
  if (!mayRun && person.manager_id) {
    const { data: mgr } = await supabase.from('cxo_employees').select('member_id').eq('rep_id', repId).eq('id', person.manager_id).maybeSingle()
    mayRun = (mgr as { member_id: string | null } | null)?.member_id === memberId
  }
  if (!mayRun || person.member_id === memberId) throw new NoticeActionRefused('That 1:1 is not yours.')

  const myName = (viewer.display_name || '').trim() || viewer.email || 'Manager'
  if (!oo) {
    const { data: made, error } = await supabase
      .from('cxo_one_on_ones')
      .upsert([{ rep_id: repId, employee_id: person.id, cadence: 'biweekly', next_date: null, manager_member_id: memberId, manager_name: myName }], { onConflict: 'rep_id,employee_id', ignoreDuplicates: false })
      .select('id, next_date, manager_member_id')
      .single()
    if (error) throw new Error(error.message)
    oo = made as typeof oo
  }
  const ooId = oo!.id
  const { data: have } = await supabase.from('cxo_one_on_one_items').select('id').eq('rep_id', repId).eq('one_on_one_id', ooId).eq('kind', 'agenda').eq('body', talk).is('done_at', null).limit(1)
  const when = oo!.next_date ? `your ${dayWords(oo!.next_date)} 1:1 with ${first(person.name)}` : `your 1:1 with ${first(person.name)}`
  if (have?.length) return `Already on ${when}.`
  const { error: iErr } = await supabase.from('cxo_one_on_one_items').insert({ rep_id: repId, one_on_one_id: ooId, kind: 'agenda', body: talk, author_member_id: memberId, author_name: myName })
  if (iErr) throw new Error(iErr.message)
  return oo!.next_date ? `Added to ${when}.` : `Added to ${when}. Pick a date on the 1:1s tab.`
}
