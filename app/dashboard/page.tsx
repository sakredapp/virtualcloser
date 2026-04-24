import { revalidatePath } from 'next/cache'
import Link from 'next/link'
import {
  getLeadsByPriority,
  getPendingEmailDrafts,
  getTodayRunSummary,
  setAgentActionStatus,
} from '@/lib/supabase'
import { requireTenant } from '@/lib/tenant'

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

      <style jsx>{`
        .wrap {
          width: min(1200px, 94vw);
          margin: 0 auto;
          padding: 2.5rem 0 3rem;
        }

        .hero {
          border: 1px solid var(--panel-border);
          background: linear-gradient(130deg, rgba(216, 177, 90, 0.2), rgba(17, 17, 17, 0.95) 40%);
          border-radius: 18px;
          padding: 1.4rem 1.6rem;
          box-shadow: 0 0 40px rgba(216, 177, 90, 0.15);
          margin-bottom: 1.2rem;
        }

        .eyebrow {
          text-transform: uppercase;
          letter-spacing: 0.12em;
          color: var(--gold);
          margin: 0;
          font-size: 0.75rem;
          font-weight: 600;
        }

        h1 {
          margin: 0.15rem 0 0.2rem;
          font-size: clamp(1.7rem, 2.8vw, 2.6rem);
        }

        .sub {
          margin: 0;
          color: var(--muted);
        }

        .nav {
          margin: 0.6rem 0 0;
          display: flex;
          gap: 0.5rem;
          color: var(--muted);
          font-size: 0.9rem;
        }
        .nav :global(a) {
          color: var(--gold);
          text-decoration: none;
          border-bottom: 1px dashed rgba(216, 177, 90, 0.35);
        }

        .grid-4 {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 0.8rem;
          margin-bottom: 0.8rem;
        }

        .grid-2 {
          display: grid;
          grid-template-columns: 1.1fr 1fr;
          gap: 0.8rem;
        }

        .card {
          border: 1px solid var(--panel-border);
          background: linear-gradient(180deg, rgba(17, 17, 17, 0.98), rgba(10, 10, 10, 0.95));
          border-radius: 14px;
          padding: 1rem;
        }

        .label {
          margin: 0;
          color: var(--muted);
          font-size: 0.82rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }

        .value {
          margin: 0.35rem 0 0;
          font-size: 1.9rem;
          font-weight: 700;
          color: var(--gold);
        }

        .value.small {
          font-size: 1.05rem;
          text-transform: capitalize;
          color: var(--text);
        }

        .hint {
          margin: 0.2rem 0 0;
          font-size: 0.85rem;
          color: var(--muted);
        }

        .section-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 0.5rem;
          margin-bottom: 0.5rem;
        }

        h2 {
          margin: 0;
          font-size: 1.06rem;
        }

        .section-head p {
          margin: 0;
          font-size: 0.85rem;
          color: var(--muted);
        }

        .list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: 0.55rem;
          max-height: 540px;
          overflow: auto;
        }

        .row,
        .draft {
          border: 1px solid rgba(216, 177, 90, 0.16);
          background: rgba(216, 177, 90, 0.03);
          border-radius: 10px;
          padding: 0.7rem;
        }

        .row {
          display: flex;
          justify-content: space-between;
          gap: 0.8rem;
          align-items: center;
        }

        .name {
          margin: 0;
          font-weight: 600;
        }

        .meta {
          margin: 0.15rem 0 0;
          color: var(--muted);
          font-size: 0.84rem;
        }

        .right {
          text-align: right;
        }

        .status {
          border: 1px solid var(--panel-border);
          border-radius: 999px;
          padding: 0.2rem 0.55rem;
          font-size: 0.73rem;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          background: #1d1d1d;
        }

        .status.hot {
          border-color: #f18e62;
          color: #fcb293;
          background: rgba(241, 142, 98, 0.12);
        }

        .status.warm {
          border-color: #f4c15f;
          color: #ffd789;
          background: rgba(244, 193, 95, 0.12);
        }

        .status.cold {
          border-color: #9aa4ad;
          color: #c8d0d7;
          background: rgba(154, 164, 173, 0.09);
        }

        .status.dormant {
          border-color: #7d7a73;
          color: #bcb7aa;
          background: rgba(125, 122, 115, 0.14);
        }

        .subject {
          margin: 0.45rem 0 0;
          font-weight: 600;
          color: var(--gold);
        }

        .body {
          margin: 0.45rem 0 0;
          color: #e8e5dd;
          line-height: 1.42;
          white-space: pre-wrap;
        }

        .actions {
          display: flex;
          gap: 0.45rem;
          margin-top: 0.65rem;
        }

        .btn {
          border-radius: 8px;
          border: 1px solid transparent;
          padding: 0.42rem 0.72rem;
          background: #252525;
          color: var(--text);
          cursor: pointer;
          font-size: 0.84rem;
        }

        .btn.approve {
          background: var(--gold-soft);
          border-color: rgba(216, 177, 90, 0.48);
          color: var(--gold);
        }

        .btn.dismiss {
          border-color: #575757;
          color: #d1d1d1;
        }

        .empty {
          margin: 0.35rem 0 0;
          color: var(--muted);
        }

        @media (max-width: 980px) {
          .grid-4 {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .grid-2 {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </main>
  )
}
