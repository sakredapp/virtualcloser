import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireMember } from '@/lib/tenant'
import { buildDashboardTabs } from '@/app/dashboard/dashboardTabs'
import DashboardNav from '@/app/dashboard/DashboardNav'
import { supabase } from '@/lib/supabase'
import DialerWorkflowsPanel from '../DialerWorkflowsPanel'
import DialerQueuePanel from '../DialerQueuePanel'
import ModePillNav from '../ModePillNav'

export const dynamic = 'force-dynamic'

function count<T extends Record<string, unknown>>(rows: T[], field: string, val: string) {
  return rows.filter((r) => String(r[field] ?? '') === val).length
}

export default async function WorkflowsPage() {
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
  const canEdit = tenant.tier === 'individual' || ['owner', 'admin', 'manager', 'rep'].includes(memberRole)

  const since30 = new Date(Date.now() - 30 * 86400_000).toISOString()
  const { data: callRows } = await supabase
    .from('voice_calls')
    .select('outcome, status, created_at, duration_sec, summary')
    .eq('rep_id', tenant.id)
    .eq('dialer_mode', 'pipeline')
    .gte('created_at', since30)
    .order('created_at', { ascending: false })
    .limit(200)

  const rows = callRows ?? []
  const stats = [
    { label: 'Workflow dials', value: rows.length, color: '#8b5cf6' },
    { label: 'Picked up', value: rows.filter((r) => ['connected','confirmed','reschedule_requested'].includes(String(r.outcome ?? ''))).length, color: '#22c55e' },
    { label: 'Voicemail', value: count(rows as Record<string, unknown>[], 'outcome', 'voicemail'), color: '#f59e0b' },
    { label: 'No answer', value: count(rows as Record<string, unknown>[], 'outcome', 'no_answer'), color: '#a78bfa' },
    { label: 'Confirmed', value: count(rows as Record<string, unknown>[], 'outcome', 'confirmed'), color: '#22c55e' },
    { label: 'Failed', value: count(rows as Record<string, unknown>[], 'status', 'failed'), color: '#ef4444' },
  ]

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
            background: '#f3e8ff', color: '#6b21a8', borderRadius: 8,
            padding: '6px 12px', fontSize: 13, fontWeight: 700,
          }}>
            ⚙️ Workflows
          </span>
          <div>
            <h1 style={{ margin: 0 }}>Workflows</h1>
            <p className="sub" style={{ margin: '2px 0 0' }}>
              Trigger-based outbound calls for pipeline events — payment overdue, no-show follow-up, stage-change re-engagement. You set the rules, the AI works the queue.
            </p>
          </div>
        </div>
      </header>
      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
      <ModePillNav active="workflows" />

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

      {/* Workflow rules */}
      <details open style={{ margin: '0.8rem 24px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Workflow rules</summary>
        <div style={{ marginTop: 8 }}>
          <DialerWorkflowsPanel canEdit={canEdit} isEnterprise={tenant.tier === 'enterprise'} />
        </div>
      </details>

      {/* Queue (pipeline mode only) */}
      <details style={{ margin: '0.8rem 24px 0' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700, marginBottom: 8 }}>Pipeline queue</summary>
        <div style={{ marginTop: 8 }}>
          <DialerQueuePanel canEdit={canEdit} modeFilter="pipeline" />
        </div>
      </details>

      {/* Recent calls */}
      <section style={{ margin: '0.8rem 24px 0' }}>
        <h2 style={{ fontSize: '1.05rem', margin: '0 0 10px' }}>Recent workflow calls (30 days)</h2>
        <div style={{
          background: 'var(--paper)', borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 1px 0 rgba(0,0,0,.05)',
        }}>
          {rows.length === 0 ? (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--muted)' }}>
              No workflow calls yet. Create a workflow rule below and opt in to pipeline dialing.
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
                        background: '#f3e8ff', color: '#6b21a8',
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
