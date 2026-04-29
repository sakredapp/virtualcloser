// Dialer dashboard. Shows upcoming meetings with confirmation status,
// recent voice calls (with transcripts/recordings), and today's KPI roll-up.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { listUpcomingMeetingsForRep } from '@/lib/meetings'
import { getKpisForRep } from '@/lib/wavv'
import { supabase } from '@/lib/supabase'
import { dispatchConfirmCall } from '@/lib/voice/dialer'
import { revalidatePath } from 'next/cache'
import UsageStrip from '../UsageStrip'
import VoicePromptEditor from '../VoicePromptEditor'
import TrainingDocsManager from '../TrainingDocsManager'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { getDialerSettings } from '@/lib/voice/dialerSettings'
import DialerSettingsCard from './DialerSettingsCard'

export const dynamic = 'force-dynamic'

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
  try {
    const ctx = await requireMember()
    tenant = ctx.tenant
    memberRole = (ctx.member.role as string) ?? 'rep'
  } catch {
    redirect('/login')
  }

  const fromIso = new Date().toISOString()
  const toIso = new Date(Date.now() + 7 * 86400_000).toISOString()
  const meetings = await listUpcomingMeetingsForRep(tenant.id, { fromIso, toIso, limit: 50 })

  const dialerSettings = await getDialerSettings(tenant.id)
  const canEditDialerSettings = ['owner', 'admin'].includes(memberRole)

  // Pull current Vapi prompt addendums so the rep can edit their dialer script
  // inline. Admin still owns the api_key — we only show / save the prompt
  // fields.
  const vapiCfg = (await getIntegrationConfig(tenant.id, 'vapi')) ?? {}
  const promptInitial = {
    product_summary: (vapiCfg.product_summary as string) ?? '',
    objections: (vapiCfg.objections as string) ?? '',
    confirm_addendum: (vapiCfg.confirm_addendum as string) ?? '',
    reschedule_addendum: (vapiCfg.reschedule_addendum as string) ?? '',
    roleplay_addendum: (vapiCfg.roleplay_addendum as string) ?? '',
    ai_name: (vapiCfg.ai_name as string) ?? '',
  }

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

  async function callNow(formData: FormData) {
    'use server'
    const meetingId = String(formData.get('meeting_id') ?? '')
    if (!meetingId) return
    await dispatchConfirmCall(meetingId)
    revalidatePath('/dashboard/dialer')
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--red)', color: 'var(--text-inv)' }}>
      <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 700 }}>AI Dialer</h1>
        <Link href="/dashboard" style={{ color: 'var(--text-inv)', opacity: 0.8 }}>
          ← Dashboard
        </Link>
      </div>

      {/* Cap usage strip */}
      <div style={{ margin: '0 24px 14px' }}>
        <UsageStrip
          repId={tenant.id}
          candidates={['addon_dialer_pro', 'addon_dialer_lite']}
          label="Dialer cap"
          blurb="Confirmed appointments count toward your monthly cap."
        />
      </div>

      <VoicePromptEditor kind="dialer" initial={promptInitial} />

      <DialerSettingsCard initial={dialerSettings} canEdit={canEditDialerSettings} />

      <TrainingDocsManager
        heading="Reference docs the dialer reads on every call"
        allowedKinds={['product_brief', 'script', 'objection_list', 'reference']}
        kindFilter={['product_brief', 'script', 'objection_list', 'reference']}
        defaultKind="script"
      />

      {/* KPI strip */}
      <div
        style={{
          margin: '0 24px 20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
        }}
      >
        {(
          [
            ['Dials today', todayKpi?.dials ?? 0],
            ['Connects', todayKpi?.connects ?? 0],
            ['Conversations', todayKpi?.conversations ?? 0],
            ['Appts set', todayKpi?.appointments_set ?? 0],
            [
              'Cost',
              `$${(((todayKpi?.cost_cents ?? 0) as number) / 100).toFixed(2)}`,
            ],
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

      {/* Status buckets — last 30 days */}
      <section style={{ margin: '0 24px 24px' }}>
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
      <section style={{ margin: '0 24px 28px' }}>
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
      <section style={{ margin: '0 24px 40px' }}>
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
    </div>
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
        boxShadow: '0 1px 0 rgba(0,0,0,.05)',
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
