import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  getLeadsByPriority,
  getPendingEmailDrafts,
  getTodayRunSummary,
  setAgentActionStatus,
  supabase,
} from '@/lib/supabase'
import { getCurrentTenant, isGatewayHost, requireTenant } from '@/lib/tenant'
import { telegramBotUsername } from '@/lib/telegram'

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
  // If someone hits /dashboard on the apex/www/preview host, there is no
  // tenant in context — send them to the marketing/login flow instead of
  // throwing a 500.
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) {
    redirect('/login')
  }

  const tenant = await getCurrentTenant()
  if (!tenant) {
    redirect('/login')
  }

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

  async function onRegenerateLinkCode() {
    'use server'
    const t = await requireTenant()
    const code = Math.random().toString(36).slice(2, 10).toUpperCase()
    await supabase
      .from('reps')
      .update({ telegram_link_code: code, telegram_chat_id: null })
      .eq('id', t.id)
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

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Connect Telegram</h2>
          <p>{tenant.telegram_chat_id ? 'connected' : 'not connected'}</p>
        </div>
        {tenant.telegram_chat_id ? (
          <>
            <p className="meta" style={{ marginBottom: '0.6rem' }}>
              ✅ You&apos;re linked. Message{' '}
              <a
                href={`https://t.me/${telegramBotUsername()}`}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--royal)' }}
              >
                @{telegramBotUsername()}
              </a>{' '}
              like you&apos;d tell an assistant and it updates your CRM. Examples:
            </p>
            <ul style={{ paddingLeft: '1.1rem', margin: '0 0 0.6rem', display: 'grid', gap: '0.3rem', fontSize: '0.88rem' }}>
              <li>&ldquo;New prospect Dana Kim at Acme, she&apos;s hot, follow up Thursday on pricing&rdquo;</li>
              <li>&ldquo;Just called Ben, he&apos;s warm, wants a demo next week&rdquo;</li>
              <li>&ldquo;Nina&apos;s gone dormant, dead deal&rdquo;</li>
              <li>&ldquo;Goal: close 10 deals this month&rdquo;</li>
            </ul>
            <p className="hint" style={{ marginBottom: '0.5rem' }}>
              You&apos;ll also get a morning briefing and a midday pulse with anything overdue or heating up.
            </p>
            <form action={onRegenerateLinkCode}>
              <button type="submit" className="btn dismiss">
                Disconnect &amp; regenerate code
              </button>
            </form>
          </>
        ) : (
          <>
            <p className="meta" style={{ marginBottom: '0.8rem' }}>
              Your personal assistant on Telegram. Connect it once and every message you send —
              tasks, goals, reminders, notes — drops into your CRM automatically.
            </p>
            <ol style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.45rem', margin: 0 }}>
              <li>
                Open Telegram and message{' '}
                <a
                  href={`https://t.me/${telegramBotUsername()}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontWeight: 600, color: 'var(--royal)' }}
                >
                  @{telegramBotUsername()}
                </a>
                . Tap <strong>Start</strong>.
              </li>
              <li>
                Send this exact message:{' '}
                <code
                  style={{
                    background: '#fffaea',
                    border: '1px solid var(--panel-border)',
                    padding: '0.1rem 0.45rem',
                    borderRadius: 6,
                  }}
                >
                  /link {tenant.telegram_link_code ?? '—'}
                </code>
              </li>
              <li>Wait for the confirmation reply. That&apos;s it.</li>
            </ol>
            <p className="hint" style={{ marginTop: '0.7rem' }}>
              Your code is personal — don&apos;t share it.
            </p>
            <form action={onRegenerateLinkCode} style={{ marginTop: '0.3rem' }}>
              <button
                type="submit"
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  color: 'var(--royal)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: '0.82rem',
                }}
              >
                Regenerate code
              </button>
            </form>
          </>
        )}
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
