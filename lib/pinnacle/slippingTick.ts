/**
 * Ciao's daily "a number slipped" alert. Run by the Hetzner worker
 * (hetzner-worker/index.ts), never a Vercel cron.
 *
 * Per Pinnacle-viewer tenant (lib/pinnacle/access), once per day in the
 * tenant's zone, after that day's Airtable sync has finished and the rollups
 * were rebuilt:
 *   1. build the detector input from the cached rollup (slippingData);
 *   2. detectSlipping: max 3 items, worst first;
 *   3. drop slips already alerted this month (one alert per slip per month);
 *   4. if anything is left, write ONE in-app notice per owner/admin member
 *      on the existing rail (cxo_followup_notices, kind 'report'). The
 *      (rep_id, key) unique index makes it once per member per day.
 * Nothing slipping → nothing written. In-app only: no email, text or push.
 */
import { supabase } from '@/lib/supabase'
import { Loader } from '@/lib/mcp/data'
import { insertNotices, type NoticeRow } from '@/lib/followups/engine'
import type { Tenant } from '@/lib/tenant'
import { pinnacleTenantIds } from './access'
import { latestPinnacleSweepAt } from './cache'
import { loadSlipInput } from './slippingData'
import {
  SLIP_KEY_PREFIX,
  dayIn,
  detectSlipping,
  newSlips,
  slippingMonthKeyPattern,
  slippingNoticeKey,
  slippingNoticeText,
  syncDoneToday,
} from './slipping'

/** Members who get the alert: the company's owner and admins. */
export const SLIP_ALERT_ROLES = ['owner', 'admin'] as const

export const SLIP_HREF = '/dashboard/pinnacle'

/**
 * In-process "already checked today" memo, so a quiet day (nothing slipping,
 * nothing written) is not recomputed every 15 minutes. The notice rows are
 * the real once-a-day lock; this only saves work.
 */
const checked = new Map<string, string>()
export function slipCheckKey(tenantId: string, day: string): string {
  return `${tenantId}:${day}`
}
export function alreadyCheckedToday(tenantId: string, day: string, memo: Map<string, string> = checked): boolean {
  return memo.get(tenantId) === slipCheckKey(tenantId, day)
}
export function markCheckedToday(tenantId: string, day: string, memo: Map<string, string> = checked): void {
  memo.set(tenantId, slipCheckKey(tenantId, day))
}

export type SlipTickResult = { tenants: number; checked: number; written: number; errors: number }

type RepRow = { id: string; timezone: string | null; is_active: boolean | null }
type MemberRow = { id: string; role: string | null; is_active: boolean | null }

async function lastOkSyncFinishedAt(): Promise<string | null> {
  const { data } = await supabase
    .from('pinnacle_airtable_sync_runs')
    .select('finished_at')
    .eq('ok', true)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as { finished_at: string | null } | null)?.finished_at ?? null
}

async function sentThisMonth(repId: string, day: string): Promise<{ today: boolean; signatures: string[] }> {
  const { data, error } = await supabase
    .from('cxo_followup_notices')
    .select('key, item_id')
    .eq('rep_id', repId)
    .like('key', slippingMonthKeyPattern(day))
    .limit(2000)
  if (error) throw error
  const rows = (data ?? []) as Array<{ key: string; item_id: string | null }>
  const todayPrefix = `${SLIP_KEY_PREFIX}${day}-`
  return {
    today: rows.some((r) => r.key.startsWith(todayPrefix)),
    signatures: rows.flatMap((r) => (r.item_id ?? '').split('|').filter(Boolean)),
  }
}

export async function runSlippingAlertTick(now: Date = new Date()): Promise<SlipTickResult> {
  const ids = pinnacleTenantIds()
  const out: SlipTickResult = { tenants: ids.length, checked: 0, written: 0, errors: 0 }
  if (!ids.length) return out
  const { data: reps, error } = await supabase.from('reps').select('id, timezone, is_active').in('id', ids)
  if (error) throw error
  const live = ((reps ?? []) as RepRow[]).filter((r) => r.is_active !== false)
  if (!live.length) return out
  const [finishedAt, sweptAt] = await Promise.all([lastOkSyncFinishedAt(), latestPinnacleSweepAt()])

  for (const rep of live) {
    const tz = rep.timezone || 'America/New_York'
    const day = dayIn(now, tz)
    if (alreadyCheckedToday(rep.id, day)) continue
    if (!syncDoneToday({ today: day, finishedAt, sweptAt, tz, now })) continue
    try {
      const sent = await sentThisMonth(rep.id, day)
      if (sent.today) {
        markCheckedToday(rep.id, day)
        continue
      }
      const L = new Loader({ id: rep.id, timezone: tz } as Tenant)
      const input = await loadSlipInput(L)
      out.checked++
      const items = input ? newSlips(detectSlipping(input), sent.signatures) : []
      if (items.length) {
        const { data: members, error: mErr } = await supabase.from('members').select('id, role, is_active').eq('rep_id', rep.id).limit(1000)
        if (mErr) throw mErr
        const execs = ((members ?? []) as MemberRow[]).filter((m) => m.is_active !== false && (SLIP_ALERT_ROLES as readonly string[]).includes(String(m.role ?? '')))
        const { title, body } = slippingNoticeText(items)
        const rows: NoticeRow[] = execs.map((m) => ({
          rep_id: rep.id,
          member_id: m.id,
          key: slippingNoticeKey(day, m.id),
          kind: 'report',
          item_kind: 'report',
          item_id: items.map((i) => i.signature).join('|'),
          title,
          body,
          href: SLIP_HREF,
          due_date: null,
        }))
        out.written += (await insertNotices(rows)).length
      }
      markCheckedToday(rep.id, day)
    } catch (err) {
      out.errors++
      console.error('[slipping]', rep.id, err instanceof Error ? err.message : err)
    }
  }
  return out
}
