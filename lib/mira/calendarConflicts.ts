/**
 * Flag Calendar Conflicts and Overbooked Days (Suite CXO), the server side.
 * Runs on the Hetzner worker (hetzner-worker/index.ts), checked about every
 * 10 minutes; each person is looked at once a day, from 7am their time on
 * their work days.
 *
 * For each Suite CXO tenant (reps.brand = 'cxo') and each active person (not
 * an exec assistant) with a connected Google calendar: look a week ahead at
 * the calendars they own (same account rule as Today), and write one in-app
 * notice per issue (lib/mira/calendarConflictsShared): double-booked, a day
 * with no break, a meeting with no video link, a group meeting with no agenda.
 * Each notice carries a one-tap fix that opens Ciao with the exact ask; Ciao
 * uses the calendar tools and waits for their yes before changing anything.
 *
 * Rules kept here:
 *  - Person-scoped: every read and write carries rep_id AND the member's id.
 *  - In-app only. No email, text or push. Only when there is an issue.
 *  - One notice per issue per person: the key is the lock (unique rep_id +
 *    key). A notice they dismissed is not sent again; one whose issue went
 *    away (fixed, or the meeting passed) is cleared.
 *  - Model-free, cost 0. No new tables; until cxo_followup_notices exists
 *    this is a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { todaysMeetings } from '@/lib/today'
import { insertNotices } from '@/lib/followups/engine'
import { isPaused } from '@/lib/followups/shared'
import { CAL_CONFLICT_PREFIX, joinIds } from '@/lib/followups/noticeActionsShared'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { dayInZone } from '@/lib/dueRemindersShared'
import { wrapSchedule } from './dayWrapShared'
import { LOOKAHEAD_DAYS, MAX_NEW_PER_DAY, detectIssues } from './calendarConflictsShared'

export type CalendarConflictResult = { tenants: number; members: number; checked: number; written: number; cleared: number; errors: number }

/** Local hour from which the day's check runs. */
export const CHECK_FROM_HOUR = 7

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
class TableMissing extends Error {}

type TenantRow = { id: string; brand: string | null; timezone: string | null; settings: unknown }
type MemberRow = { id: string; rep_id: string; email: string | null; display_name: string | null; role: string | null; timezone: string | null; settings: unknown; is_active: boolean }

/** Person + local day already checked in this process. */
const checked = new Set<string>()
let checkedDay = ''

function localHourAndWeekday(now: Date, tz: string): { hour: number; weekday: number } {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(now)
  const hour = Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24
  const wd = p.find((x) => x.type === 'weekday')?.value ?? 'Mon'
  return { hour, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd) }
}

/** Is it time for this person's daily check? */
export function isCheckTime(member: { settings: unknown }, tz: string, now: Date): boolean {
  const { hour, weekday } = localHourAndWeekday(now, tz)
  return hour >= CHECK_FROM_HOUR && wrapSchedule(member as MemberRow).days.includes(weekday)
}

async function checkMember(tenant: TenantRow, member: MemberRow, now: Date): Promise<{ written: number; cleared: number; ran: boolean }> {
  const none = { written: 0, cleared: 0, ran: false }
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  if (!isCheckTime(member, tz, now) || isPaused(member, now)) return none
  const memo = `${tenant.id}:${member.id}:${dayInZone(now, tz)}`
  if (checked.has(memo)) return none
  checked.add(memo)

  const meetings = await todaysMeetings(tenant.id, member.id, tz, LOOKAHEAD_DAYS + 1, { ownCalendarsOnly: true })
  if (!meetings) return none // no calendar connected
  const issues = detectIssues({ events: meetings, tz, now, selfEmails: [member.email ?? ''], memberId: member.id })
  const live = new Set(issues.map((i) => i.key))

  // Clear the ones whose issue went away (fixed, or the meeting is over).
  const { data: open, error: oErr } = await supabase
    .from('cxo_followup_notices')
    .select('id, key')
    .eq('rep_id', tenant.id)
    .eq('member_id', member.id)
    .like('key', `${CAL_CONFLICT_PREFIX}%`)
    .is('read_at', null)
    .limit(200)
  if (oErr) {
    if (missing(oErr)) throw new TableMissing()
    throw new Error(oErr.message)
  }
  const stale = ((open ?? []) as Array<{ id: string; key: string }>).filter((n) => !live.has(n.key)).map((n) => n.id)
  if (stale.length) {
    const { error } = await supabase.from('cxo_followup_notices').update({ read_at: now.toISOString() }).eq('rep_id', tenant.id).eq('member_id', member.id).in('id', stale).is('read_at', null)
    if (error) throw new Error(error.message)
  }
  if (!issues.length) return { written: 0, cleared: stale.length, ran: true }

  // Already told (read or not): never again for the same issue.
  const { data: have, error: hErr } = await supabase.from('cxo_followup_notices').select('key').eq('rep_id', tenant.id).in('key', [...live])
  if (hErr) throw new Error(hErr.message)
  const told = new Set(((have ?? []) as Array<{ key: string }>).map((r) => r.key))
  const fresh = issues.filter((i) => !told.has(i.key)).slice(0, MAX_NEW_PER_DAY)
  if (!fresh.length) return { written: 0, cleared: stale.length, ran: true }

  const href = isEmployeeOnlyMember(member, tenant) ? '/dashboard/me' : '/dashboard'
  const rows = await insertNotices(
    fresh.map((i) => ({
      rep_id: tenant.id,
      member_id: member.id,
      key: i.key,
      kind: 'report',
      item_kind: 'meeting',
      item_id: joinIds(i.eventIds) || null,
      title: i.title.slice(0, 300),
      body: i.body.slice(0, 8000),
      href,
      due_date: i.day,
    })),
  ).catch((err) => {
    if (missing(err)) throw new TableMissing()
    throw err
  })
  return { written: rows.length, cleared: stale.length, ran: true }
}

/** One check across every Suite CXO tenant. Never throws. */
export async function runCalendarConflictTick(now = new Date()): Promise<CalendarConflictResult> {
  const out: CalendarConflictResult = { tenants: 0, members: 0, checked: 0, written: 0, cleared: 0, errors: 0 }
  const utcDay = now.toISOString().slice(0, 10)
  if (checkedDay !== utcDay) {
    checked.clear()
    checkedDay = utcDay
  }
  const { data, error } = await supabase.from('reps').select('id, brand, timezone, settings').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[calendar-conflicts] tenants', error.message)
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
      for (const member of members) {
        out.members++
        try {
          const r = await checkMember(tenant, member, now)
          if (r.ran) out.checked++
          out.written += r.written
          out.cleared += r.cleared
        } catch (err) {
          if (err instanceof TableMissing) throw err
          out.errors++
          console.error('[calendar-conflicts] member', tenant.id, member.id, err instanceof Error ? err.message : err)
        }
      }
    } catch (err) {
      if (err instanceof TableMissing) return out
      out.errors++
      console.error('[calendar-conflicts] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}
