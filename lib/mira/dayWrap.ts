/**
 * Wrap Up Each Person's Day (Suite CXO), the server side. Runs on the Hetzner
 * worker (hetzner-worker/index.ts), checked about every 10 minutes.
 *
 * For each Suite CXO tenant (reps.brand = 'cxo') and each active person (not
 * an exec assistant), once their day ends (an hour before the end of their
 * own working hours, else 5pm local, on their work days): one short in-app
 * notice with what got done, what slips to tomorrow (one tap moves it), the
 * replies they still owe and tomorrow's first meeting.
 *
 * Rules kept here:
 *  - Person-scoped: every read carries rep_id AND the member's own id; the
 *    notice goes to that person only.
 *  - In-app only. No email, text or push.
 *  - Only when there is something to say (dayWrapShared.composeWrap).
 *  - Email: counted only on the Pinnacle edition, and only from their own
 *    connected mailbox. Suite CXO does not offer an inbox otherwise.
 *  - Model-free, cost 0. Once per person per day: the notice key is the lock
 *    (unique rep_id + key), plus an in-process memo so a day is checked once.
 *  - No new tables. Until cxo_followup_notices exists this is a quiet no-op.
 */
import { supabase } from '@/lib/supabase'
import { listTodos, todaysMeetings, type Todo } from '@/lib/today'
import { insertNotices } from '@/lib/followups/engine'
import { isPaused, nameOf } from '@/lib/followups/shared'
import { joinIds } from '@/lib/followups/noticeActionsShared'
import { isEmployeeOnlyMember } from '@/lib/employees/access'
import { isPinnacleEdition } from '@/lib/storeDemo'
import { dayInZone } from '@/lib/dueRemindersShared'
import { composeWrap, isWrapTime, nextWorkDay, wrapKey, wrapSchedule, type WrapOwed } from './dayWrapShared'

export type DayWrapResult = { tenants: number; members: number; written: number; errors: number }

type Err = { code?: string; message?: string } | null
const missing = (err: unknown) => !!err && ['42P01', 'PGRST205'].includes(String((err as Err)?.code))
class TableMissing extends Error {}

type TenantRow = { id: string; brand: string | null; timezone: string | null; settings: unknown }
type MemberRow = { id: string; rep_id: string; email: string | null; display_name: string | null; role: string | null; timezone: string | null; settings: unknown; is_active: boolean }

/** Keys already handled in this process (a wrap that went out, or was found already there). */
const handled = new Set<string>()
let handledDay = ''

/** Unread in-app messages to them that want an answer (a note needs none; a reply to their own message is an answer, not an ask). */
async function owedMessages(repId: string, memberId: string, names: Map<string, string>, now: Date): Promise<WrapOwed[]> {
  const { data, error } = await supabase
    .from('member_messages')
    .select('from_member_id, kind')
    .eq('rep_id', repId)
    .eq('to_member_id', memberId)
    .is('read_at', null)
    .is('replied_to_id', null)
    .in('kind', ['message', 'request', 'question'])
    .lte('deliver_at', now.toISOString())
    .limit(50)
  if (error) return []
  return ((data ?? []) as Array<{ from_member_id: string; kind: string }>).map((m) => ({ from: names.get(m.from_member_id) ?? 'a colleague', kind: m.kind }))
}

/** Pinnacle edition only: emails needing a reply in their OWN mailbox. Null otherwise. */
async function mailOwed(tenant: TenantRow, member: MemberRow): Promise<number | null> {
  if (!isPinnacleEdition(tenant.id) || isEmployeeOnlyMember(member, tenant)) return null
  try {
    const { getMailboxScopeById } = await import('@/lib/email/mailboxAccess')
    const { countNeedsReply } = await import('@/lib/email/needsReply')
    const scope = await getMailboxScopeById(tenant.id, member.id)
    const box = scope.mailboxes.find((m) => m.kind === 'own' && m.memberId === member.id) ?? null
    return box ? await countNeedsReply(scope, box) : null
  } catch {
    return null
  }
}

async function wrapMember(tenant: TenantRow, member: MemberRow, names: Map<string, string>, now: Date): Promise<number> {
  const tz = member.timezone || tenant.timezone || 'America/New_York'
  if (!isWrapTime(member, tz, now) || isPaused(member, now)) return 0
  const day = dayInZone(now, tz)
  const key = wrapKey(day, member.id)
  if (handled.has(key)) return 0
  const { data: have, error: hErr } = await supabase.from('cxo_followup_notices').select('id').eq('rep_id', tenant.id).eq('key', key).limit(1)
  if (hErr) {
    if (missing(hErr)) throw new TableMissing()
    throw new Error(hErr.message)
  }
  if (have?.length) {
    handled.add(key)
    return 0
  }
  const next = nextWorkDay(day, wrapSchedule(member).days)
  const [todos, owed, mail, meetings] = await Promise.all([
    listTodos(tenant.id, member.id).catch(() => [] as Todo[]),
    owedMessages(tenant.id, member.id, names, now),
    mailOwed(tenant, member),
    // Through the end of the next work day (Friday reaches Monday).
    todaysMeetings(tenant.id, member.id, tz, Math.round((Date.parse(next + 'T12:00:00Z') - Date.parse(day + 'T12:00:00Z')) / 86_400_000) + 1).catch(() => null),
  ])
  const wrap = composeWrap({ day, tz, todos, owed, mailOwed: mail, meetings: meetings ?? [], nextDay: next })
  handled.add(key)
  if (!wrap) return 0
  const rows = await insertNotices([
    {
      rep_id: tenant.id,
      member_id: member.id,
      key,
      kind: 'report',
      item_kind: 'report',
      item_id: wrap.moveIds.length ? joinIds(wrap.moveIds) : null,
      title: wrap.title.slice(0, 300),
      body: wrap.body.slice(0, 8000),
      href: isEmployeeOnlyMember(member, tenant) ? '/dashboard/me' : '/dashboard',
      due_date: next,
    },
  ]).catch((err) => {
    if (missing(err)) throw new TableMissing()
    throw err
  })
  return rows.length
}

/** One check across every Suite CXO tenant. Never throws. */
export async function runDayWrapTick(now = new Date()): Promise<DayWrapResult> {
  const out: DayWrapResult = { tenants: 0, members: 0, written: 0, errors: 0 }
  const utcDay = now.toISOString().slice(0, 10)
  if (handledDay !== utcDay) {
    // Keys carry the local day, so yesterday's are dead weight; drop them once a day.
    handled.clear()
    handledDay = utcDay
  }
  const { data, error } = await supabase.from('reps').select('id, brand, timezone, settings').eq('brand', 'cxo').eq('is_active', true).limit(500)
  if (error) {
    console.error('[day-wrap] tenants', error.message)
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
        out.members++
        try {
          out.written += await wrapMember(tenant, member, names, now)
        } catch (err) {
          if (err instanceof TableMissing) throw err
          out.errors++
          console.error('[day-wrap] member', tenant.id, member.id, err instanceof Error ? err.message : err)
        }
      }
    } catch (err) {
      if (err instanceof TableMissing) return out
      out.errors++
      console.error('[day-wrap] tenant', tenant.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}
