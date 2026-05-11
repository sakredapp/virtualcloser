// Dialer dashboard. Shows upcoming meetings with confirmation status,
// recent voice calls (with transcripts/recordings), and today's KPI roll-up.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import { listUpcomingMeetingsForRep } from '@/lib/meetings'
import { getKpisForRep } from '@/lib/wavv'
import { supabase } from '@/lib/supabase'
import { dispatchConfirmCall } from '@/lib/voice/dialer'
import { revalidatePath } from 'next/cache'
import UsageStrip from '../UsageStrip'
import { getDialerSettings } from '@/lib/voice/dialerSettings'
import DialerSettingsCard from './DialerSettingsCard'
// Liability gate is mounted in app/dashboard/dialer/layout.tsx so it
// covers every dialer subroute, not just this index.

export const dynamic = 'force-dynamic'

const MODE_SWATCHES = [
  {
    mode: 'concierge' as const,
    label: 'Receptionist',
    emoji: '🤝',
    tagline: 'Confirms every appointment 30–60 min before it starts. Reschedules on request. Protects your show-rate.',
    color: '#22c55e',
    bg: '#dcfce7',
    textColor: '#166534',
    href: '/dashboard/dialer/receptionist',
    features: ['Auto-confirm calls', 'Reschedule handling', 'Post-call summaries', 'Custom script'],
  },
  {
    mode: 'appointment_setter' as const,
    label: 'AI SDR',
    emoji: '📞',
    tagline: 'Run multiple AI SDRs at once: each has its own scripts, persona, schedule, leads, and GHL push mapping.',
    color: '#3b82f6',
    bg: '#dbeafe',
    textColor: '#1d4ed8',
    href: '/dashboard/dialer/appointment-setter',
    features: ['Per-setter lead import', 'Conflict preview + skip', 'Persona/script tabs', 'Calendar + CRM push status'],
  },
  {
    mode: 'live_transfer' as const,
    label: 'Live Transfer',
    emoji: '⚡',
    tagline: 'Qualifies leads on the phone, then passes the live call straight to a human rep. Falls back to booking if no one is free.',
    color: '#f97316',
    bg: '#fff7ed',
    textColor: '#c2410c',
    href: '/dashboard/dialer/live-transfer',
    features: ['Real-time handoff', 'Availability windows', 'Round-robin routing', 'Fallback booking'],
  },
  {
    mode: 'pipeline' as const,
    label: 'Workflows',
    emoji: '⚙️',
    tagline: 'Trigger-based outbound calls — payment overdue, no-show follow-up, stage-change re-engagement.',
    color: '#8b5cf6',
    bg: '#f3e8ff',
    textColor: '#6b21a8',
    href: '/dashboard/dialer/workflows',
    features: ['Trigger rules', 'Queue management', 'Rep opt-in', 'Workflow analytics'],
  },
] as const

const STATUS_COLORS: Record<string, string> = {
  scheduled: '#94a3b8',
  confirmed: '#22c55e',
  reschedule_requested: '#f59e0b',
  rescheduled: '#60a5fa',
  cancelled: '#ef4444',
  no_response: '#a78bfa',
  completed: '#64748b',
  noshow: '#ef4444',
}

