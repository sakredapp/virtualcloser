// GET /api/cron/billing-week-rollover
//
// Runs every Monday 00:15 UTC. For each active subscription:
//
//   1. Close the prior week's billing-week row (compute consumed seconds
//      from voice_calls, compute overage hours, mark closed).
//   2. If overflow_enabled and overage > 0, push a Stripe usage record on
//      the metered overage subscription item so the just-closed weekly
//      invoice (about to finalize) includes the overage.
//   3. Open the new week's billing-week row at planned_hours = current
//      weekly_hours_quota.
//
// Cron auth: matches header against CRON_SECRET (Vercel injects it on
// scheduled invocations).

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { supabase } from '@/lib/supabase'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { weekBoundsForDate, isoWeekString, SECONDS_PER_HOUR } from '@/lib/billing/weekly'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? ''
  const expected = process.env.CRON_SECRET
  if (expected && auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  }
  if (!isStripeConfigured()) {
    return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })
  }

  const now = new Date()
  const current = weekBoundsForDate(now)
  const priorWeekRef = new Date(current.weekStart.getTime() - 24 * 60 * 60 * 1000)
  const prior = {
    isoWeek: isoWeekString(priorWeekRef),
    weekStart: new Date(current.weekStart.getTime() - 7 * 24 * 60 * 60 * 1000),
    weekEnd: current.weekStart,
  }

  const summary = {
    closedAgentWeeks: 0,
    closedOrgWeeks: 0,
    openedAgentWeeks: 0,
    openedOrgWeeks: 0,
    overagePushed: 0,
    errors: [] as string[],
  }

  // ── Member (agent) rollover ────────────────────────────────────────
  const { data: agents } = await supabase
    .from('agent_billing')
    .select('member_id, rep_id, weekly_hours_quota, overflow_enabled, status, stripe_subscription_id, volume_tier')
    .eq('status', 'active')
  for (const a of agents ?? []) {
    try {
      await closePriorAgentWeek({
        memberId: a.member_id as string,
        repId: a.rep_id as string,
        prior,
        subscriptionId: a.stripe_subscription_id as string | null,
        overflow: !!a.overflow_enabled,
        summary,
      })
      await openNewAgentWeek({
        memberId: a.member_id as string,
        repId: a.rep_id as string,
        current,
        plannedHours: Number(a.weekly_hours_quota ?? 0),
      })
      summary.openedAgentWeeks++
    } catch (err) {
      summary.errors.push(`agent ${a.member_id}: ${(err as Error).message}`)
    }
  }

  // ── Org rollover ──────────────────────────────────────────────────
  const { data: orgs } = await supabase
    .from('reps')
    .select('id, weekly_hours_quota, overflow_enabled, billing_status, stripe_subscription_id, volume_tier')
    .eq('billing_status', 'active')
  for (const r of orgs ?? []) {
    try {
      await closePriorOrgWeek({
        repId: r.id as string,
        prior,
        subscriptionId: r.stripe_subscription_id as string | null,
        overflow: !!r.overflow_enabled,
        summary,
      })
      await openNewOrgWeek({
        repId: r.id as string,
        current,
        plannedHours: Number(r.weekly_hours_quota ?? 0),
      })
      summary.openedOrgWeeks++
    } catch (err) {
      summary.errors.push(`org ${r.id}: ${(err as Error).message}`)
    }
  }

  return NextResponse.json({ ok: true, summary, ranAt: now.toISOString() })
}

// ── Helpers ────────────────────────────────────────────────────────────

