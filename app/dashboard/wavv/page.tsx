// WAVV dashboard — individual and enterprise (role-aware).
//
// Role views:
//   rep      → own call data (filtered by owner_member_id)
//   manager  → East/West team aggregate + per-rep breakdown
//   owner    → account-wide totals + per-rep leaderboard
//   admin    → same as owner
//
// Data source: voice_calls (provider in 'wavv'|'ghl').
// dialer_kpis stores tenant-level daily rollups — used for the individual
// Today/14-day strips. Per-member data comes from voice_calls directly via
// owner_member_id, which is set when calls are ingested through a per-member
// webhook. Enterprise clients configure one webhook URL per rep.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getActiveAddonKeys } from '@/lib/entitlements'
import { resolveMemberDataScope } from '@/lib/permissions'
import { listMembers } from '@/lib/members'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import {
  getKpisForRep,
  getDispositionMix,
  getRecentWavvCalls,
  getMemberWavvSummaries,
  getTeamWavvTotals,
  getRecentWavvCallsForMembers,
  type MemberWavvSummary,
} from '@/lib/wavv'
import type { Member } from '@/types'

export const dynamic = 'force-dynamic'

function fmtDuration(sec: number | null): string {
  if (sec === null || sec === undefined) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtPhone(p: string | null): string {
  if (!p) return '—'
  const d = p.replace(/\D/g, '').slice(-10)
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  return p
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const card: React.CSSProperties = {
  background: 'var(--paper)',
  color: 'var(--ink)',
  borderRadius: 12,
  padding: '14px 16px',
  boxShadow: '0 1px 0 rgba(0,0,0,.05)',
}

function KpiStrip({ items }: { items: Array<[string, string | number]> }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 12 }}>
      {items.map(([label, value]) => (
        <div key={label} style={card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function RepBreakdownTable({
  summaries,
  memberMap,
}: {
  summaries: MemberWavvSummary[]
  memberMap: Map<string, string>
}) {
  if (summaries.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
        No per-rep WAVV data yet. Each rep needs their own webhook URL configured in WAVV.
        <br />
        Webhook pattern: <code>/api/webhooks/wavv/[repId]?member=[memberId]</code>
      </p>
    )
  }
  const sorted = [...summaries].sort((a, b) => b.dials - a.dials)
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
          <th style={{ padding: '6px 8px' }}>Rep</th>
          <th style={{ padding: '6px 8px' }}>Dials</th>
          <th style={{ padding: '6px 8px' }}>Connects</th>
          <th style={{ padding: '6px 8px' }}>Convs</th>
          <th style={{ padding: '6px 8px' }}>Appts</th>
          <th style={{ padding: '6px 8px' }}>Connect %</th>
          <th style={{ padding: '6px 8px' }}>Talk time</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((s) => {
          const connectPct = s.dials ? Math.round((s.connects / s.dials) * 100) : 0
          return (
            <tr key={s.member_id} style={{ borderTop: '1px solid #eee' }}>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{memberMap.get(s.member_id) ?? s.member_id.slice(0, 8)}</td>
              <td style={{ padding: '6px 8px' }}>{s.dials}</td>
              <td style={{ padding: '6px 8px' }}>{s.connects}</td>
              <td style={{ padding: '6px 8px' }}>{s.conversations}</td>
              <td style={{ padding: '6px 8px', fontWeight: 600 }}>{s.appointments_set}</td>
              <td style={{ padding: '6px 8px' }}>{connectPct}%</td>
              <td style={{ padding: '6px 8px' }}>{fmtDuration(s.dial_time_seconds)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default async function WavvPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenantId: string
  let viewerMember: Member | null = null
  try {
    const ctx = await requireMember()
    tenantId = ctx.tenant.id
    viewerMember = ctx.member
  } catch {
    redirect('/login')
    return null
  }

  const active = await getActiveAddonKeys(tenantId)
  if (!active.has('addon_wavv_kpi')) {
    redirect('/dashboard')
    return null
  }

  const navTabs = await buildDashboardTabs(tenantId, viewerMember)
  const role = viewerMember?.role ?? 'rep'
  const isEnterpriseView = role === 'manager' || role === 'owner' || role === 'admin'

  // Resolve which member IDs this viewer can see.
  const scope = viewerMember ? await resolveMemberDataScope(viewerMember) : null
  const memberIds = scope?.memberIds ?? null // null = all account

  // Build a display-name map if enterprise view.
  let memberMap = new Map<string, string>()
  if (isEnterpriseView) {
    const allMembers = await listMembers(tenantId).catch(() => [] as Member[])
    memberMap = new Map(allMembers.map((m) => [m.id, m.display_name]))
  }

  const [kpis, dispoMix, recentCalls, teamSummaries, teamTotals] = await Promise.all([
    getKpisForRep(tenantId, { days: 14 }).catch(() => []),
    getDispositionMix(tenantId, 30).catch(() => []),
    isEnterpriseView
      ? getRecentWavvCallsForMembers(tenantId, memberIds, 25).catch(() => [])
      : getRecentWavvCalls(tenantId, 25).catch(() => []),
    isEnterpriseView
      ? getMemberWavvSummaries(tenantId, memberIds ?? [], 14).catch(() => [])
      : Promise.resolve([] as MemberWavvSummary[]),
    isEnterpriseView
      ? getTeamWavvTotals(tenantId, memberIds, 14).catch(() => null)
      : Promise.resolve(null),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const todayKpi = kpis.find((k) => k.day === today)

  const total14 = kpis.reduce(
    (acc, k) => {
      acc.dials += k.dials
      acc.connects += k.connects
      acc.conversations += k.conversations
      acc.appointments_set += k.appointments_set
      return acc
    },
    { dials: 0, connects: 0, conversations: 0, appointments_set: 0 },
  )
  const connectRate = total14.dials ? Math.round((total14.connects / total14.dials) * 100) : 0
  const apptRate = total14.connects ? Math.round((total14.appointments_set / total14.connects) * 100) : 0

  const dispoTotal = dispoMix.reduce((s, d) => s + d.count, 0)
  const maxDailyDials = Math.max(1, ...kpis.map((k) => k.dials))

  const eyebrowLabel =
    role === 'owner' || role === 'admin'
      ? 'WAVV · Account-wide analytics'
      : role === 'manager'
        ? 'WAVV · Team analytics'
        : 'WAVV · Daily dialer analytics'

  const heroSub =
    role === 'owner' || role === 'admin'
      ? 'Account-wide WAVV call activity across all reps and teams.'
      : role === 'manager'
        ? 'Your team\'s WAVV call activity. Rep-level breakdown requires per-rep webhook configuration.'
        : 'Fed live from your GHL Call Status webhook — dials, connects, appointments, and disposition mix in one place.'

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">{eyebrowLabel}</p>
          <h1>Dial activity</h1>
          <p className="sub" style={{ marginTop: 0 }}>{heroSub}</p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* ── Enterprise: team/account aggregate strip ── */}
      {isEnterpriseView && teamTotals && (
        <section style={{ marginTop: '0.8rem' }}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>
            {role === 'manager' ? 'Team · last 14 days' : 'Account · last 14 days'}
          </h2>
          <KpiStrip items={[
            ['Total dials', teamTotals.dials],
            ['Connects', teamTotals.connects],
            ['Conversations', teamTotals.conversations],
            ['Appts set', teamTotals.appointments_set],
            ['Talk time', fmtDuration(teamTotals.dial_time_seconds)],
            ['Connect %', teamTotals.dials ? `${Math.round((teamTotals.connects / teamTotals.dials) * 100)}%` : '—'],
          ]} />
        </section>
      )}

      {/* ── Enterprise: per-rep breakdown ── */}
      {isEnterpriseView && (
        <section style={{ marginTop: '0.8rem' }}>
          <div style={card}>
            <h2 style={{ fontSize: '1rem', margin: '0 0 10px' }}>
              {role === 'manager' ? 'Rep breakdown · last 14 days' : 'All reps · last 14 days'}
            </h2>
            <RepBreakdownTable summaries={teamSummaries} memberMap={memberMap} />
          </div>
        </section>
      )}

      {/* Today KPI strip */}
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>
          {isEnterpriseView ? 'Account today (webhook rollup)' : 'Today'}
        </h2>
        <KpiStrip items={[
          ['Dials', todayKpi?.dials ?? 0],
          ['Connects', todayKpi?.connects ?? 0],
          ['Conversations', todayKpi?.conversations ?? 0],
          ['Appts set', todayKpi?.appointments_set ?? 0],
          ['Talk time', fmtDuration(todayKpi?.dial_time_seconds ?? 0)],
        ]} />
      </section>

      {/* 14-day rollup + ratios */}
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>Last 14 days</h2>
        <KpiStrip items={[
          ['Total dials', total14.dials],
          ['Connect rate', `${connectRate}%`],
          ['Conversations', total14.conversations],
          ['Conv → appt', `${apptRate}%`],
        ]} />
      </section>

      {/* Daily trend bar table */}
      <section style={{ marginTop: '0.8rem' }}>
        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 10px' }}>Daily trend</h2>
          {kpis.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              No call activity yet. As soon as your GHL Call Status workflow fires for a
              real call, it&apos;ll show up here within seconds.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '6px 8px' }}>Day</th>
                  <th style={{ padding: '6px 8px' }}>Dials</th>
                  <th style={{ padding: '6px 8px' }}>Connects</th>
                  <th style={{ padding: '6px 8px' }}>Convs</th>
                  <th style={{ padding: '6px 8px' }}>Appts</th>
                  <th style={{ padding: '6px 8px', width: '40%' }}>Volume</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((k) => (
                  <tr key={k.day} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{k.day}</td>
                    <td style={{ padding: '6px 8px' }}>{k.dials}</td>
                    <td style={{ padding: '6px 8px' }}>{k.connects}</td>
                    <td style={{ padding: '6px 8px' }}>{k.conversations}</td>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{k.appointments_set}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <div style={{ background: '#f1f1f1', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <div style={{ width: `${(k.dials / maxDailyDials) * 100}%`, height: '100%', background: 'var(--red, #ff2800)' }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Disposition mix (last 30 days) */}
      <section style={{ marginTop: '0.8rem' }}>
        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 4px' }}>Disposition mix · last 30 days</h2>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
            Raw WAVV/GHL disposition labels exactly as they were sent — no normalization.
          </p>
          {dispoMix.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>No calls in window.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {dispoMix.map((d) => {
                const pct = dispoTotal ? Math.round((d.count / dispoTotal) * 100) : 0
                return (
                  <li key={d.disposition} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 140, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{d.disposition}</span>
                    <div style={{ flex: 1, background: '#f1f1f1', borderRadius: 4, height: 10 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: 'var(--red, #ff2800)', borderRadius: 4 }} />
                    </div>
                    <span style={{ width: 70, textAlign: 'right', fontSize: 12 }}>
                      {d.count} <span style={{ color: 'var(--muted)' }}>({pct}%)</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Recent calls */}
      <section style={{ marginTop: '0.8rem' }}>
        <div style={card}>
          <h2 style={{ fontSize: '1rem', margin: '0 0 10px' }}>
            {isEnterpriseView ? 'Recent calls · all reps' : 'Recent calls'}
          </h2>
          {recentCalls.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>
              No calls yet. Configure the GHL workflow on your Onboarding checklist to start
              streaming dispositions in.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                  <th style={{ padding: '6px 8px' }}>Time</th>
                  {isEnterpriseView && <th style={{ padding: '6px 8px' }}>Rep</th>}
                  <th style={{ padding: '6px 8px' }}>Lead</th>
                  <th style={{ padding: '6px 8px' }}>To</th>
                  <th style={{ padding: '6px 8px' }}>Duration</th>
                  <th style={{ padding: '6px 8px' }}>Disposition</th>
                  <th style={{ padding: '6px 8px' }}>Recording</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.map((c) => {
                  // When isEnterpriseView is true, recentCalls came from
                  // getRecentWavvCallsForMembers which always includes owner_member_id.
                  const memberId = isEnterpriseView
                    ? ((c as { owner_member_id?: string | null }).owner_member_id ?? null)
                    : null
                  return (
                    <tr key={c.id} style={{ borderTop: '1px solid #eee' }}>
                      <td style={{ padding: '6px 8px' }}>{fmtTime(c.created_at)}</td>
                      {isEnterpriseView && (
                        <td style={{ padding: '6px 8px', fontSize: 12 }}>
                          {memberId ? (memberMap.get(memberId) ?? '—') : '—'}
                        </td>
                      )}
                      <td style={{ padding: '6px 8px' }}>{c.lead_name ?? '—'}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>{fmtPhone(c.to_number)}</td>
                      <td style={{ padding: '6px 8px' }}>{fmtDuration(c.duration_sec)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                          {c.disposition_raw ?? c.outcome ?? '—'}
                        </span>
                      </td>
                      <td style={{ padding: '6px 8px' }}>
                        {c.recording_url ? (
                          <a href={c.recording_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red, #ff2800)' }}>
                            ▶ play
                          </a>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  )
}
