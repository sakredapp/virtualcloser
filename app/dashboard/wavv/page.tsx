// WAVV dashboard. Surface for the addon_wavv_kpi customer.
//
// Data source: voice_calls rows where provider in ('wavv','ghl') — fed
// either by the GHL Call Status workflow webhook (primary path for the
// 100% of WAVV-on-GHL clients) or by a direct/Zapier post to
// /api/webhooks/wavv/[repId]. Both paths land in the same table, so this
// page works regardless of how the client delivers their dispositions.
//
// What we render:
//   1. Today KPI strip (dials/connects/conversations/appts-set/cost)
//   2. 14-day sparkline-ish daily trend table
//   3. Disposition mix (raw WAVV labels — talked, no_answer, voicemail,
//      etc — counted from voice_calls.raw)
//   4. Recent calls list with recording playback + lead linkage

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getActiveAddonKeys } from '@/lib/entitlements'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { getKpisForRep, getDispositionMix, getRecentWavvCalls } from '@/lib/wavv'

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

export default async function WavvPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenantId: string
  let viewerMember: Awaited<ReturnType<typeof requireMember>>['member'] | null = null
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

  const [kpis, dispoMix, recentCalls] = await Promise.all([
    getKpisForRep(tenantId, { days: 14 }).catch(() => []),
    getDispositionMix(tenantId, 30).catch(() => []),
    getRecentWavvCalls(tenantId, 25).catch(() => []),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const todayKpi = kpis.find((k) => k.day === today)

  // Roll up 14-day totals for context next to "today".
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
  const apptRate = total14.connects
    ? Math.round((total14.appointments_set / total14.connects) * 100)
    : 0

  const dispoTotal = dispoMix.reduce((s, d) => s + d.count, 0)
  const maxDailyDials = Math.max(1, ...kpis.map((k) => k.dials))

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">WAVV · Daily dialer analytics</p>
          <h1>Dial activity</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            Fed live from your GHL Call Status webhook — dials, connects, appointments, and disposition mix in one place.
          </p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* Today KPI strip */}
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>Today</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 12,
          }}
        >
          {(
            [
              ['Dials', todayKpi?.dials ?? 0],
              ['Connects', todayKpi?.connects ?? 0],
              ['Conversations', todayKpi?.conversations ?? 0],
              ['Appts set', todayKpi?.appointments_set ?? 0],
              ['Talk time', fmtDuration(todayKpi?.dial_time_seconds ?? 0)],
            ] as Array<[string, string | number]>
          ).map(([label, value]) => (
            <div
              key={label}
              style={{
                background: 'var(--paper)',
                color: 'var(--ink)',
                borderRadius: 10,
                padding: '12px 14px',
                boxShadow: '0 1px 0 rgba(0,0,0,.05)',
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 14-day rollup + ratios */}
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1rem', margin: '0 0 8px' }}>Last 14 days</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
          }}
        >
          {(
            [
              ['Total dials', total14.dials],
              ['Connect rate', `${connectRate}%`],
              ['Conversations', total14.conversations],
              ['Conv → appt', `${apptRate}%`],
            ] as Array<[string, string | number]>
          ).map(([label, value]) => (
            <div
              key={label}
              style={{
                background: 'var(--paper)',
                color: 'var(--ink)',
                borderRadius: 10,
                padding: '12px 14px',
                boxShadow: '0 1px 0 rgba(0,0,0,.05)',
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Daily trend bar table */}
      <section style={{ marginTop: '0.8rem' }}>
        <div
          style={{
            background: 'var(--paper)',
            color: 'var(--ink)',
            borderRadius: 12,
            padding: '14px 16px',
            boxShadow: '0 1px 0 rgba(0,0,0,.05)',
          }}
        >
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
                        <div
                          style={{
                            width: `${(k.dials / maxDailyDials) * 100}%`,
                            height: '100%',
                            background: 'var(--red, #ff2800)',
                          }}
                        />
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
        <div
          style={{
            background: 'var(--paper)',
            color: 'var(--ink)',
            borderRadius: 12,
            padding: '14px 16px',
            boxShadow: '0 1px 0 rgba(0,0,0,.05)',
          }}
        >
          <h2 style={{ fontSize: '1rem', margin: '0 0 4px' }}>Disposition mix · last 30 days</h2>
          <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
            Raw WAVV/GHL disposition labels exactly as they were sent — no normalization. Useful
            for spotting which outcomes WAVV is actually emitting (e.g. &quot;left_message&quot; vs
            &quot;voicemail&quot;).
          </p>
          {dispoMix.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>No calls in window.</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
              {dispoMix.map((d) => {
                const pct = dispoTotal ? Math.round((d.count / dispoTotal) * 100) : 0
                return (
                  <li key={d.disposition} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 140, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {d.disposition}
                    </span>
                    <div style={{ flex: 1, background: '#f1f1f1', borderRadius: 4, height: 10 }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          background: 'var(--red, #ff2800)',
                          borderRadius: 4,
                        }}
                      />
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
        <div
          style={{
            background: 'var(--paper)',
            color: 'var(--ink)',
            borderRadius: 12,
            padding: '14px 16px',
            boxShadow: '0 1px 0 rgba(0,0,0,.05)',
          }}
        >
          <h2 style={{ fontSize: '1rem', margin: '0 0 10px' }}>Recent calls</h2>
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
                  <th style={{ padding: '6px 8px' }}>Lead</th>
                  <th style={{ padding: '6px 8px' }}>To</th>
                  <th style={{ padding: '6px 8px' }}>Duration</th>
                  <th style={{ padding: '6px 8px' }}>Disposition</th>
                  <th style={{ padding: '6px 8px' }}>Recording</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '6px 8px' }}>{fmtTime(c.created_at)}</td>
                    <td style={{ padding: '6px 8px' }}>{c.lead_name ?? '—'}</td>
                    <td style={{ padding: '6px 8px', fontFamily: 'ui-monospace, monospace' }}>
                      {fmtPhone(c.to_number)}
                    </td>
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
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  )
}
