import { redirect } from 'next/navigation'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ── Data loading ─────────────────────────────────────────────────────────────

async function loadCfoMetrics() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString()
  const lastMonthEnd = monthStart

  const [
    repsRes,
    prospectsRes,
    callsMtdRes,
    callsLastMonthRes,
    meetingsMtdRes,
    addonsRes,
    usageMtdRes,
  ] = await Promise.all([
    supabase
      .from('reps')
      .select('id, display_name, company, billing_status, monthly_fee, tier, start_date, is_active'),
    supabase
      .from('prospects')
      .select('id, status, meeting_at, created_at'),
    supabase
      .from('voice_calls')
      .select('id, rep_id, outcome, status, duration_sec, cost_cents, direction, dialer_mode, created_at')
      .gte('created_at', monthStart),
    supabase
      .from('voice_calls')
      .select('id, rep_id, outcome, duration_sec, cost_cents, direction')
      .gte('created_at', lastMonthStart)
      .lt('created_at', lastMonthEnd),
    supabase
      .from('meetings')
      .select('id, rep_id, status, scheduled_at, created_at')
      .gte('created_at', monthStart),
    supabase
      .from('client_addons')
      .select('id, rep_id, addon_key, status, monthly_price_cents'),
    supabase
      .from('usage_events')
      .select('rep_id, addon_key, event_type, quantity, cost_cents_estimate')
      .gte('occurred_at', monthStart)
      .neq('event_type', 'cap_hit_email_sent'),
  ])

  const reps = repsRes.data ?? []
  const prospects = prospectsRes.data ?? []
  const callsMtd = callsMtdRes.data ?? []
  const callsLastMonth = callsLastMonthRes.data ?? []
  const meetingsMtd = meetingsMtdRes.data ?? []
  const addons = addonsRes.data ?? []
  const usageMtd = usageMtdRes.data ?? []

  // ── Revenue ───────────────────────────────────────────────────────────────
  const activeReps = reps.filter(r => r.billing_status === 'active' && r.is_active)
  // monthly_fee is in dollars; convert to cents for uniform math
  const baseMrrCents = activeReps.reduce((s, r) => s + Math.round((r.monthly_fee || 0) * 100), 0)
  const addonMrrCents = addons
    .filter(a => ['active', 'over_cap'].includes(a.status))
    .reduce((s, a) => s + (a.monthly_price_cents || 0), 0)
  const totalMrrCents = baseMrrCents + addonMrrCents

  const newThisMonth = reps.filter(
    r => r.start_date && r.start_date >= monthStart && r.billing_status === 'active'
  ).length

  // ── Billing status breakdown ──────────────────────────────────────────────
  const statusBreakdown: Record<string, number> = {}
  for (const r of reps) {
    const s = r.billing_status || 'none'
    statusBreakdown[s] = (statusBreakdown[s] || 0) + 1
  }

  // ── Prospect funnel ───────────────────────────────────────────────────────
  const funnel = { new: 0, contacted: 0, booked: 0, won: 0, lost: 0, canceled: 0 }
  for (const p of prospects) {
    const s = p.status as keyof typeof funnel
    if (s in funnel) funnel[s]++
  }
  const totalProspects = prospects.length
  const bookedRate = totalProspects > 0
    ? (((funnel.booked + funnel.won) / totalProspects) * 100).toFixed(1)
    : '0.0'
  const wonRate = totalProspects > 0
    ? ((funnel.won / totalProspects) * 100).toFixed(1)
    : '0.0'
  const bookedToWonRate = (funnel.booked + funnel.won) > 0
    ? ((funnel.won / (funnel.booked + funnel.won)) * 100).toFixed(1)
    : '0.0'

  // ── Dialer — MTD ─────────────────────────────────────────────────────────
  const outbound = callsMtd.filter(c => c.direction?.startsWith('outbound'))
  const outboundLast = callsLastMonth.filter(c => c.direction?.startsWith('outbound'))

  const totalDials = outbound.length
  const lastDials = outboundLast.length
  const dialGrowthPct = lastDials > 0
    ? (((totalDials - lastDials) / lastDials) * 100).toFixed(0)
    : null

  const connected = outbound.filter(c =>
    ['confirmed', 'connected', 'reschedule_requested', 'rescheduled'].includes(c.outcome || '')
  ).length
  const appointmentsSet = outbound.filter(c => c.outcome === 'confirmed').length
  const voicemails = outbound.filter(c => c.outcome === 'voicemail').length
  const noAnswer = outbound.filter(c => c.outcome === 'no_answer').length
  const totalDialSec = outbound.reduce((s, c) => s + (c.duration_sec || 0), 0)
  const totalCallCostCents = outbound.reduce((s, c) => s + (c.cost_cents || 0), 0)

  const connectRate = totalDials > 0 ? ((connected / totalDials) * 100).toFixed(1) : '0.0'
  const apptSetRate = totalDials > 0 ? ((appointmentsSet / totalDials) * 100).toFixed(1) : '0.0'
  const costPerDial = totalDials > 0 ? totalCallCostCents / totalDials / 100 : 0
  const costPerConnect = connected > 0 ? totalCallCostCents / connected / 100 : 0
  const costPerAppt = appointmentsSet > 0 ? totalCallCostCents / appointmentsSet / 100 : 0
  const hoursDialed = (totalDialSec / 3600).toFixed(1)

  // ── Meetings MTD ─────────────────────────────────────────────────────────
  const confirmedMeetings = meetingsMtd.filter(m =>
    ['confirmed', 'completed'].includes(m.status || '')
  ).length
  const scheduledMeetings = meetingsMtd.filter(m => m.status === 'scheduled').length
  const noShowMeetings = meetingsMtd.filter(m => m.status === 'noshow').length
  const cancelledMeetings = meetingsMtd.filter(m => m.status === 'cancelled').length
  const showRate = (confirmedMeetings + noShowMeetings) > 0
    ? ((confirmedMeetings / (confirmedMeetings + noShowMeetings)) * 100).toFixed(0)
    : 'N/A'

  // ── Expenses ─────────────────────────────────────────────────────────────
  const usageCostCents = usageMtd.reduce((s, e) => s + (e.cost_cents_estimate || 0), 0)
  // Anthropic: ~$0.002 per outbound call (Haiku dominant) — rough estimate
  const estimatedAnthropicCents = Math.round(totalDials * 0.2)
  const totalExpensesCents = totalCallCostCents + usageCostCents + estimatedAnthropicCents
  const grossMarginCents = totalMrrCents - totalExpensesCents
  const grossMarginPct = totalMrrCents > 0
    ? ((grossMarginCents / totalMrrCents) * 100).toFixed(1)
    : '0.0'

  // ── Per-client rows ───────────────────────────────────────────────────────
  const callsByRep = new Map<string, number>()
  const apptsByRep = new Map<string, number>()
  const costByRep = new Map<string, number>()
  const secByRep = new Map<string, number>()
  for (const c of outbound) {
    callsByRep.set(c.rep_id, (callsByRep.get(c.rep_id) || 0) + 1)
    secByRep.set(c.rep_id, (secByRep.get(c.rep_id) || 0) + (c.duration_sec || 0))
    if (c.outcome === 'confirmed')
      apptsByRep.set(c.rep_id, (apptsByRep.get(c.rep_id) || 0) + 1)
    costByRep.set(c.rep_id, (costByRep.get(c.rep_id) || 0) + (c.cost_cents || 0))
  }

  const addonMrrByRep = new Map<string, number>()
  for (const a of addons.filter(a => ['active', 'over_cap'].includes(a.status))) {
    addonMrrByRep.set(a.rep_id, (addonMrrByRep.get(a.rep_id) || 0) + (a.monthly_price_cents || 0))
  }

  const clientRows = activeReps
    .map(r => {
      const baseCents = Math.round((r.monthly_fee || 0) * 100)
      const addonCents = addonMrrByRep.get(r.id) || 0
      const totalCents = baseCents + addonCents
      const costCents = costByRep.get(r.id) || 0
      const marginCents = totalCents - costCents
      return {
        id: r.id,
        name: r.company || r.display_name || 'Unknown',
        tier: r.tier || 'individual',
        mrrCents: totalCents,
        dials: callsByRep.get(r.id) || 0,
        appts: apptsByRep.get(r.id) || 0,
        costCents,
        marginCents,
        secDialed: secByRep.get(r.id) || 0,
      }
    })
    .sort((a, b) => b.mrrCents - a.mrrCents)

  return {
    monthLabel: now.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    // Revenue
    totalMrrCents,
    baseMrrCents,
    addonMrrCents,
    activeCount: activeReps.length,
    totalReps: reps.length,
    newThisMonth,
    avgMrrCents: activeReps.length > 0 ? Math.round(totalMrrCents / activeReps.length) : 0,
    // Status
    statusBreakdown,
    // Funnel
    funnel,
    totalProspects,
    bookedRate,
    wonRate,
    bookedToWonRate,
    // Dialer
    totalDials,
    lastDials,
    dialGrowthPct,
    connected,
    appointmentsSet,
    voicemails,
    noAnswer,
    totalDialSec,
    hoursDialed,
    totalCallCostCents,
    connectRate,
    apptSetRate,
    costPerDial,
    costPerConnect,
    costPerAppt,
    // Meetings
    confirmedMeetings,
    scheduledMeetings,
    noShowMeetings,
    cancelledMeetings,
    showRate,
    // Expenses
    usageCostCents,
    estimatedAnthropicCents,
    totalExpensesCents,
    grossMarginCents,
    grossMarginPct,
    // Clients
    clientRows,
  }
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function dollars(cents: number): string {
  if (cents === 0) return '$0'
  if (cents < 100) return `$${(cents / 100).toFixed(2)}`
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function dollarsExact(n: number): string {
  if (n === 0) return '$0.00'
  return `$${n.toFixed(2)}`
}

function pct(n: string | number): string {
  return `${n}%`
}

function fmtSec(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Components ────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  highlight,
  dim,
}: {
  label: string
  value: string
  sub?: string
  highlight?: boolean
  dim?: boolean
}) {
  return (
    <div style={{
      background: highlight ? 'rgba(255,40,0,0.08)' : 'rgba(255,255,255,0.03)',
      border: `1px solid ${highlight ? 'rgba(255,40,0,0.25)' : 'rgba(255,255,255,0.07)'}`,
      borderRadius: 10,
      padding: '18px 20px',
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: dim ? 'rgba(255,255,255,0.5)' : '#fff', lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 6 }}>
          {sub}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 14, marginTop: 32 }}>
      <h2 style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.5)' }}>
        {title}
      </h2>
      {note && (
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)' }}>{note}</span>
      )}
    </div>
  )
}

function FunnelBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const w = total > 0 ? Math.max(2, (count / total) * 100) : 0
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>{count.toLocaleString()}</span>
      </div>
      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${w}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: '#22c55e',
    trialing: '#3b82f6',
    past_due: '#f59e0b',
    paused: '#6366f1',
    canceled: '#ef4444',
    incomplete: '#f97316',
    none: '#6b7280',
  }
  return (
    <span style={{
      display: 'inline-block',
      width: 7, height: 7,
      borderRadius: '50%',
      background: colors[status] || '#6b7280',
      marginRight: 6,
      flexShrink: 0,
    }} />
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function CfoPage() {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const m = await loadCfoMetrics()

  const marginColor = parseFloat(m.grossMarginPct) > 60
    ? '#22c55e'
    : parseFloat(m.grossMarginPct) > 30
      ? '#f59e0b'
      : '#ef4444'

  return (
    <div style={{ minHeight: '100vh', background: '#0a0a0a', color: '#fff', padding: '28px 32px', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
            Operations &amp; Finance
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'rgba(255,255,255,0.35)' }}>
            Month-to-date · {m.monthLabel} · All times UTC
          </p>
        </div>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', textAlign: 'right', paddingTop: 4 }}>
          {m.activeCount} active client{m.activeCount !== 1 ? 's' : ''} ·&nbsp;
          {m.totalReps} total accounts
        </div>
      </div>

      {/* ── Revenue ── */}
      <SectionHeader title="Revenue" note="MTD" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
        <KpiCard label="Total MRR" value={dollars(m.totalMrrCents)} sub={`Base ${dollars(m.baseMrrCents)} + Add-ons ${dollars(m.addonMrrCents)}`} highlight />
        <KpiCard label="Active Clients" value={String(m.activeCount)} sub={m.newThisMonth > 0 ? `+${m.newThisMonth} new this month` : 'No new this month'} />
        <KpiCard label="Avg MRR / Client" value={dollars(m.avgMrrCents)} />
        <KpiCard label="Gross Margin" value={pct(m.grossMarginPct)} sub={`${dollars(m.grossMarginCents)} after estimated infra`} />
        <KpiCard label="Infra Cost" value={dollars(m.totalExpensesCents)} sub="Voice + platform + AI" dim />
      </div>

      {/* ── Billing Health ── */}
      <SectionHeader title="Billing Health" />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {Object.entries(m.statusBreakdown)
          .sort(([, a], [, b]) => b - a)
          .map(([status, count]) => (
            <div key={status} style={{
              display: 'flex', alignItems: 'center',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 8, padding: '10px 14px', gap: 8,
            }}>
              <StatusDot status={status} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', textTransform: 'capitalize' }}>{status.replace('_', ' ')}</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', marginLeft: 4 }}>{count}</span>
            </div>
          ))}
      </div>

      {/* ── Sales Funnel ── */}
      <SectionHeader title="Sales Funnel" note={`${m.totalProspects} total prospects all-time`} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '18px 20px' }}>
          <FunnelBar label="New / Uncontacted" count={m.funnel.new} total={m.totalProspects} color="rgba(255,255,255,0.25)" />
          <FunnelBar label="Contacted" count={m.funnel.contacted} total={m.totalProspects} color="#3b82f6" />
          <FunnelBar label="Call Booked" count={m.funnel.booked} total={m.totalProspects} color="#8b5cf6" />
          <FunnelBar label="Won (Client)" count={m.funnel.won} total={m.totalProspects} color="#22c55e" />
          <FunnelBar label="Lost" count={m.funnel.lost} total={m.totalProspects} color="#ef4444" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignContent: 'start' }}>
          <KpiCard label="Prospect → Booked" value={pct(m.bookedRate)} sub="of all prospects booked a call" />
          <KpiCard label="Booked → Won" value={pct(m.bookedToWonRate)} sub="of booked calls converted" />
          <KpiCard label="Overall Win Rate" value={pct(m.wonRate)} sub="prospects → paid clients" highlight />
          <KpiCard
            label="Est. CAC"
            value={m.funnel.won > 0 ? dollars(Math.round(m.totalExpensesCents / m.funnel.won)) : 'N/A'}
            sub="infra cost ÷ won clients"
          />
        </div>
      </div>

      {/* ── AI Dialer Performance ── */}
      <SectionHeader title="AI Dialer Performance" note="MTD · outbound calls only" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <KpiCard
          label="Total Dials"
          value={m.totalDials.toLocaleString()}
          sub={m.dialGrowthPct !== null
            ? `${Number(m.dialGrowthPct) >= 0 ? '+' : ''}${m.dialGrowthPct}% vs last month`
            : undefined}
        />
        <KpiCard label="Connect Rate" value={pct(m.connectRate)} sub={`${m.connected.toLocaleString()} connected`} />
        <KpiCard label="Appt Set Rate" value={pct(m.apptSetRate)} sub={`${m.appointmentsSet} appointments`} highlight />
        <KpiCard label="Voicemail Rate" value={m.totalDials > 0 ? pct(((m.voicemails / m.totalDials) * 100).toFixed(1)) : '0%'} sub={`${m.voicemails} VMs`} dim />
        <KpiCard label="No Answer Rate" value={m.totalDials > 0 ? pct(((m.noAnswer / m.totalDials) * 100).toFixed(1)) : '0%'} sub={`${m.noAnswer} NAs`} dim />
        <KpiCard label="Hours Dialed" value={`${m.hoursDialed}h`} sub={fmtSec(m.totalDialSec) + ' talk time'} />
      </div>

      {/* Cost per outcome */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginTop: 12 }}>
        <KpiCard label="Cost / Dial" value={dollarsExact(m.costPerDial)} sub="avg cost per outbound call" />
        <KpiCard label="Cost / Connect" value={dollarsExact(m.costPerConnect)} sub="avg cost per live answer" />
        <KpiCard label="Cost / Appt Set" value={dollarsExact(m.costPerAppt)} sub="avg cost per confirmed appt" highlight />
        <KpiCard label="Total Call Cost" value={dollars(m.totalCallCostCents)} sub="all outbound voice spend" dim />
      </div>

      {/* ── Meeting Outcomes ── */}
      <SectionHeader title="Meeting Outcomes" note="MTD · from AI dialer + manual bookings" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
        <KpiCard label="Confirmed" value={String(m.confirmedMeetings)} sub="showed up" highlight />
        <KpiCard label="Scheduled" value={String(m.scheduledMeetings)} sub="upcoming" />
        <KpiCard label="No-Show" value={String(m.noShowMeetings)} sub="booked but didn't show" dim />
        <KpiCard label="Cancelled" value={String(m.cancelledMeetings)} sub="cancelled by lead" dim />
        <KpiCard label="Show Rate" value={m.showRate !== 'N/A' ? pct(m.showRate) : 'N/A'} sub="confirmed ÷ (confirmed + no-show)" />
      </div>

      {/* ── Expenses Breakdown ── */}
      <SectionHeader title="Estimated Expenses" note="MTD · rough estimates where noted" />
      <div style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 10, overflow: 'hidden',
      }}>
        {[
          { label: 'Voice Calls (RevRing / provider)', value: dollars(m.totalCallCostCents), note: 'from voice_calls.cost_cents' },
          { label: 'Platform Usage Events', value: dollars(m.usageCostCents), note: 'from usage_events.cost_cents_estimate' },
          { label: 'Anthropic API (est.)', value: dollars(m.estimatedAnthropicCents), note: `~$0.002/call · ${m.totalDials} dials` },
          { label: 'Total Estimated COGS', value: dollars(m.totalExpensesCents), bold: true },
          { label: 'Gross Margin', value: `${dollars(m.grossMarginCents)} (${pct(m.grossMarginPct)})`, bold: true, color: marginColor },
        ].map((row, i) => (
          <div key={i} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '12px 20px',
            borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.05)' : 'none',
            background: row.bold ? 'rgba(255,255,255,0.02)' : 'transparent',
          }}>
            <div>
              <span style={{ fontSize: 13, fontWeight: row.bold ? 700 : 400, color: row.bold ? '#fff' : 'rgba(255,255,255,0.7)' }}>
                {row.label}
              </span>
              {row.note && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', marginLeft: 8 }}>{row.note}</span>
              )}
            </div>
            <span style={{ fontSize: 14, fontWeight: row.bold ? 700 : 600, color: row.color || (row.bold ? '#fff' : 'rgba(255,255,255,0.85)') }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* ── Per-Client Table ── */}
      <SectionHeader title="Client Breakdown" note="active clients · sorted by MRR" />
      {m.clientRows.length === 0 ? (
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.3)', padding: '20px 0' }}>No active clients this month.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['Client', 'Tier', 'MRR', 'Dials MTD', 'Appts MTD', 'Talk Time', 'Voice Cost', 'Est. Margin'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.clientRows.map((row, i) => {
                const marginPct = row.mrrCents > 0
                  ? ((row.marginCents / row.mrrCents) * 100).toFixed(0)
                  : null
                const mColor = marginPct && parseInt(marginPct) > 60 ? '#22c55e' : marginPct && parseInt(marginPct) > 30 ? '#f59e0b' : '#ef4444'
                return (
                  <tr key={row.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#fff', whiteSpace: 'nowrap', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.name}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.45)', textTransform: 'capitalize' }}>
                      {row.tier}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 700, color: '#fff' }}>
                      {dollars(row.mrrCents)}
                    </td>
                    <td style={{ padding: '10px 12px', color: row.dials > 0 ? '#fff' : 'rgba(255,255,255,0.25)' }}>
                      {row.dials.toLocaleString()}
                    </td>
                    <td style={{ padding: '10px 12px', color: row.appts > 0 ? '#22c55e' : 'rgba(255,255,255,0.25)', fontWeight: row.appts > 0 ? 700 : 400 }}>
                      {row.appts}
                    </td>
                    <td style={{ padding: '10px 12px', color: 'rgba(255,255,255,0.5)' }}>
                      {row.secDialed > 0 ? fmtSec(row.secDialed) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', color: row.costCents > 0 ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.2)' }}>
                      {row.costCents > 0 ? dollars(row.costCents) : '—'}
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: marginPct ? mColor : 'rgba(255,255,255,0.25)' }}>
                      {marginPct !== null ? `${dollars(row.marginCents)} (${marginPct}%)` : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Footer note */}
      <div style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'rgba(255,255,255,0.2)', lineHeight: 1.7 }}>
        <strong style={{ color: 'rgba(255,255,255,0.3)' }}>Data notes:</strong>{' '}
        MRR = base monthly_fee (dollars × 100) + active client_addons.monthly_price_cents.
        Voice costs sourced from voice_calls.cost_cents — may be $0 if provider doesn&apos;t populate.
        Anthropic cost is an estimate (~$0.002/dial). Gross margin = MRR − estimated COGS only; excludes payroll, tooling, and other overhead.
        Expenses use occurred_at; calls use created_at. All figures MTD in UTC.
      </div>

    </div>
  )
}
