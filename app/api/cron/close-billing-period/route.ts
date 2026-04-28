// Close-billing-period cron. Runs at 00:05 on the 1st of every month.
// For every active client:
//   1. Compute prior-month rollup from usage_events.
//   2. Upsert billing_periods row with totals + per-addon usage map.
//   3. Mark prior period status='closed'.
//   4. Reset any client_addons.status='over_cap' rows to 'active' so the
//      new month starts clean (caps reset).
//
// Idempotent — safe to re-run on the same period.

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'
import { ADDON_CATALOG } from '@/lib/addons'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function priorPeriod(): string {
  // The cron fires 1st-of-month; we close the period that just ended (last month).
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const period = priorPeriod()

  // Pull every client that has at least one usage_events row OR an active
  // add-on. Either signals revenue/cost activity for the period.
  const [{ data: usageReps }, { data: addonReps }] = await Promise.all([
    supabase
      .from('usage_events')
      .select('rep_id')
      .eq('period_year_month', period),
    supabase
      .from('client_addons')
      .select('rep_id')
      .in('status', ['active', 'over_cap']),
  ])

  const repIds = new Set<string>()
  for (const r of usageReps ?? []) repIds.add(r.rep_id)
  for (const r of addonReps ?? []) repIds.add(r.rep_id)

  const closed: string[] = []
  for (const repId of repIds) {
    await closeForRep(repId, period)
    closed.push(repId)
  }

  // Reset over-cap rows account-wide so the new month starts fresh.
  await supabase
    .from('client_addons')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('status', 'over_cap')

  return NextResponse.json({ ok: true, period, closed: closed.length })
}

async function closeForRep(repId: string, period: string): Promise<void> {
  // Sum usage by addon for this period.
  const { data: events } = await supabase
    .from('usage_events')
    .select('addon_key,quantity,cost_cents_estimate,event_type')
    .eq('rep_id', repId)
    .eq('period_year_month', period)

  // Sum revenue: client_addons monthly_price for every addon active during
  // the period. (For now, revenue is "active during period close" — close
  // enough for our rollup. If we later support mid-month proration, do it
  // here.)
  const { data: activeAddons } = await supabase
    .from('client_addons')
    .select('addon_key,monthly_price_cents')
    .eq('rep_id', repId)
    .in('status', ['active', 'over_cap'])

  const addonUsage: Record<string, { used: number; cap: number | null; cost_cents: number }> = {}
  let totalCost = 0
  for (const e of events ?? []) {
    if (e.event_type === 'cap_hit_email_sent') continue
    const k = e.addon_key
    if (!addonUsage[k]) {
      const def = ADDON_CATALOG[k as keyof typeof ADDON_CATALOG]
      addonUsage[k] = { used: 0, cap: def?.cap_value ?? null, cost_cents: 0 }
    }
    addonUsage[k].used += Number(e.quantity ?? 0)
    addonUsage[k].cost_cents += Number(e.cost_cents_estimate ?? 0)
    totalCost += Number(e.cost_cents_estimate ?? 0)
  }

  let totalRevenue = 0
  for (const a of activeAddons ?? []) {
    totalRevenue += Number(a.monthly_price_cents ?? 0)
  }

  await supabase
    .from('billing_periods')
    .upsert(
      {
        rep_id: repId,
        period_year_month: period,
        status: 'closed',
        total_revenue_cents: totalRevenue,
        total_our_cost_cents: totalCost,
        total_margin_cents: totalRevenue - totalCost,
        addon_usage: addonUsage,
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'rep_id,period_year_month' },
    )
}
