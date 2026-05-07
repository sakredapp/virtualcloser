// AI SMS outbound drip cron.
//
// Fires every 5 minutes via Vercel Cron (configure in vercel.json).
// Reads pending SMS followups from ai_salesperson_followups where
// channel='sms' and due_at <= now(), then dispatches first messages.
//
// Feature gate: SMS_AI_ENABLED=true must be set — otherwise dry-run only.
// Business hours enforced per setter timezone (setter.schedule.start_hour / end_hour).

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { sendFirstSms } from '@/lib/sms/aiEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BATCH_SIZE = 25
const DAILY_CAP_DEFAULT = 500

export async function GET(req: NextRequest) {
  // Cron secret guard
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  if (process.env.SMS_AI_ENABLED !== 'true') {
    return NextResponse.json({ ok: true, skipped: true, reason: 'SMS_AI_ENABLED not set' })
  }

  const now = new Date().toISOString()

  // Claim a batch: UPDATE to 'queued' atomically so parallel cron runs don't double-fire.
  // Postgres doesn't have a single-statement UPDATE...RETURNING with a subquery limit in
  // all Supabase client versions, so we SELECT then UPDATE in a tight window.
  const { data: pending, error: fetchErr } = await supabase
    .from('ai_salesperson_followups')
    .select('id, rep_id, ai_salesperson_id, lead_id, due_at, reason, context')
    .eq('channel', 'sms')
    .eq('status', 'pending')
    .lte('due_at', now)
    .order('due_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchErr) {
    console.error('[sms-cron] fetch failed', fetchErr.message)
    return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 })
  }

  if (!pending || pending.length === 0) {
    return NextResponse.json({ ok: true, dispatched: 0, skipped: 0 })
  }

  // Claim the rows
  const ids = (pending as Array<{ id: string }>).map((r) => r.id)
  await supabase
    .from('ai_salesperson_followups')
    .update({ status: 'queued', updated_at: now })
    .in('id', ids)
    .eq('status', 'pending') // Only claim rows still pending (optimistic lock)

  // Per-rep daily cap check cache
  const repSentToday = new Map<string, number>()

  let dispatched = 0
  let skipped = 0
  const errors: string[] = []

  for (const row of pending as Array<{
    id: string
    rep_id: string
    ai_salesperson_id: string
    lead_id: string | null
    due_at: string
    reason: string | null
    context: Record<string, unknown> | null
  }>) {
    try {
      // Daily cap per rep
      const sentToday = await getRepSmsSentToday(row.rep_id, repSentToday)
      if (sentToday >= DAILY_CAP_DEFAULT) {
        await releaseRow(row.id, 'pending')
        skipped++
        continue
      }

      // Business hours check (load setter schedule)
      const { data: setter } = await supabase
        .from('ai_salespeople')
        .select('status, schedule, phone_number')
        .eq('id', row.ai_salesperson_id)
        .maybeSingle()

      if (!setter || (setter as Record<string, unknown>).status !== 'active') {
        await releaseRow(row.id, 'pending')
        skipped++
        continue
      }

      const schedule = (setter as Record<string, unknown>).schedule as Record<string, unknown> | null ?? {}
      if (!isInBusinessHours(schedule)) {
        await releaseRow(row.id, 'pending')
        skipped++
        continue
      }

      // Resolve lead phone
      let phone: string | null = null
      if (row.lead_id) {
        const { data: lead } = await supabase
          .from('leads')
          .select('phone')
          .eq('id', row.lead_id)
          .maybeSingle()
        phone = (lead as { phone: string | null } | null)?.phone ?? null
      }
      // Context may carry a direct phone (e.g. from dialer queue row)
      if (!phone && row.context?.phone) phone = String(row.context.phone)

      if (!phone) {
        await releaseRow(row.id, 'cancelled')
        skipped++
        continue
      }

      const callOutcome = typeof row.context?.call_outcome === 'string' ? row.context.call_outcome : null

      const result = await sendFirstSms({
        repId: row.rep_id,
        setterId: row.ai_salesperson_id,
        leadId: row.lead_id,
        phone,
        followupId: row.id,
        reason: row.reason,
        callOutcome,
      })

      if (result.ok) {
        dispatched++
        repSentToday.set(row.rep_id, (repSentToday.get(row.rep_id) ?? 0) + 1)
      } else {
        // sendFirstSms already marks row done/cancelled on success; on failure re-pend
        const terminal = ['no_twilio_creds', 'setter_not_found', 'do_not_call', 'sms_consent_false', 'protected_disposition'].includes(result.reason ?? '')
        await releaseRow(row.id, terminal ? 'cancelled' : 'pending')
        skipped++
        if (result.reason !== 'active_session_exists') {
          errors.push(`${row.id}: ${result.reason}`)
        }
      }
    } catch (err) {
      console.error('[sms-cron] row error', row.id, err)
      await releaseRow(row.id, 'pending')
      skipped++
    }
  }

  return NextResponse.json({ ok: true, dispatched, skipped, errors: errors.length > 0 ? errors : undefined })
}

async function getRepSmsSentToday(repId: string, cache: Map<string, number>): Promise<number> {
  if (cache.has(repId)) return cache.get(repId)!
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const { count } = await supabase
    .from('sms_messages')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .eq('direction', 'outbound')
    .eq('is_ai_reply', true)
    .gte('created_at', todayStart.toISOString())
  const n = count ?? 0
  cache.set(repId, n)
  return n
}

function isInBusinessHours(schedule: Record<string, unknown>): boolean {
  const tz = (schedule.timezone as string | undefined) ?? 'America/New_York'
  const startHour = (schedule.start_hour as number | undefined) ?? 8
  const endHour = (schedule.end_hour as number | undefined) ?? 21
  const activeDays = (schedule.active_days as number[] | undefined) ?? [1, 2, 3, 4, 5]

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      weekday: 'short',
      hour12: false,
    }).formatToParts(new Date())

    const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '0', 10)
    const weekdayStr = parts.find((p) => p.type === 'weekday')?.value ?? ''
    const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
    const weekday = weekdayMap[weekdayStr] ?? new Date().getDay()

    if (!activeDays.includes(weekday)) return false
    if (hour < startHour || hour >= endHour) return false
    return true
  } catch {
    // Fallback: always allow (don't block on bad timezone)
    return true
  }
}

async function releaseRow(id: string, status: 'pending' | 'cancelled'): Promise<void> {
  await supabase
    .from('ai_salesperson_followups')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
}