async function closePriorAgentWeek(args: {
  memberId: string
  repId: string
  prior: { isoWeek: string; weekStart: Date; weekEnd: Date }
  subscriptionId: string | null
  overflow: boolean
  summary: { closedAgentWeeks: number; overagePushed: number }
}): Promise<void> {
  const { data: row } = await supabase
    .from('agent_billing_week')
    .select('id, planned_hours, status, overage_pushed_at')
    .eq('member_id', args.memberId)
    .eq('iso_week', args.prior.isoWeek)
    .maybeSingle()
  if (!row) return                  // no prior week — first week ever
  if (row.status === 'closed') return

  // Tally consumed seconds from voice_calls in the prior week.
  const { data: calls } = await supabase
    .from('voice_calls')
    .select('duration_sec')
    .eq('owner_member_id', args.memberId)
    .eq('provider', 'revring')
    .gte('created_at', args.prior.weekStart.toISOString())
    .lt('created_at', args.prior.weekEnd.toISOString())
  const consumed = (calls ?? []).reduce(
    (acc, r) => acc + Math.max(0, Number((r as { duration_sec?: number | null }).duration_sec ?? 0)), 0)
  const planned = Number(row.planned_hours ?? 0) * SECONDS_PER_HOUR
  const overageSec = Math.max(0, consumed - planned)
  const overageHours = overageSec / SECONDS_PER_HOUR

  await supabase
    .from('agent_billing_week')
    .update({
      consumed_seconds: consumed,
      overage_hours: Number(overageHours.toFixed(2)),
      status: 'closed',
      closed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  args.summary.closedAgentWeeks++

  if (args.overflow && overageHours > 0 && args.subscriptionId && !row.overage_pushed_at) {
    const pushed = await pushOverageUsageRecord({
      subscriptionId: args.subscriptionId,
      kind: 'sdr_overage',
      hours: overageHours,
      timestamp: Math.floor(args.prior.weekEnd.getTime() / 1000) - 1,
    })
    if (pushed) {
      await supabase
        .from('agent_billing_week')
        .update({ overage_pushed_at: new Date().toISOString() })
        .eq('id', row.id)
      args.summary.overagePushed++
    }
  }
}

async function openNewAgentWeek(args: {
  memberId: string
  repId: string
  current: { isoWeek: string; weekStart: Date; weekEnd: Date }
  plannedHours: number
}): Promise<void> {
  await supabase.from('agent_billing_week').upsert({
    member_id: args.memberId,
    rep_id: args.repId,
    iso_week: args.current.isoWeek,
    week_start: args.current.weekStart.toISOString(),
    week_end: args.current.weekEnd.toISOString(),
    planned_hours: args.plannedHours,
    status: 'open',
  }, { onConflict: 'member_id,iso_week' })
}

async function closePriorOrgWeek(args: {
  repId: string
  prior: { isoWeek: string; weekStart: Date; weekEnd: Date }
  subscriptionId: string | null
  overflow: boolean
  summary: { closedOrgWeeks: number; overagePushed: number }
}): Promise<void> {
  const { data: row } = await supabase
    .from('org_billing_week')
    .select('id, planned_hours, status, overage_pushed_at')
    .eq('rep_id', args.repId)
    .eq('iso_week', args.prior.isoWeek)
    .maybeSingle()
  if (!row) return
  if (row.status === 'closed') return

  // Org consumption = sum of all member voice_calls in the org.
  const { data: members } = await supabase
    .from('members')
    .select('id')
    .eq('rep_id', args.repId)
  const memberIds = (members ?? []).map((m) => (m as { id: string }).id)

  let consumed = 0
  if (memberIds.length > 0) {
    const { data: calls } = await supabase
      .from('voice_calls')
      .select('duration_sec')
      .in('owner_member_id', memberIds)
      .eq('provider', 'revring')
      .gte('created_at', args.prior.weekStart.toISOString())
      .lt('created_at', args.prior.weekEnd.toISOString())
    consumed = (calls ?? []).reduce(
      (acc, r) => acc + Math.max(0, Number((r as { duration_sec?: number | null }).duration_sec ?? 0)), 0)
  }
  const planned = Number(row.planned_hours ?? 0) * SECONDS_PER_HOUR
  const overageSec = Math.max(0, consumed - planned)
  const overageHours = overageSec / SECONDS_PER_HOUR

  await supabase
    .from('org_billing_week')
    .update({
      consumed_seconds: consumed,
      overage_hours: Number(overageHours.toFixed(2)),
      status: 'closed',
      closed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  args.summary.closedOrgWeeks++

  if (args.overflow && overageHours > 0 && args.subscriptionId && !row.overage_pushed_at) {
    const pushed = await pushOverageUsageRecord({
      subscriptionId: args.subscriptionId,
      kind: 'sdr_overage',
      hours: overageHours,
      timestamp: Math.floor(args.prior.weekEnd.getTime() / 1000) - 1,
    })
    if (pushed) {
      await supabase
        .from('org_billing_week')
        .update({ overage_pushed_at: new Date().toISOString() })
        .eq('id', row.id)
      args.summary.overagePushed++
    }
  }
}

async function openNewOrgWeek(args: {
  repId: string
  current: { isoWeek: string; weekStart: Date; weekEnd: Date }
  plannedHours: number
}): Promise<void> {
  await supabase.from('org_billing_week').upsert({
    rep_id: args.repId,
    iso_week: args.current.isoWeek,
    week_start: args.current.weekStart.toISOString(),
    week_end: args.current.weekEnd.toISOString(),
    planned_hours: args.plannedHours,
    status: 'open',
  }, { onConflict: 'rep_id,iso_week' })
}

/** Find the metered overage subscription item and push a usage record.
 *  Returns true if a record was pushed. */
async function pushOverageUsageRecord(args: {
  subscriptionId: string
  kind: 'sdr_overage' | 'trainer_overage'
  hours: number
  timestamp: number
}): Promise<boolean> {
  const stripe = getStripe()
  const sub = await stripe.subscriptions.retrieve(args.subscriptionId, { expand: ['items.data.price'] })
  const meteredItem = sub.items.data.find((it) => {
    const md = (it.price as Stripe.Price).metadata ?? {}
    return md.vc_kind === args.kind && it.price.recurring?.usage_type === 'metered'
  })
  if (!meteredItem) return false
  // Stripe SDK v22 still ships subscriptionItems.createUsageRecord on the
  // resource at runtime even though the typed surface narrowed for the
  // newer Meter Events API. We call via raw request to stay compatible
  // with both old usage_records and the new meters world.
  await (stripe as unknown as {
    subscriptionItems: {
      createUsageRecord: (
        id: string,
        params: { quantity: number; timestamp?: number; action?: 'increment' | 'set' },
      ) => Promise<unknown>
    }
  }).subscriptionItems.createUsageRecord(meteredItem.id, {
    quantity: Math.ceil(args.hours),
    timestamp: args.timestamp,
    action: 'increment',
  })
  return true
}
