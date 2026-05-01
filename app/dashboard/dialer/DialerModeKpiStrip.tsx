// 5-card KPI strip mounted at the top of each dialer mode subroute
// (Receptionist, Appointment Setter, Live Transfer, Workflows). Same data
// source as the deep-dive analytics page — just scoped to ONE mode and
// the viewer's data scope (self / team / account).
//
// Server component. Pulls last-30-day metrics for the given mode and
// renders the 5 hero metrics ChatGPT flagged: connect rate, talk
// utilization, avg duration, appointments, opt-out rate.

import { fmtSeconds, getDialerCorePerf, type DialerMode } from '@/lib/dialerAnalytics'
import type { MemberDataScope } from '@/lib/permissions'
import Link from 'next/link'

export default async function DialerModeKpiStrip({
  repId,
  scope,
  mode,
  modeLabel,
}: {
  repId: string
  scope: MemberDataScope
  mode: DialerMode
  modeLabel: string
}) {
  const core = await getDialerCorePerf(repId, scope, { days: 30, mode })

  const scopeWord =
    scope.scope === 'self' ? 'your' :
    scope.scope === 'team' ? 'team' :
    'org-wide'

  return (
    <section style={{ margin: '0 24px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', margin: 0 }}>
          {modeLabel} · {scopeWord} last 30 days
        </p>
        <Link
          href="/dashboard/dialer/analytics"
          style={{ fontSize: 11, fontWeight: 600, color: '#3730a3', textDecoration: 'underline' }}
        >
          Full analytics →
        </Link>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
        <Card label="Connect rate" value={`${core.connectRatePct}%`} sub={`${core.connects.toLocaleString()} of ${core.dials.toLocaleString()}`} />
        <Card label="Talk util" value={`${core.talkUtilizationPct}%`} sub="talk ÷ active" />
        <Card label="Avg call" value={fmtSeconds(core.avgDurationSec)} sub={fmtSeconds(core.talkSeconds) + ' total'} />
        <Card label="Appts" value={core.appointments.toLocaleString()} sub={`${core.conversionRatePct}% conv`} accent />
        <Card label="Opt-out" value={`${core.optOutRatePct}%`} sub={`${core.optOutCount} flagged`} />
      </div>
    </section>
  )
}

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div style={{
      background: accent ? '#fef3c7' : 'var(--paper)',
      border: '1px solid #e5e7eb',
      borderRadius: 10,
      padding: '8px 12px',
    }}>
      <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', margin: 0 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 700, margin: '2px 0 0', color: '#0f172a', lineHeight: 1.1 }}>{value}</p>
      {sub && <p style={{ fontSize: 10, color: 'var(--muted)', margin: '2px 0 0' }}>{sub}</p>}
    </div>
  )
}
