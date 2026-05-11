// AI Dialer · Analytics deep-dive.
//
// Role-aware:
//   - rep:     their own calls only (self scope), plus a "how you compare"
//              line vs the team average where available
//   - manager: their team aggregate + per-rep leaderboard within their team
//   - owner/admin: account-wide aggregate + per-rep leaderboard across the
//                  whole org
//
// All metrics come from voice_calls (provider='revring', dialer_mode set).
// No new schema — see lib/dialerAnalytics.ts for the aggregation logic.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import { resolveMemberDataScope } from '@/lib/permissions'
import {
  getDialerCorePerf,
  getDialerDailyTrend,
  getDialerPerMode,
  getDialerPerMember,
  fmtSeconds,
  fmtCents,
  type DialerCorePerf,
  type PerModeRow,
  type PerMemberRow,
  type DailyTrendPoint,
} from '@/lib/dialerAnalytics'
import DashboardNav from '../../DashboardNav'
import { buildDashboardTabs } from '../../dashboardTabs'
import ModePillNav from '../ModePillNav'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export default async function DialerAnalyticsPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  let tenantId: string
  let viewer
  try {
    const ctx = await requireMember()
    tenantId = ctx.tenant.id
    viewer = ctx.member
  } catch {
    redirect('/login')
    return null
  }

  const navTabs = await buildDashboardTabs(tenantId, viewer)
  const scope = await resolveMemberDataScope(viewer)

  // Pull everything in parallel.
  const [core, trend, perMode, perMember, accountCore, rateRow] = await Promise.all([
    getDialerCorePerf(tenantId, scope, { days: 30 }),
    getDialerDailyTrend(tenantId, scope, { days: 30 }),
    getDialerPerMode(tenantId, scope, { days: 30 }),
    getDialerPerMember(tenantId, scope, { days: 30 }),
    // Rep view also pulls the account average for the "how you compare" row.
    scope.scope === 'self'
      ? getDialerCorePerf(tenantId, { scope: 'account', memberId: viewer.id, memberIds: null }, { days: 30 })
      : Promise.resolve(null),
    supabase
      .from('reps')
      .select('client_display_rate_per_minute_cents')
      .eq('id', tenantId)
      .maybeSingle<{ client_display_rate_per_minute_cents: number | null }>(),
  ])

  // Cost shown to clients is computed from a separately-stored display rate,
  // never from voice_calls.cost_cents (which holds our actual provider cost).
  // When NULL we hide every cost surface on this page.
  const displayRatePerMinute = rateRow.data?.client_display_rate_per_minute_cents ?? null
  const showCost = typeof displayRatePerMinute === 'number' && displayRatePerMinute > 0
  const displayCostCents = showCost
    ? Math.ceil(core.talkSeconds / 60) * displayRatePerMinute
    : 0
  const displayCostPerAppt = showCost && core.appointments > 0
    ? Math.round(displayCostCents / core.appointments)
    : null

  const scopeLabel =
    scope.scope === 'self' ? 'Your last 30 days' :
    scope.scope === 'team' ? 'Your team · last 30 days' :
    'Whole account · last 30 days'

  return (
    <main>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <ModePillNav active={'analytics'} />

      <section className="wrap" style={{ paddingTop: '1rem' }}>
        <header style={{ marginBottom: '1rem' }}>
          <p className="eyebrow">AI Dialer · Analytics</p>
          <h1 style={{ margin: '4px 0 8px' }}>{scopeLabel}</h1>
          <p className="sub" style={{ margin: 0 }}>
            Decision metrics — connect rate, talk utilization, conversion, cost-per-appointment.
            Vanity metrics (raw call count, raw minutes) are at the bottom for completeness.
          </p>
        </header>

        {/* ── Hero KPIs (5 most important) ── */}
        <KpiGrid core={core} comparison={accountCore} />

        {/* ── 30-day trend chart ── */}
        <Section title="30-day trend" sub="Dials, connects, appointments per day">
          <TrendChart data={trend} />
        </Section>

        {/* ── Per-mode breakdown ── */}
        <Section title="Per dialer mode" sub="Where the dialer's hours are landing">
          <PerModeTable rows={perMode} />
        </Section>

        {/* ── Per-rep leaderboard (manager + owner) ── */}
        {scope.scope !== 'self' && perMember.length > 0 && (
          <Section
            title={scope.scope === 'team' ? 'Your team · per-rep leaderboard' : 'Org-wide · per-rep leaderboard'}
            sub="Ranked by appointments booked, then connects"
          >
            <PerMemberTable rows={perMember} />
          </Section>
        )}

        {/* ── Throughput ── */}
        <Section title="Throughput" sub="How efficiently the dialer is working per hour of active time">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <Stat label="Appts per hour" value={core.appointmentsPerHour > 0 ? core.appointmentsPerHour.toFixed(1) : '—'} accent />
            <Stat label="Dials per hour" value={core.dialsPerHour > 0 ? core.dialsPerHour.toFixed(1) : '—'} />
            {showCost && <Stat label="CPL (cost / appt)" value={fmtCents(displayCostPerAppt)} accent />}
            <Stat label="Total appointments" value={core.appointments.toLocaleString()} />
          </div>
        </Section>

        {/* ── Cost ── */}
        {showCost && (
          <Section title="Cost" sub={scope.scope === 'self' ? 'Your share of the SDR plan' : 'What this is costing the account'}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <Stat label="Total spend (30d)" value={fmtCents(displayCostCents)} />
              <Stat label="Cost / connect" value={core.connects > 0 ? fmtCents(Math.round(displayCostCents / core.connects)) : '—'} />
              <Stat label="Cost / dial" value={core.dials > 0 ? fmtCents(Math.round(displayCostCents / core.dials)) : '—'} />
            </div>
          </Section>
        )}

        {/* ── Risk + lead-quality coming-soon stubs ── */}
        <Section title="Risk + lead quality" sub="Tracking lands once we wire opt-out NLU + lead-list schema">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            <ComingSoon
              title="Opt-out rate"
              value={`${core.optOutRatePct}%`}
              note={`${core.optOutCount} of ${core.dials} flagged via transcript regex (early signal — proper NLU upgrade pending)`}
            />
            <ComingSoon
              title="Risk score"
              value="—"
              note="Composite of opt-out rate + carrier failures + dial pace. Lights up once opt-out NLU lands."
            />
            <ComingSoon
              title="Lead quality by list"
              value="—"
              note="Connect rate + appt rate split by lead list / campaign. Needs the lead-list schema (next sprint)."
            />
          </div>
        </Section>
      </section>
    </main>
  )
}

