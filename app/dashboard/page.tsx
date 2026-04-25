import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import {
  getBrainBuckets,
  getLeadsByPriority,
  getPendingEmailDrafts,
  setAgentActionStatus,
  setBrainItemStatus,
  supabase,
} from '@/lib/supabase'
import type { BrainItem, BrainItemStatus } from '@/types'
import { getCurrentTenant, isGatewayHost, requireTenant } from '@/lib/tenant'
import { telegramBotUsername } from '@/lib/telegram'
import { hashPassword, verifyPassword } from '@/lib/client-password'
import { sendEmail, passwordChangedEmail } from '@/lib/email'
import { getTokensForRep, googleOauthConfigured } from '@/lib/google'
import DashboardAutoRefresh from './AutoRefresh'

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

type HorizonKey = 'week' | 'month' | 'quarter' | 'year'
function findGoal(items: BrainItem[], horizon: HorizonKey): BrainItem | null {
  for (const it of items) if (it.horizon === horizon) return it
  return null
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ pw_error?: string; pw_ok?: string }>
}) {
  const sp = (await searchParams) ?? {}
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

    // If approving, try to actually send the email via Resend.
    if (status === 'sent') {
      const { data: row } = await supabase
        .from('agent_actions')
        .select('id, content, lead_id')
        .eq('id', actionId)
        .eq('rep_id', t.id)
        .maybeSingle()

      if (row) {
        let subject = 'Follow-up'
        let body = typeof row.content === 'string' ? row.content : ''
        try {
          const parsed = JSON.parse(row.content ?? '{}')
          if (parsed && typeof parsed.subject === 'string') subject = parsed.subject
          if (parsed && typeof parsed.body === 'string') body = parsed.body
        } catch {}

        let toEmail: string | null = null
        if (row.lead_id) {
          const { data: lead } = await supabase
            .from('leads')
            .select('email')
            .eq('id', row.lead_id)
            .eq('rep_id', t.id)
            .maybeSingle()
          toEmail = lead?.email ?? null
        }

        if (toEmail) {
          const html = body
            .split('\n')
            .map((l) => `<p style="margin:0 0 12px;line-height:1.55;">${l.replace(/</g, '&lt;')}</p>`)
            .join('')
          const replyTo = t.email ?? undefined
          await sendEmail({ to: toEmail, subject, html, text: body, replyTo })
        }
      }
    }

    await setAgentActionStatus(actionId, status, t.id)
    revalidatePath('/dashboard')
  }

  async function onRegenerateLinkCode() {
    'use server'
    const t = await requireTenant()
    const { generateLinkCode } = await import('@/lib/random')
    const code = generateLinkCode()
    await supabase
      .from('reps')
      .update({ telegram_link_code: code, telegram_chat_id: null })
      .eq('id', t.id)
    revalidatePath('/dashboard')
  }

  async function onBrainItemAction(formData: FormData) {
    'use server'
    const itemId = String(formData.get('itemId') ?? '')
    const status = String(formData.get('status') ?? '') as BrainItemStatus
    if (!itemId || !['done', 'dismissed', 'open'].includes(status)) return
    const t = await requireTenant()
    await setBrainItemStatus(itemId, status, t.id)
    revalidatePath('/dashboard')
  }

  async function onChangePassword(formData: FormData) {
    'use server'
    const t = await requireTenant()
    const currentPassword = String(formData.get('current_password') ?? '')
    const newPassword = String(formData.get('new_password') ?? '')
    const confirmPassword = String(formData.get('confirm_password') ?? '')

    if (!currentPassword || !newPassword || newPassword.length < 8) {
      redirect('/dashboard?pw_error=invalid')
    }
    if (newPassword !== confirmPassword) {
      redirect('/dashboard?pw_error=mismatch')
    }

    // Re-fetch the tenant row to get the password_hash (not on the cached tenant).
    const { data: row, error } = await supabase
      .from('reps')
      .select('password_hash, email, display_name')
      .eq('id', t.id)
      .single()
    if (error || !row) redirect('/dashboard?pw_error=invalid')

    const ok = await verifyPassword(currentPassword, row.password_hash)
    if (!ok) redirect('/dashboard?pw_error=wrong')

    const newHash = await hashPassword(newPassword)
    await supabase.from('reps').update({ password_hash: newHash }).eq('id', t.id)

    // Best-effort confirmation email.
    if (row.email) {
      const tpl = passwordChangedEmail({
        toEmail: row.email,
        displayName: row.display_name ?? row.email,
      })
      await sendEmail({ to: row.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
    }
    redirect('/dashboard?pw_ok=1')
  }

  const [leads, pendingDrafts, brain, googleTokens] = await Promise.all([
    getLeadsByPriority(tenant.id),
    getPendingEmailDrafts(tenant.id),
    getBrainBuckets(tenant.id),
    getTokensForRep(tenant.id),
  ])
  const gcalConnected = Boolean(googleTokens)
  const gcalConfigured = googleOauthConfigured()
  const telegramConnected = Boolean(tenant.telegram_chat_id)

  // Hard gate: until Telegram is linked, the rest of the dashboard is locked.
  // The bot is the entire system — no point showing leads / goals / drafts
  // until the rep can talk to it.
  if (!telegramConnected) {
    return (
      <main className="wrap">
        <header className="hero">
          <div>
            <p className="eyebrow">Virtual Closer · {tenant.slug}</p>
            <h1>One step left</h1>
            <p className="sub">
              Hi {tenant.display_name} — connect Telegram to unlock your dashboard.
              Your bot <em>is</em> the system: brain dumps, follow-ups, daily briefings,
              calendar events. Nothing works without it.
            </p>
          </div>
        </header>

        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Connect Telegram to unlock</h2>
            <p>required</p>
          </div>
          <p className="meta" style={{ marginBottom: '0.8rem' }}>
            Open Telegram, message the bot, send your personal link code. Takes 30 seconds.
            This page will refresh automatically once it&apos;s linked.
          </p>
          <ol style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.5rem', margin: 0 }}>
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
                  background: 'var(--panel-2, #fffaea)',
                  border: '1px solid var(--panel-border)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: 6,
                  fontWeight: 600,
                }}
              >
                /link {tenant.telegram_link_code ?? '—'}
              </code>
            </li>
            <li>
              Wait for the &ldquo;✅ linked&rdquo; reply, then refresh this page.
            </li>
          </ol>
          <p className="hint" style={{ marginTop: '0.9rem' }}>
            Your code is personal — don&apos;t share it. Need a fresh code?
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
                fontSize: '0.85rem',
              }}
            >
              Regenerate code
            </button>
          </form>
        </section>

        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>What unlocks once you link</h2>
          </div>
          <ul style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem', margin: 0, fontSize: '0.92rem' }}>
            <li>Voice + text brain dumps → tasks, goals, reminders auto-organized</li>
            <li>Morning briefing every weekday at 8am with overdue + priorities</li>
            <li>Hot-lead pings the moment a prospect heats up</li>
            <li>&ldquo;Follow up Dana Thursday&rdquo; → automatic Google Calendar event</li>
            <li>Email drafts for review, sent on approval from the dashboard</li>
          </ul>
        </section>
      </main>
    )
  }

  return (
    <main className="wrap">
      <DashboardAutoRefresh />
      <header className="hero">
        <div>
          <h1>Command Center</h1>
          <p className="sub">
            Daily pulse for {tenant.display_name}: your goals, prioritized leads, and draft queue.
          </p>
          <p className="nav">
            <Link href="/dashboard">Dashboard</Link>
            <span>·</span>
            <Link href="/brain">Brain dump</Link>
            <span>·</span>
            <Link href="/dashboard/integrations">Integrations</Link>
          </p>
        </div>
      </header>

      <section className="summary grid-4">
        {([
          { key: 'week' as const,    label: 'This week',    cta: '“goal this week: …”' },
          { key: 'month' as const,   label: 'This month',   cta: '“goal this month: …”' },
          { key: 'quarter' as const, label: 'This quarter', cta: '“goal this quarter: …”' },
          { key: 'year' as const,    label: 'This year',    cta: '“goal this year: …”' },
        ]).map(({ key, label, cta }) => {
          const g = findGoal(brain.goals, key)
          return (
            <article key={key} className="card stat">
              <p className="label">{label}</p>
              {g ? (
                <>
                  <p className="value small" style={{ color: 'var(--text)', textTransform: 'none' }}>
                    {g.content}
                  </p>
                  <p className="hint">set {timeAgo(g.created_at)}</p>
                </>
              ) : (
                <>
                  <p className="value small" style={{ color: 'var(--muted)', textTransform: 'none', fontStyle: 'italic' }}>
                    No goal yet
                  </p>
                  <p className="hint">Tell Telegram: {cta}</p>
                </>
              )}
            </article>
          )
        })}
      </section>

      {tenant.telegram_chat_id ? (
        <details
          style={{
            marginTop: '0.8rem',
            background: 'var(--panel)',
            border: '1px solid var(--panel-border)',
            borderRadius: 10,
            padding: '0.55rem 0.9rem',
          }}
        >
          <summary
            style={{
              cursor: 'pointer',
              listStyle: 'none',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '0.6rem',
              fontSize: '0.9rem',
            }}
          >
            <a
              href={`https://t.me/${telegramBotUsername()}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--royal)', fontWeight: 600 }}
            >
              @{telegramBotUsername()}
            </a>
            <span style={{ color: 'var(--muted)', fontSize: '0.78rem', marginLeft: 'auto' }}>
              show details
            </span>
          </summary>
          <div style={{ marginTop: '0.6rem', display: 'grid', gap: '0.55rem' }}>
            <p className="meta" style={{ margin: 0 }}>
              Message the bot like you&apos;d tell an assistant and it updates your CRM. Examples:
            </p>
            <ul
              style={{
                paddingLeft: '1.1rem',
                margin: 0,
                display: 'grid',
                gap: '0.25rem',
                fontSize: '0.88rem',
                color: 'var(--text)',
              }}
            >
              <li>&ldquo;New prospect Dana Kim at Acme, she&apos;s hot, follow up Thursday on pricing&rdquo;</li>
              <li>&ldquo;Just called Ben, he&apos;s warm, wants a demo next week&rdquo;</li>
              <li>&ldquo;Nina&apos;s gone dormant, dead deal&rdquo;</li>
              <li>&ldquo;Goal this month: close 10 deals&rdquo;</li>
            </ul>
            <p className="hint" style={{ margin: 0 }}>
              You&apos;ll also get a morning briefing and a midday pulse with anything overdue or heating up.
            </p>
            <form action={onRegenerateLinkCode} style={{ margin: 0 }}>
              <button type="submit" className="btn dismiss">
                Disconnect &amp; regenerate code
              </button>
            </form>
          </div>
        </details>
      ) : (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Connect Telegram</h2>
            <p>not connected</p>
          </div>
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
        </section>
      )}

      {/* ── Google Calendar connect ──────────────────────────────────── */}
      {gcalConfigured && (
        <section
          className="card"
          style={{ marginTop: '0.8rem' }}
        >
          <div className="section-head">
            <h2>Google Calendar</h2>
            <p>{gcalConnected ? 'connected' : 'not connected'}</p>
          </div>
          {gcalConnected ? (
            <>
              <p className="meta" style={{ marginBottom: '0.6rem' }}>
                ✅ Connected{googleTokens?.email ? ` as ${googleTokens.email}` : ''}. Telegram bookings drop on your calendar, and a linked Google Sheet (set up in <a href="/dashboard/integrations">Integrations</a>) gets new/updated rows in real time.
              </p>
              <form action="/api/google/disconnect" method="post">
                <button type="submit" className="btn dismiss">
                  Disconnect Google
                </button>
              </form>
            </>
          ) : (
            <>
              <p className="meta" style={{ marginBottom: '0.6rem' }}>
                Connect Google so &ldquo;call Dana Thursday&rdquo; on Telegram books a 30-minute calendar event <em>and</em> mirrors prospects into your Google Sheet CRM (optional — set up under <a href="/dashboard/integrations">Integrations</a>).
              </p>
              <a className="btn approve" href="/api/google/oauth/start" style={{ textDecoration: 'none' }}>
                Connect Google →
              </a>
            </>
          )}
        </section>
      )}

      {/* ── Brain-as-nucleus: goals + horizons ───────────────────────── */}
      {brain.goals.length > 0 && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Goals</h2>
            <p>{brain.goals.length} active</p>
          </div>
          <ul className="list">
            {brain.goals.map((g) => (
              <BrainRow key={g.id} item={g} action={onBrainItemAction} />
            ))}
          </ul>
        </section>
      )}

      {brain.overdue.length > 0 && (
        <section className="card" style={{ marginTop: '0.8rem', borderColor: 'rgba(220,38,38,0.4)' }}>
          <div className="section-head">
            <h2 style={{ color: '#991b1b' }}>Overdue</h2>
            <p>{brain.overdue.length}</p>
          </div>
          <ul className="list">
            {brain.overdue.map((it) => (
              <BrainRow key={it.id} item={it} action={onBrainItemAction} />
            ))}
          </ul>
        </section>
      )}

      <section className="grid-2" style={{ marginTop: '0.8rem' }}>
        <article className="card">
          <div className="section-head">
            <h2>Today</h2>
            <p>{brain.today.length}</p>
          </div>
          {brain.today.length === 0 ? (
            <p className="empty">Nothing landed for today yet. Tell Telegram what to log.</p>
          ) : (
            <ul className="list">
              {brain.today.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>This week</h2>
            <p>{brain.thisWeek.length}</p>
          </div>
          {brain.thisWeek.length === 0 ? (
            <p className="empty">No tasks scheduled for this week.</p>
          ) : (
            <ul className="list">
              {brain.thisWeek.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>
      </section>

      <section className="grid-2" style={{ marginTop: '0.8rem' }}>
        <article className="card">
          <div className="section-head">
            <h2>This month</h2>
            <p>{brain.thisMonth.length}</p>
          </div>
          {brain.thisMonth.length === 0 ? (
            <p className="empty">Empty. Tell Jarvis what&apos;s on the radar this month.</p>
          ) : (
            <ul className="list">
              {brain.thisMonth.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Long range</h2>
            <p>{brain.longRange.length}</p>
          </div>
          {brain.longRange.length === 0 ? (
            <p className="empty">Quarterly + yearly plays show up here.</p>
          ) : (
            <ul className="list">
              {brain.longRange.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          )}
        </article>
      </section>

      {brain.inbox.length > 0 && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <details>
            <summary style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
              <strong>Brain inbox</strong>
              <span className="meta">{brain.inbox.length} unsorted</span>
            </summary>
            <ul className="list" style={{ marginTop: '0.5rem' }}>
              {brain.inbox.map((it) => (
                <BrainRow key={it.id} item={it} action={onBrainItemAction} />
              ))}
            </ul>
          </details>
        </section>
      )}

      <section className="grid-2" style={{ marginTop: '0.8rem' }}>
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
              {pendingDrafts.map(({ action, lead, draft }) => {
                const gmailHref = lead?.email
                  ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(lead.email)}&su=${encodeURIComponent(draft.subject || '')}&body=${encodeURIComponent(draft.body || '')}`
                  : null
                return (
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
                      {gmailHref && (
                        <a
                          href={gmailHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn dismiss"
                          style={{ textDecoration: 'none' }}
                        >
                          Open in Gmail
                        </a>
                      )}
                      <form action={onDraftAction}>
                        <input type="hidden" name="actionId" value={action.id} />
                        <input type="hidden" name="status" value="dismissed" />
                        <button type="submit" className="btn dismiss">Dismiss</button>
                      </form>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </article>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--royal)' }}>
            Account & password
          </summary>
          <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.7rem', maxWidth: 420 }}>
            {sp.pw_ok === '1' && (
              <p className="meta" style={{ color: 'var(--royal)' }}>
                Password updated. We sent a confirmation to your email.
              </p>
            )}
            {sp.pw_error === 'wrong' && (
              <p className="meta" style={{ color: '#fcb293' }}>
                Current password didn&apos;t match. Try again.
              </p>
            )}
            {sp.pw_error === 'mismatch' && (
              <p className="meta" style={{ color: '#fcb293' }}>
                New password and confirmation didn&apos;t match.
              </p>
            )}
            {sp.pw_error === 'invalid' && (
              <p className="meta" style={{ color: '#fcb293' }}>
                Password must be at least 8 characters.
              </p>
            )}
            <form action={onChangePassword} style={{ display: 'grid', gap: '0.55rem' }}>
              <label className="meta" style={{ display: 'grid', gap: '0.25rem' }}>
                <span>Current password</span>
                <input
                  name="current_password"
                  type="password"
                  required
                  autoComplete="current-password"
                  style={accountInputStyle}
                />
              </label>
              <label className="meta" style={{ display: 'grid', gap: '0.25rem' }}>
                <span>New password (min 8 chars)</span>
                <input
                  name="new_password"
                  type="password"
                  minLength={8}
                  required
                  autoComplete="new-password"
                  style={accountInputStyle}
                />
              </label>
              <label className="meta" style={{ display: 'grid', gap: '0.25rem' }}>
                <span>Confirm new password</span>
                <input
                  name="confirm_password"
                  type="password"
                  minLength={8}
                  required
                  autoComplete="new-password"
                  style={accountInputStyle}
                />
              </label>
              <button type="submit" className="btn approve" style={{ marginTop: '0.2rem' }}>
                Change password
              </button>
            </form>
          </div>
        </details>
      </section>
    </main>
  )
}

const accountInputStyle: React.CSSProperties = {
  padding: '0.55rem',
  borderRadius: 10,
  border: '1px solid var(--ink-soft)',
  background: '#ffffff',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
}

// ── Brain item row (rendered inline in server component, so no 'use client') ─

function BrainRow({
  item,
  action,
}: {
  item: BrainItem
  action: (formData: FormData) => Promise<void>
}) {
  const typeBadge: Record<string, { bg: string; fg: string; label: string }> = {
    task: { bg: 'var(--royal-soft)', fg: 'var(--royal)', label: 'task' },
    goal: { bg: 'rgba(16,185,129,0.15)', fg: '#065f46', label: 'goal' },
    idea: { bg: '#fff7d9', fg: '#7a5500', label: 'idea' },
    plan: { bg: '#ede7ff', fg: '#4a2ea0', label: 'plan' },
    note: { bg: '#f3f4f6', fg: '#374151', label: 'note' },
  }
  const t = typeBadge[item.item_type] ?? typeBadge.note
  const isHigh = item.priority === 'high'
  const due = item.due_date
    ? new Date(item.due_date + 'T00:00:00').toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : null

  return (
    <li className="row" style={{ alignItems: 'flex-start' }}>
      <div style={{ flex: 1 }}>
        <p className="name" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '0.7rem',
              padding: '0.1rem 0.45rem',
              borderRadius: 6,
              background: t.bg,
              color: t.fg,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t.label}
          </span>
          {isHigh && (
            <span
              style={{
                fontSize: '0.7rem',
                padding: '0.1rem 0.45rem',
                borderRadius: 6,
                background: 'rgba(220,38,38,0.12)',
                color: '#991b1b',
                fontWeight: 600,
              }}
            >
              HIGH
            </span>
          )}
          <span style={{ fontWeight: 500 }}>{item.content}</span>
        </p>
        <p className="meta">
          {due ? `Due ${due}` : null}
        </p>
      </div>
      <div className="right" style={{ display: 'flex', gap: '0.3rem' }}>
        <form action={action}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="status" value="done" />
          <button type="submit" className="btn approve" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}>
            Done
          </button>
        </form>
        <form action={action}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="status" value="dismissed" />
          <button type="submit" className="btn dismiss" style={{ padding: '0.3rem 0.65rem', fontSize: '0.78rem' }}>
            Dismiss
          </button>
        </form>
      </div>
    </li>
  )
}
