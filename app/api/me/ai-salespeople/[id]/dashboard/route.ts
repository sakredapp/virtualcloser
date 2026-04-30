import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let tenant
  try {
    const ctx = await requireMember()
    tenant = ctx.tenant
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id: setterId } = await params

  // Verify setter belongs to this tenant
  const { data: setter } = await supabase
    .from('ai_salespeople')
    .select('id')
    .eq('id', setterId)
    .eq('rep_id', tenant.id)
    .single()
  if (!setter) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayISO = todayStart.toISOString()

  const [
    { count: today_dials },
    { count: today_appts },
    { count: pending_followups },
    { count: overdue_followups },
    { count: leads_in_queue },
    { count: leads_total },
    { data: recent_calls },
    { data: queue_rows },
    { data: overdue_items },
  ] = await Promise.all([
    // Dials today
    supabase
      .from('voice_calls')
      .select('id', { count: 'exact', head: true })
      .eq('ai_salesperson_id', setterId)
      .gte('started_at', todayISO),

    // Appointments today (last_outcome = 'confirmed' in dialer_queue for today)
    supabase
      .from('dialer_queue')
      .select('id', { count: 'exact', head: true })
      .eq('ai_salesperson_id', setterId)
      .eq('last_outcome', 'confirmed')
      .gte('updated_at', todayISO),

    // Pending followups (due any time, not done)
    supabase
      .from('ai_salesperson_followups')
      .select('id', { count: 'exact', head: true })
      .eq('ai_salesperson_id', setterId)
      .in('status', ['pending', 'queued']),

    // Overdue followups (due before now)
    supabase
      .from('ai_salesperson_followups')
      .select('id', { count: 'exact', head: true })
      .eq('ai_salesperson_id', setterId)
      .in('status', ['pending', 'queued'])
      .lt('due_at', new Date().toISOString()),

    // Leads actively in queue
    supabase
      .from('dialer_queue')
      .select('id', { count: 'exact', head: true })
      .eq('ai_salesperson_id', setterId)
      .in('status', ['pending', 'in_progress']),

    // All-time leads total
    supabase
      .from('dialer_queue')
      .select('id', { count: 'exact', head: true })
      .eq('ai_salesperson_id', setterId),

    // Recent 10 calls
    supabase
      .from('voice_calls')
      .select('id, to_number, outcome, duration_seconds, started_at, summary, status')
      .eq('ai_salesperson_id', setterId)
      .order('started_at', { ascending: false })
      .limit(10),

    // Queue rows for pipeline view (grouped by last_outcome)
    supabase
      .from('dialer_queue')
      .select('id, phone, status, last_outcome, attempt_count, updated_at, context')
      .eq('ai_salesperson_id', setterId)
      .order('updated_at', { ascending: false })
      .limit(300),

    // Top overdue followup items (for dashboard callout)
    supabase
      .from('ai_salesperson_followups')
      .select('id, due_at, channel, reason, status')
      .eq('ai_salesperson_id', setterId)
      .in('status', ['pending', 'queued'])
      .lt('due_at', new Date().toISOString())
      .order('due_at', { ascending: true })
      .limit(5),
  ])

  return NextResponse.json({
    ok: true,
    stats: {
      today_dials: today_dials ?? 0,
      today_appts: today_appts ?? 0,
      pending_followups: pending_followups ?? 0,
      overdue_followups: overdue_followups ?? 0,
      leads_in_queue: leads_in_queue ?? 0,
      leads_total: leads_total ?? 0,
    },
    recent_calls: recent_calls ?? [],
    queue: queue_rows ?? [],
    overdue_followups_items: overdue_items ?? [],
  })
}