// ── Hero KPI grid ────────────────────────────────────────────────────────

function KpiGrid({
  core,
  comparison,
}: {
  core: DialerCorePerf
  comparison: DialerCorePerf | null
}) {
  return (
    <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginBottom: '1rem' }}>
      <KpiCard
        label="Connect rate"
        value={`${core.connectRatePct}%`}
        sub={`${core.connects.toLocaleString()} of ${core.dials.toLocaleString()} dials`}
        compare={comparison ? compareLine(core.connectRatePct, comparison.connectRatePct, 'pct') : undefined}
      />
      <KpiCard
        label="Talk utilization"
        value={`${core.talkUtilizationPct}%`}
        sub="Talk time ÷ active dialer time"
        compare={comparison ? compareLine(core.talkUtilizationPct, comparison.talkUtilizationPct, 'pct') : undefined}
      />
      <KpiCard
        label="Avg call"
        value={fmtSeconds(core.avgDurationSec)}
        sub={`${fmtSeconds(core.talkSeconds)} total talk time`}
        compare={comparison ? compareLine(core.avgDurationSec, comparison.avgDurationSec, 'seconds') : undefined}
      />
      <KpiCard
        label="Appointments"
        value={core.appointments.toLocaleString()}
        sub={`${core.conversionRatePct}% conversion`}
        compare={comparison ? compareLine(core.appointments, comparison.appointments, 'count') : undefined}
        accent
      />
      <KpiCard
        label="Opt-out rate"
        value={`${core.optOutRatePct}%`}
        sub="Transcript regex (early signal)"
        compare={comparison ? compareLine(core.optOutRatePct, comparison.optOutRatePct, 'pct', { lowerIsBetter: true }) : undefined}
      />
    </section>
  )
}

