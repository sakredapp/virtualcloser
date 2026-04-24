import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  getLeadsByPriority,
  getPendingEmailDrafts,
  getTodayRunSummary,
  setAgentActionStatus,
} from '@/lib/supabase'
import { getCurrentTenant, isGatewayHost, requireTenant } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const statusTone: Record<string, string> = {
  hot: 'status hot',
  warm: 'status warm',
  cold: 'status cold',
  dormant: 'status dormant',
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'n/a'
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default async function DashboardPage() {
  const tenant = await requireTenant()

  async function onDraftAction(formData: FormData) {
    'use server'

    const actionId = String(formData.get('actionId') ?? '')
    const status = String(formData.get('status') ?? '') as 'sent' | 'dismissed'

    if (!actionId || (status !== 'sent' && status !== 'dismissed')) {
      return
    }

    const t = await requireTenant()
    await setAgentActionStatus(actionId, status, t.id)
    revalidatePath('/dashboard')
  }

  const [summary, leads, pendingDrafts] = await Promise.all([
    getTodayRunSummary(tenant.id),
    getLeadsByPriority(tenant.id),
    getPendingEmailDrafts(tenant.id),
  ])

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Virtual Closer · {tenant.slug}</p>
          <h1>Command Center</h1>
          <p className="sub">
            Daily pulse for {tenant.display_name}: run performance, prioritized leads, and draft
            queue.
          </p>
          <p className="nav">
            <Link href="/dashboard">Dashboard</Link>
            <span>·</span>
            <Link href="/brain">Brain dump</Link>
          </p>
        </div>
      </header>

      <section className="summary grid-4">
        <article className="card stat">
          <p className="label">Runs Today</p>
          <p className="value">{summary.runsToday}</p>
        </article>
        <article className="card stat">
          <p className="label">Leads Processed</p>
          <p className="value">{summary.leadsProcessed}</p>
        </article>
        <article className="card stat">
          <p className="label">Drafts Created</p>
          <p className="value">{summary.actionsCreated}</p>
        </article>
        <article className="card stat">
          <p className="label">Latest Run</p>
          <p className="value small">{summary.latestRunType ? summary.latestRunType.replace('_', ' ') : 'none yet'}</p>
          <p className="hint">{timeAgo(summary.latestRunAt)}</p>
        </article>
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>Lead Priority Queue</h2>
            <p>{leads.length} total</p>
          </div>

          {leads.length === 0 ? (
            <p className="empty">No leads yet.</p>
          ) : (
            <ul className="list">
              {leads.map((lead) => (
                <li key={lead.id} className="row">
                  <div>
                    <p className="name">{lead.name}</p>
                    <p className="meta">
                      {lead.company || 'No company'}
                      {lead.email ? ` · ${lead.email}` : ''}
                    </p>
                  </div>
                  <div className="right">
                    <span className={statusTone[lead.status] || 'status'}>{lead.status}</span>
                    <p className="meta">Contact: {timeAgo(lead.last_contact)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Pending Email Drafts</h2>
            <p>{pendingDrafts.length} waiting</p>
          </div>

          {pendingDrafts.length === 0 ? (
            <p className="empty">No pending drafts to review.</p>
          ) : (
            <ul className="list drafts">
              {pendingDrafts.map(({ action, lead, draft }) => (
                <li key={action.id} className="draft">
                  <p className="name">{lead?.name || 'Unknown lead'} - {lead?.company || 'No company'}</p>
                  <p className="subject">{draft.subject}</p>
                  <p className="body">{draft.body}</p>

                  <div className="actions">
                    <form action={onDraftAction}>
                      <input type="hidden" name="actionId" value={action.id} />
                      <input type="hidden" name="status" value="sent" />
                      <button type="submit" className="btn approve">Approve</button>
                    </form>
                    <form action={onDraftAction}>
                      <input type="hidden" name="actionId" value={action.id} />
                      <input type="hidden" name="status" value="dismissed" />
                      <button type="submit" className="btn dismiss">Dismiss</button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </section>
    </main>
  )
}
