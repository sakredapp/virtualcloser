import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import DashboardNav from '@/app/dashboard/DashboardNav'
import { supabase } from '@/lib/supabase'
import { getDialerSettings } from '@/lib/voice/dialerSettings'
import DialerSettingsCard from '../DialerSettingsCard'
import TransferAvailabilityPanel from '../TransferAvailabilityPanel'
import ModePillNav from '../ModePillNav'
import DialerModeKpiStrip from '../DialerModeKpiStrip'
import { resolveMemberDataScope } from '@/lib/permissions'

export const dynamic = 'force-dynamic'

export default async function LiveTransferPage() {
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
  const dialerSettings = await getDialerSettings(tenant.id)

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data: callRows } = await supabase
    .from('voice_calls')
    .select('outcome, status, created_at, duration_sec, summary')
    .eq('rep_id', tenant.id)
    .eq('dialer_mode', 'live_transfer')
    .gte('created_at', since30)
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = callRows ?? []
  const stats = [
    { label: 'Transfer attempts', value: rows.length, color: '#6366f1' },
    { label: 'Transferred', value: rows.filter((r) => r.outcome === 'transferred').length, color: '#22c55e' },
    { label: 'Fallback booked', value: rows.filter((r) => r.outcome === 'confirmed').length, color: '#60a5fa' },
    { label: 'No answer', value: rows.filter((r) => r.outcome === 'no_answer').length, color: '#a78bfa' },
    { label: 'Voicemail', value: rows.filter((r) => r.outcome === 'voicemail').length, color: '#f59e0b' },
    { label: 'Failed', value: rows.filter((r) => r.status === 'failed').length, color: '#ef4444' },
  ]

  // Team members with phone (transfer targets)
  const { data: members } = await supabase
    .from('members')
    .select('id, name, role, phone')
    .eq('rep_id', tenant.id)
    .not('phone', 'is', null)
    .eq('is_active', true)

  return (
    <main className="wrap">
      <header className="hero" style={{ paddingBottom: '0.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Link href="/dashboard/dialer" style={{ color: 'var(--red)', fontSize: 13, textDecoration: 'none' }}>
            ← AI Dialer
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            background: '#fff7ed', color: '#c2410c', borderRadius: 8,
            padding: '6px 12px', fontSize: 13, fontWeight: 700,
          }}>
            ⚡ Live Transfer
          </span>
          <div>
            <h1 style={{ margin: 0 }}>Live Transfer</h1>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Qualifies leads on the phone then transfers the live call to a human rep in real-time. Falls back to booking an appointment if no rep is available.
            </p>
          </div>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <ModePillNav active="live_transfer" />

      {viewerMember && (
        <DialerModeKpiStrip
          repId={tenant.id}
          scope={await resolveMemberDataScope(viewerMember)}
          mode="live_transfer"
          modeLabel="Live Transfer"
        />
      )}

      {/* Stats */}
      <section style={{ margin: '0.8rem 24px 0', display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
        {stats.map((s) => (
          <div key={s.label} style={{
            background: 'var(--paper)', color: 'var(--ink)', borderRadius: 10,
            padding: '14px 16px', boxShadow: '0 1px 0 rgba(0,0,0,.05)',
          }}>
            <div style={{ fontSize: 11, opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 11, opacity: 0.5 }}>30 days</div>
          </div>
        ))}
      </section>

      {/* Transfer targets */}
      <details open style={{ margin: '0.8rem 24px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Transfer targets and roles</summary>
        <div style={{
          background: 'var(--paper)', borderRadius: 12, padding: '18px 20px',
          boxShadow: '0 1px 0 rgba(0,0,0,.05)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Transfer targets</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>
                Team members with a phone number set. The AI round-robins within the available window.
              </p>
            </div>
            <Link href="/dashboard/team" style={{ fontSize: 13, color: 'var(--red)', textDecoration: 'none' }}>
              Manage team →
            </Link>
          </div>
          {(members ?? []).length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted)' }}>
              No team members with a phone number yet.{' '}
              <Link href="/dashboard/team" style={{ color: 'var(--red)' }}>Add phone numbers in Team settings.</Link>
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#f7f4ef' }}>
                <tr>
                  {['Name', 'Role', 'Phone', 'Status'].map((hd) => (
                    <th key={hd} style={{ padding: '7px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }}>{hd}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(members ?? []).map((m) => (
                  <tr key={m.id} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{m.name ?? '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, opacity: 0.7 }}>{m.role}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{m.phone}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        background: '#dcfce7', color: '#166534', padding: '2px 8px',
                        borderRadius: 999, fontSize: 11, fontWeight: 700,
                      }}>
                        Transfer target
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>

      {/* Fallback setting */}
      <details style={{ margin: '0.8rem 24px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Fallback behavior</summary>
        <div style={{
          background: 'var(--paper)', borderRadius: 12, padding: '18px 20px',
          boxShadow: '0 1px 0 rgba(0,0,0,.05)',
        }}>
          <h2 style={{ margin: '0 0 4px', fontSize: '1.05rem' }}>No-agent fallback</h2>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>
            Current: <strong>{dialerSettings.live_transfer_fallback.replace(/_/g, ' ')}</strong>.
            Change this in the full dialer settings.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['book_appointment', 'collect_callback', 'end_call'] as const).map((opt) => (
              <span key={opt} style={{
                padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                background: dialerSettings.live_transfer_fallback === opt ? 'var(--red)' : '#f3f4f6',
                color: dialerSettings.live_transfer_fallback === opt ? '#fff' : 'var(--ink)',
              }}>
                {opt.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Edit in <Link href="/dashboard/dialer" style={{ color: 'var(--red)' }}>AI Dialer → Settings</Link>.
          </p>
        </div>
      </details>

      {/* Availability windows */}
      <details style={{ margin: '0.8rem 24px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Availability windows</summary>
        <div style={{ marginTop: 8 }}>
          <TransferAvailabilityPanel canEdit={canEdit} />
        </div>
      </details>

      {/* Recent calls */}
      <section style={{ margin: '0.8rem 24px 0' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Recent live transfer calls (30 days)</h2>
        <div style={{
          background: 'var(--paper)', borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 1px 0 rgba(0,0,0,.05)',
        }}>
          {rows.length === 0 ? (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--muted)' }}>
              No live transfer calls yet. Enable <strong>Live Transfer</strong> mode in{' '}
              <Link href="/dashboard/dialer" style={{ color: 'var(--red)' }}>AI Dialer settings</Link>.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ background: '#f7f4ef' }}>
                <tr>
                  {['When', 'Outcome', 'Duration', 'Summary'].map((hd) => (
                    <th key={hd} style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12 }}>{hd}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 20).map((c, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #eee' }}>
                    <td style={{ padding: '8px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                      {new Date(c.created_at as string).toLocaleString(undefined, {
                        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
                      })}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{
                        background: c.outcome === 'transferred' ? '#dcfce7' : '#f3f4f6',
                        color: c.outcome === 'transferred' ? '#166534' : '#4b5563',
                        padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700,
                      }}>
                        {(c.outcome as string | null)?.replace(/_/g, ' ') ?? '—'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>
                      {c.duration_sec ? `${Math.floor((c.duration_sec as number) / 60)}m ${(c.duration_sec as number) % 60}s` : '—'}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 12, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {(c.summary as string | null) ?? <span style={{ opacity: 0.4 }}>—</span>}
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
