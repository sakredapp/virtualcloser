/** Usage / login tracking (server, service role). See supabase/cxo_alerts_usage_ics_migration.sql. */
import { supabase } from '@/lib/supabase'
import { dayInZone } from '@/lib/dueRemindersShared'
import { MIRA_INCLUDED_MONTHLY_DEFAULT, miraPool, pageName, type MiraPool, type UsageRow } from '@/lib/cxoUsageShared'

/**
 * One row per member per page per day. bump=false (page views) only makes
 * sure the row exists, so a member costs at most one write per page per day;
 * bump=true (logins) counts each one.
 */
export async function recordHit(repId: string, memberId: string, path: string, opts: { tz?: string | null; bump?: boolean } = {}): Promise<void> {
  const day = dayInZone(new Date(), opts.tz || 'America/New_York')
  const { error } = await supabase.rpc('cxo_activity_hit', { p_rep: repId, p_member: memberId, p_day: day, p_path: path, p_bump: !!opts.bump })
  if (error) console.error('[usage] hit', error.message)
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86_400_000).toISOString().slice(0, 10)

/** The Settings › Usage table: every active member of the org, last 30 days, plus the org's Mira pool this month. */
export async function orgUsage(repId: string, tz: string, perSeat = MIRA_INCLUDED_MONTHLY_DEFAULT): Promise<{ rows: UsageRow[]; pool: MiraPool }> {
  const today = dayInZone(new Date(), tz || 'America/New_York')
  const since30 = addDays(today, -29)
  const since7 = addDays(today, -6)
  const monthStart = `${today.slice(0, 7)}-01`
  const sinceMira = monthStart < since30 ? monthStart : since30
  const [membersQ, actQ, miraQ] = await Promise.all([
    supabase.from('members').select('id, display_name, email, role, last_login_at').eq('rep_id', repId).eq('is_active', true),
    supabase.from('cxo_activity').select('member_id, day, path, count').eq('rep_id', repId).gte('day', since30).limit(20000),
    supabase.from('agent_usage').select('member_id, day, requests').eq('rep_id', repId).gte('day', sinceMira).limit(5000),
  ])
  if (membersQ.error) throw membersQ.error
  const act = (actQ.data ?? []) as Array<{ member_id: string; day: string; path: string; count: number }>
  const mira = (miraQ.data ?? []) as Array<{ member_id: string; day: string; requests: number | null }>
  const rows: UsageRow[] = []
  for (const m of (membersQ.data ?? []) as Array<{ id: string; display_name: string | null; email: string | null; role: string; last_login_at: string | null }>) {
    const mine = act.filter((a) => a.member_id === m.id)
    const logins = mine.filter((a) => a.path === '/login')
    const pages = new Map<string, number>()
    for (const a of mine) {
      if (a.path === '/login') continue
      const name = pageName(a.path)
      pages.set(name, (pages.get(name) ?? 0) + 1) // days the page was opened
    }
    rows.push({
      member_id: m.id,
      name: m.display_name || m.email || 'Member',
      email: m.email,
      role: m.role,
      last_login_at: m.last_login_at,
      logins7: logins.filter((a) => a.day >= since7).reduce((n, a) => n + (a.count || 0), 0),
      logins30: logins.reduce((n, a) => n + (a.count || 0), 0),
      days_active30: new Set(mine.map((a) => a.day)).size,
      top_pages: [...pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, views]) => ({ name, views })),
      mira30: mira.filter((u) => u.member_id === m.id && u.day >= since30).reduce((n, u) => n + (u.requests || 0), 0),
      miraMonth: mira.filter((u) => u.member_id === m.id && u.day >= monthStart).reduce((n, u) => n + (u.requests || 0), 0),
    })
  }
  rows.sort((a, b) => (Date.parse(b.last_login_at ?? '') || 0) - (Date.parse(a.last_login_at ?? '') || 0))
  // The pool counts every question this month, including people since removed.
  const usedMonth = mira.filter((u) => u.day >= monthStart).reduce((n, u) => n + (u.requests || 0), 0)
  return { rows, pool: miraPool(rows.map((r) => r.role), usedMonth, perSeat) }
}