export default async function DialerPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenant
  let memberRole: string = 'rep'
  let viewerMember: Awaited<ReturnType<typeof requireMember>>['member'] | null = null
  try {
    const ctx = await requireMember()
    tenant = ctx.tenant
    memberRole = (ctx.member.role as string) ?? 'rep'
    viewerMember = ctx.member
  } catch {
    redirect('/login')
  }
  const navTabs = await buildDashboardTabs(tenant!.id, viewerMember)

  const fromIso = new Date().toISOString()
  const toIso = new Date(Date.now() + 7 * 86400_000).toISOString()
  const meetings = await listUpcomingMeetingsForRep(tenant.id, { fromIso, toIso, limit: 50 })

  const dialerSettings = await getDialerSettings(tenant.id)
  const canEditDialerSettings = tenant.tier === 'individual' || ['owner', 'admin'].includes(memberRole)

  const { data: recentCalls } = await supabase
    .from('voice_calls')
    .select('*')
    .eq('rep_id', tenant.id)
    .order('created_at', { ascending: false })
    .limit(20)

  // ── Status buckets (last 30 days) ─────────────────────────────────────
  // We split into TWO families:
  //   1. Meeting outcomes — what the appointment ended up as. Driven by the
  //      meeting status the confirm/reschedule webhooks write back. Tells the
  //      rep whether they need to follow up manually.
  //   2. Voice-call outcomes — whether the dialer actually got through. Tells
  //      ops whether the dialer itself is healthy (no_answer, voicemail, etc).
  const since30Iso = new Date(Date.now() - 30 * 86400_000).toISOString()
  const [{ data: bucketMeetings }, { data: bucketCalls }] = await Promise.all([
    supabase
      .from('meetings')
      .select('status')
      .eq('rep_id', tenant.id)
      .gte('scheduled_at', since30Iso),
    supabase
      .from('voice_calls')
      .select('status,outcome')
      .eq('rep_id', tenant.id)
      .gte('created_at', since30Iso),
  ])

  function count<T extends { status?: string | null; outcome?: string | null }>(
    rows: T[] | null | undefined,
    field: 'status' | 'outcome',
    values: string[],
  ): number {
    if (!rows) return 0
    return rows.filter((r) => values.includes(String(r[field] ?? ''))).length
  }

  const meetingBuckets = [
    { label: 'Confirmed', color: '#22c55e', n: count(bucketMeetings, 'status', ['confirmed']) },
    { label: 'Rescheduled', color: '#60a5fa', n: count(bucketMeetings, 'status', ['rescheduled']) },
    {
      label: 'No answer',
      color: '#a78bfa',
      n: count(bucketMeetings, 'status', ['no_response']),
    },
    { label: 'Cancelled', color: '#ef4444', n: count(bucketMeetings, 'status', ['cancelled']) },
    {
      label: 'Pending',
      color: '#94a3b8',
      n: count(bucketMeetings, 'status', ['scheduled', 'reschedule_requested']),
    },
  ]
  const callBuckets = [
    {
      label: 'Picked up',
      color: '#22c55e',
      n: count(bucketCalls, 'outcome', ['answered', 'confirmed', 'reschedule_requested']),
    },
    {
      label: 'Voicemail',
      color: '#f59e0b',
      n: count(bucketCalls, 'outcome', ['voicemail']),
    },
    {
      label: 'No answer',
      color: '#a78bfa',
      n: count(bucketCalls, 'outcome', ['no_answer', 'busy']),
    },
    {
      label: 'Failed',
      color: '#ef4444',
      n: count(bucketCalls, 'status', ['failed', 'blocked_cap']),
    },
  ]

  const kpis = await getKpisForRep(tenant.id, { days: 7 }).catch(() => [])
  const today = new Date().toISOString().slice(0, 10)
  const todayKpi = kpis.find((k) => k.day === today)

  // Cost shown to clients is computed from a separately-stored display rate,
  // never from voice_calls.cost_cents (which holds our actual provider cost).
  // When the display rate is NULL we hide the KPI entirely.
  const { data: rateRow } = await supabase
    .from('reps')
    .select('client_display_rate_per_minute_cents')
    .eq('id', tenant.id)
    .maybeSingle<{ client_display_rate_per_minute_cents: number | null }>()
  const displayRatePerMinute = rateRow?.client_display_rate_per_minute_cents ?? null
  const showCostKpi = typeof displayRatePerMinute === 'number' && displayRatePerMinute > 0
  const displayCostCents = showCostKpi
    ? Math.ceil((todayKpi?.dial_time_seconds ?? 0) / 60) * displayRatePerMinute
    : 0

  const dayStart = new Date()
  dayStart.setHours(0, 0, 0, 0)
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
  const { count: callbacksDueToday } = await supabase
    .from('ai_salesperson_followups')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', tenant.id)
    .in('status', ['pending', 'queued'])
    .gte('due_at', dayStart.toISOString())
    .lt('due_at', dayEnd.toISOString())

  async function callNow(formData: FormData) {
    'use server'
    const meetingId = String(formData.get('meeting_id') ?? '')
    if (!meetingId) return
    await dispatchConfirmCall(meetingId)
    revalidatePath('/dashboard/dialer')
  }

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">AI Dialer</p>
          <h1>AI Dialer Control Center</h1>
          <p className="sub" style={{ marginTop: 0 }}>
            Four specialized modes — each with its own script, rules, and analytics. AI SDR is now multi-setter, with dedicated detail pages and lead import conflict handling per setter.
          </p>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* Cap usage strip */}
      <div style={{ marginTop: '0.8rem' }}>
        <UsageStrip
          repId={tenant.id}
          candidates={['addon_dialer_pro', 'addon_dialer_lite']}
          label="Dialer cap"
          blurb="Confirmed appointments count toward your monthly cap."
        />
      </div>
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Mode swatches</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          {MODE_SWATCHES.map((s) => {
            const isEnabled = dialerSettings.enabled_modes.includes(s.mode)
            return (
              <Link key={s.mode} href={s.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                <div
                  style={{
                    background: 'var(--paper)',
                    color: 'var(--ink)',
                    borderRadius: 10,
                    padding: '14px 16px',
                    boxShadow: 'var(--shadow-card)',
                    border: `2px solid ${isEnabled ? s.color : '#e5e7eb'}`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        background: s.bg,
                        color: s.textColor,
                        borderRadius: 999,
                        padding: '4px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {s.emoji} {s.label}
                    </span>
                    <span
                      style={{
                        background: isEnabled ? s.bg : '#f3f4f6',
                        color: isEnabled ? s.textColor : '#6b7280',
                        borderRadius: 999,
                        padding: '3px 8px',
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {isEnabled ? 'Active' : 'Off'}
                    </span>
                  </div>
                  <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--muted)' }}>{s.tagline}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {s.features.map((f) => (
                      <span
                        key={f}
                        style={{
                          background: s.bg,
                          color: s.textColor,
                          borderRadius: 999,
                          padding: '3px 8px',
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      <DialerSettingsCard initial={dialerSettings} canEdit={canEditDialerSettings} />

      {/* KPI strip */}
      <div
        style={{
          marginTop: '0.8rem',
          display: 'grid',
          gridTemplateColumns: showCostKpi ? 'repeat(6, 1fr)' : 'repeat(5, 1fr)',
          gap: 12,
        }}
      >
        {(
          [
            ['Dials today', todayKpi?.dials ?? 0],
            ['Connects', todayKpi?.connects ?? 0],
            ['Conversations', todayKpi?.conversations ?? 0],
            ['Appts set', todayKpi?.appointments_set ?? 0],
            ['Callbacks due', callbacksDueToday ?? 0],
            ...(showCostKpi
              ? ([['Cost', `$${(displayCostCents / 100).toFixed(2)}`]] as Array<[string, string]>)
              : []),
          ] as Array<[string, string | number]>
        ).map(([label, value]) => (
          <div
            key={label}
            style={{
              background: 'var(--paper)',
              color: 'var(--ink)',
              borderRadius: 10,
              padding: '12px 14px',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.7 }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>
          Last 30 days · how the calls landed
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 12,
          }}
        >
          <BucketGroup
            title="Appointment outcomes"
            sub="What the meeting ended up as after the dialer ran."
            buckets={meetingBuckets}
          />
          <BucketGroup
            title="Dialer call outcomes"
            sub="Whether we actually reached the lead — health signal for the dialer."
            buckets={callBuckets}
          />
        </div>
      </section>

      {/* Upcoming meetings */}
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Upcoming meetings (7 days)</h2>
        <div
          style={{
            background: 'var(--paper)',
            color: 'var(--ink)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {meetings.length === 0 ? (
            <div style={{ padding: 16, opacity: 0.7 }}>
              No upcoming meetings. Connect Google Calendar in{' '}
              <Link href="/dashboard/integrations">Integrations</Link>.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead style={{ background: '#f7f4ef' }}>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Attendee</th>
                  <th style={th}>Phone</th>
                  <th style={th}>Status</th>
                  <th style={th}>Attempts</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => (
                  <tr key={m.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={td}>
                      {new Date(m.scheduled_at).toLocaleString(undefined, {
                        weekday: 'short',
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={td}>{m.attendee_name ?? '—'}</td>
                    <td style={td}>{m.phone ?? '—'}</td>
                    <td style={td}>
                      <span
                        style={{
                          background: STATUS_COLORS[m.status] ?? '#94a3b8',
                          color: '#fff',
                          padding: '2px 8px',
                          borderRadius: 999,
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {m.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={td}>{m.confirmation_attempts}</td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {m.phone && m.status === 'scheduled' && (
                        <form action={callNow}>
                          <input type="hidden" name="meeting_id" value={m.id} />
                          <button
                            type="submit"
                            style={{
                              background: 'var(--red)',
                              color: '#fff',
                              border: 0,
                              padding: '6px 10px',
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            Call now
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Recent calls */}
      <section style={{ marginTop: '0.8rem' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Recent calls</h2>
        <div
          style={{
            background: 'var(--paper)',
            color: 'var(--ink)',
            borderRadius: 10,
            overflow: 'hidden',
          }}
        >
          {!recentCalls?.length ? (
            <div style={{ padding: 16, opacity: 0.7 }}>No calls yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead style={{ background: '#f7f4ef' }}>
                <tr>
                  <th style={th}>When</th>
                  <th style={th}>Direction</th>
                  <th style={th}>Provider</th>
                  <th style={th}>To</th>
                  <th style={th}>Outcome</th>
                  <th style={th}>Duration</th>
                  <th style={th}>Recording</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.map((c: Record<string, unknown>) => (
                  <tr key={c.id as string} style={{ borderTop: '1px solid #eee' }}>
                    <td style={td}>
                      {new Date(c.created_at as string).toLocaleString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={td}>{(c.direction as string)?.replace(/_/g, ' ') ?? '—'}</td>
                    <td style={td}>{(c.provider as string) ?? '—'}</td>
                    <td style={td}>{(c.to_number as string) ?? '—'}</td>
                    <td style={td}>{(c.outcome as string) ?? '—'}</td>
                    <td style={td}>
                      {c.duration_sec ? `${Math.round((c.duration_sec as number) / 6) / 10}m` : '—'}
                    </td>
                    <td style={td}>
                      {c.recording_url ? (
                        <a href={c.recording_url as string} target="_blank" rel="noreferrer">
                          play
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
    </main>
  )
}

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  opacity: 0.7,
}
const td: React.CSSProperties = { padding: '10px 12px' }

function BucketGroup({
  title,
  sub,
  buckets,
}: {
  title: string
  sub: string
  buckets: { label: string; color: string; n: number }[]
}) {
  return (
    <div
      style={{
        background: 'var(--paper)',
        color: 'var(--ink)',
        borderRadius: 10,
        padding: '14px 16px',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 12, opacity: 0.7, marginTop: 2 }}>{sub}</div>
      <div
        style={{
          marginTop: 12,
          display: 'grid',
          gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
          gap: 8,
        }}
      >
        {buckets.map((b) => (
          <div
            key={b.label}
            style={{
              padding: '10px 8px',
              borderRadius: 8,
              border: `1px solid ${b.color}`,
              background: '#fff',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 700, color: b.color }}>{b.n}</div>
            <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
