// Receptionist mode page — AI Dialer Control Center > Receptionist
// This mode handles appointment confirmations, reschedules, and show-rate protection.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import DashboardNav from '@/app/dashboard/DashboardNav'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import VoicePromptEditor from '@/app/dashboard/VoicePromptEditor'
import TrainingDocsManager from '@/app/dashboard/TrainingDocsManager'
import ModePillNav from '../ModePillNav'

export const dynamic = 'force-dynamic'

function count<T extends Record<string, unknown>>(
  rows: T[] | null | undefined,
  field: string,
  values: string[],
): number {
  if (!rows) return 0
  return rows.filter((r) => values.includes(String(r[field] ?? ''))).length
}

export default async function ReceptionistPage() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  if (host.startsWith('www.') || host === 'virtualcloser.com') redirect('/login')

  let tenant
  let memberRole = 'rep'
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
  const canEdit = tenant.tier === 'individual' || ['owner', 'admin', 'manager'].includes(memberRole)

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()

  const [{ data: callRows }, { data: meetingRows }] = await Promise.all([
    supabase
      .from('voice_calls')
      .select('status, outcome, duration_sec, summary, hangup_cause, created_at, transcript')
      .eq('rep_id', tenant.id)
      .eq('dialer_mode', 'concierge')
      .gte('created_at', since30)
      .order('created_at', { ascending: false })
      .limit(100),
    supabase
      .from('meetings')
      .select('status, scheduled_at')
      .eq('rep_id', tenant.id)
      .gte('scheduled_at', since30),
  ])

  const stats = [
    { label: 'Confirmed', value: count(meetingRows, 'status', ['confirmed']), color: '#22c55e' },
    { label: 'Rescheduled', value: count(meetingRows, 'status', ['rescheduled']), color: '#60a5fa' },
    { label: 'No answer', value: count(callRows, 'outcome', ['no_answer']), color: '#a78bfa' },
    { label: 'Voicemail', value: count(callRows, 'outcome', ['voicemail']), color: '#f59e0b' },
    { label: 'Cancelled', value: count(meetingRows, 'status', ['cancelled']), color: '#ef4444' },
    { label: 'Total dials', value: (callRows ?? []).length, color: '#94a3b8' },
  ]

  const vapiCfg = (await getIntegrationConfig(tenant.id, 'vapi')) ?? {}
  const promptInitial = {
    product_summary: (vapiCfg.product_summary as string) ?? '',
    objections: (vapiCfg.objections as string) ?? '',
    confirm_addendum: (vapiCfg.confirm_addendum as string) ?? '',
    reschedule_addendum: (vapiCfg.reschedule_addendum as string) ?? '',
    roleplay_addendum: '',
    ai_name: (vapiCfg.ai_name as string) ?? '',
  }

  const recentCalls = (callRows ?? []).slice(0, 15)

  return (
    <main className="wrap">
      <header className="hero" style={{ paddingBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Link
            href="/dashboard/dialer"
            style={{ color: 'var(--red)', fontSize: 13, textDecoration: 'none' }}
          >
            ← AI Dialer
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            background: '#dcfce7', color: '#166534', borderRadius: 8,
            padding: '6px 12px', fontSize: 13, fontWeight: 700,
          }}>
            🤝 Receptionist
          </span>
          <div>
            <h1 style={{ margin: 0 }}>Receptionist</h1>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Confirms appointments, reschedules on request, and protects your show-rate — 30–60 min before every meeting.
            </p>
          </div>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <ModePillNav active="receptionist" />

      {/* 30-day stats */}
      <section style={{ margin: '0.8rem 24px 0', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            background: 'var(--paper)', color: 'var(--ink)', borderRadius: 10,
            padding: '14px 16px', boxShadow: '0 1px 0 rgba(0,0,0,.05)',
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, opacity: 0.5 }}>30 days</div>
          </div>
        ))}
      </section>

      {/* Script & prompts */}
      <details open style={{ margin: '0.8rem 24px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Prompt settings</summary>
        <div style={{ marginTop: 8 }}>
          <VoicePromptEditor kind="dialer" initial={promptInitial} />
        </div>
      </details>

      {/* Reference docs */}
      <details open style={{ margin: '0.8rem 24px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Scripts and docs (PDF, briefs, objection lists)</summary>
        <div style={{ marginTop: 8 }}>
          <TrainingDocsManager
            heading="Scripts & objection docs the receptionist reads on every call"
            allowedKinds={['script', 'objection_list', 'product_brief', 'reference']}
            kindFilter={['script', 'objection_list', 'product_brief', 'reference']}
            defaultKind="script"
          />
        </div>
      </details>

      {/* Recent calls */}
      <section style={{ margin: '0.8rem 24px 0' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Recent receptionist calls (30 days)</h2>
        <div style={{
          background: 'var(--paper)', color: 'var(--ink)',
          borderRadius: 10, overflow: 'hidden',
        }}>
          {recentCalls.length === 0 ? (
            <div style={{ padding: 20, opacity: 0.6 }}>
              No receptionist calls yet. Enable the <strong>Receptionist</strong> mode in{' '}
              <Link href="/dashboard/dialer">AI Dialer settings</Link>.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#f7f4ef' }}>
                <tr>
                  {['When', 'Outcome', 'Duration', 'Summary', 'Hangup reason'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recentCalls.map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(c.created_at as string).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <OutcomePill outcome={c.outcome as string | null} />
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>
                      {c.duration_sec ? `${Math.round((c.duration_sec as number) / 60)}m ${(c.duration_sec as number) % 60}s` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(c.summary as string | null) ?? <span style={{ opacity: 0.4 }}>—</span>}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12, opacity: 0.6 }}>
                      {(c.hangup_cause as string | null) ?? '—'}
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

function OutcomePill({ outcome }: { outcome: string | null }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    confirmed:          { label: 'Confirmed',    color: '#166534', bg: '#dcfce7' },
    rescheduled:        { label: 'Rescheduled',  color: '#1d4ed8', bg: '#dbeafe' },
    reschedule_requested:{ label: 'Reschedule',  color: '#92400e', bg: '#fef3c7' },
    voicemail:          { label: 'Voicemail',    color: '#92400e', bg: '#fff7ed' },
    no_answer:          { label: 'No answer',    color: '#6b21a8', bg: '#f3e8ff' },
    cancelled:          { label: 'Cancelled',    color: '#991b1b', bg: '#fee2e2' },
    connected:          { label: 'Connected',    color: '#166534', bg: '#dcfce7' },
    failed:             { label: 'Failed',       color: '#991b1b', bg: '#fee2e2' },
  }
  const m = map[outcome ?? ''] ?? { label: outcome ?? '—', color: '#4b5563', bg: '#f3f4f6' }
  return (
    <span style={{
      background: m.bg, color: m.color, padding: '2px 8px',
      borderRadius: 999, fontSize: 11, fontWeight: 700,
    }}>
      {m.label}
    </span>
  )
}