function compareLine(
  self: number,
  baseline: number,
  unit: 'pct' | 'seconds' | 'count',
  opts: { lowerIsBetter?: boolean } = {},
): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  const better = opts.lowerIsBetter ? self < baseline : self > baseline
  const same = self === baseline
  const tone: 'good' | 'bad' | 'neutral' = same ? 'neutral' : better ? 'good' : 'bad'
  if (baseline === 0 && self === 0) return { text: 'no account avg yet', tone: 'neutral' }
  let label: string
  if (unit === 'pct') label = `${baseline}% account avg`
  else if (unit === 'seconds') label = `${fmtSeconds(baseline)} account avg`
  else label = `${baseline.toLocaleString()} account avg`
  const arrow = same ? '·' : better ? '↑' : '↓'
  return { text: `${arrow} ${label}`, tone }
}

// ── Sub-components ───────────────────────────────────────────────────────

function Section({
  title,
  sub,
  children,
}: {
  title: string
  sub?: string
  children: React.ReactNode
}) {
  return (
    <section style={{ marginTop: '1.2rem' }}>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>{title}</h2>
        {sub && <p className="meta" style={{ margin: '2px 0 0', fontSize: 12 }}>{sub}</p>}
      </div>
      {children}
    </section>
  )
}

function KpiCard({
  label,
  value,
  sub,
  compare,
  accent,
}: {
  label: string
  value: string
  sub?: string
  compare?: { text: string; tone: 'good' | 'bad' | 'neutral' }
  accent?: boolean
}) {
  return (
    <div style={{
      background: accent ? '#fef3c7' : 'var(--paper)',
      border: '1px solid var(--border-soft)',
      borderRadius: 12,
      padding: '12px 14px',
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', margin: 0 }}>
        {label}
      </p>
      <p style={{ fontSize: 22, fontWeight: 700, margin: '4px 0 2px', color: '#0f172a', lineHeight: 1.1 }}>{value}</p>
      {sub && <p className="meta" style={{ margin: 0, fontSize: 11 }}>{sub}</p>}
      {compare && (
        <p style={{
          margin: '6px 0 0',
          fontSize: 11,
          fontWeight: 700,
          color: compare.tone === 'good' ? '#16a34a' : compare.tone === 'bad' ? '#b91c1c' : 'var(--muted)',
        }}>
          {compare.text}
        </p>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? '#fef3c7' : 'var(--paper)',
      border: '1px solid var(--border-soft)',
      borderRadius: 10,
      padding: '8px 12px',
    }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 0', color: '#0f172a' }}>{value}</p>
    </div>
  )
}

function ComingSoon({ title, value, note }: { title: string; value: string; note: string }) {
  return (
    <div style={{
      background: '#f8fafc',
      border: '1px dashed #cbd5e1',
      borderRadius: 10,
      padding: '10px 14px',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', margin: 0 }}>{title}</p>
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 999, background: '#e0e7ff', color: '#3730a3', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          early
        </span>
      </div>
      <p style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 4px', color: '#0f172a' }}>{value}</p>
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.4 }}>{note}</p>
    </div>
  )
}

// ── Tables + chart ──────────────────────────────────────────────────────

function PerModeTable({ rows }: { rows: PerModeRow[] }) {
  const totalDials = rows.reduce((acc, r) => acc + r.dials, 0)
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr style={trHead}>
            <th style={th}>Mode</th>
            <th style={th}>Dials</th>
            <th style={th}>Connect %</th>
            <th style={th}>Avg call</th>
            <th style={th}>Appts</th>
            <th style={th}>Conv %</th>
            <th style={th}>Cost / appt</th>
            <th style={th}>Talk util</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = totalDials > 0 ? Math.round((r.dials / totalDials) * 100) : 0
            return (
              <tr key={r.mode} style={trRow}>
                <td style={td}>
                  <strong>{r.label}</strong>
                  <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--muted)' }}>{share}% of dials</span>
                </td>
                <td style={td}>{r.dials.toLocaleString()}</td>
                <td style={td}>{r.connectRatePct}%</td>
                <td style={td}>{fmtSeconds(r.avgDurationSec)}</td>
                <td style={td}>{r.appointments.toLocaleString()}</td>
                <td style={td}>{r.conversionRatePct}%</td>
                <td style={td}>{fmtCents(r.costPerAppointmentCents)}</td>
                <td style={td}>{r.talkUtilizationPct}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PerMemberTable({ rows }: { rows: PerMemberRow[] }) {
  return (
    <div style={tableWrap}>
      <table style={tableStyle}>
        <thead>
          <tr style={trHead}>
            <th style={th}>#</th>
            <th style={th}>Rep</th>
            <th style={th}>Dials</th>
            <th style={th}>Connect %</th>
            <th style={th}>Talk time</th>
            <th style={th}>Avg call</th>
            <th style={th}>Appts</th>
            <th style={th}>Conv %</th>
            <th style={th}>Cost / appt</th>
            <th style={th}>Opt-out %</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.memberId} style={trRow}>
              <td style={td}>{i + 1}</td>
              <td style={td}><strong>{r.displayName}</strong></td>
              <td style={td}>{r.dials.toLocaleString()}</td>
              <td style={td}>{r.connectRatePct}%</td>
              <td style={td}>{fmtSeconds(r.talkSeconds)}</td>
              <td style={td}>{fmtSeconds(r.avgDurationSec)}</td>
              <td style={td}>{r.appointments.toLocaleString()}</td>
              <td style={td}>{r.conversionRatePct}%</td>
              <td style={td}>{fmtCents(r.costPerAppointmentCents)}</td>
              <td style={{ ...td, color: r.optOutRatePct > 5 ? '#b91c1c' : '#0f172a', fontWeight: r.optOutRatePct > 5 ? 600 : 400 }}>
                {r.optOutRatePct}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TrendChart({ data }: { data: DailyTrendPoint[] }) {
  if (data.length === 0) {
    return <p className="meta" style={{ fontSize: 13 }}>No data in window.</p>
  }
  const maxDials = Math.max(1, ...data.map((d) => d.dials))
  const maxConnects = Math.max(1, ...data.map((d) => d.connects))
  const maxAppts = Math.max(1, ...data.map((d) => d.appointments))
  const yMax = Math.max(maxDials, maxConnects, maxAppts)

  return (
    <div style={{ background: 'var(--paper)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 8, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <LegendDot color="#94a3b8" label={`Dials (max ${maxDials})`} />
        <LegendDot color="#0ea5e9" label={`Connects (max ${maxConnects})`} />
        <LegendDot color="#16a34a" label={`Appointments (max ${maxAppts})`} />
      </div>
      {/* Tiny inline svg bar chart — three bars per day stacked horizontally. */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 2, alignItems: 'end', height: 100 }}>
        {data.map((d) => {
          const dh = (d.dials / yMax) * 100
          const ch = (d.connects / yMax) * 100
          const ah = (d.appointments / yMax) * 100
          return (
            <div key={d.day} title={`${d.day}: ${d.dials} dials · ${d.connects} connects · ${d.appointments} appts`} style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: '100%' }}>
              <div style={{ background: '#94a3b8', width: '33%', height: `${dh}%`, borderRadius: 1 }} />
              <div style={{ background: '#0ea5e9', width: '33%', height: `${ch}%`, borderRadius: 1 }} />
              <div style={{ background: '#16a34a', width: '33%', height: `${ah}%`, borderRadius: 1 }} />
            </div>
          )
        })}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
        <span>{data[0]?.day}</span>
        <span>{data[data.length - 1]?.day}</span>
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span style={{ width: 8, height: 8, background: color, borderRadius: 2 }} />
      {label}
    </span>
  )
}

// ── Styles ──────────────────────────────────────────────────────────────

const tableWrap: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--border-soft)',
  borderRadius: 12,
  overflow: 'auto',
}

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
}

const trHead: React.CSSProperties = {
  background: '#f8fafc',
  borderBottom: '1px solid var(--border-soft)',
}

const trRow: React.CSSProperties = {
  borderBottom: '1px solid var(--border-soft)',
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--muted)',
}

const td: React.CSSProperties = {
  padding: '8px 10px',
  color: '#0f172a',
}
