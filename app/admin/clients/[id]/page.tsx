import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { isAdminAuthed } from '@/lib/admin-auth'
import {
  addClientEvent,
  getClient,
  getClientSummary,
  listClientEvents,
  setOnboardingStep,
  updateClientRow,
} from '@/lib/admin-db'
import { TIER_INFO, type OnboardingStep } from '@/lib/onboarding'

export const dynamic = 'force-dynamic'

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const { id } = await params
  const client = await getClient(id)
  if (!client) notFound()

  const [summary, events] = await Promise.all([
    getClientSummary(client.id),
    listClientEvents(client.id, 20),
  ])

  const steps = (client.onboarding_steps ?? []) as OnboardingStep[]
  const doneCount = steps.filter((s) => s.done).length
  const pct = Math.round((doneCount / Math.max(steps.length, 1)) * 100)
  const info = TIER_INFO[client.tier] ?? TIER_INFO.starter

  async function toggleStep(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const key = String(formData.get('key') ?? '')
    const done = formData.get('done') === '1'
    await setOnboardingStep(id, key, done)
    await addClientEvent({
      repId: id,
      kind: 'onboarding_step',
      title: `${done ? '✓ Completed' : '↺ Reopened'}: ${key}`,
    })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function addNote(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const body = String(formData.get('body') ?? '').trim()
    if (!body) return
    await addClientEvent({ repId: id, kind: 'note', title: 'Note', body })
    revalidatePath(`/admin/clients/${id}`)
  }

  async function saveIntegrations(formData: FormData) {
    'use server'
    if (!(await isAdminAuthed())) redirect('/admin/login')
    const patch: Partial<typeof client> = {
      slack_webhook: String(formData.get('slack_webhook') ?? '') || null,
      hubspot_token: String(formData.get('hubspot_token') ?? '') || null,
      claude_api_key: String(formData.get('claude_api_key') ?? '') || null,
      build_notes: String(formData.get('build_notes') ?? '') || null,
    }
    await updateClientRow(id, patch)
    await addClientEvent({ repId: id, kind: 'integration', title: 'Integrations updated' })
    revalidatePath(`/admin/clients/${id}`)
  }

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Admin · Client</p>
        <h1>{client.display_name}</h1>
        <p className="sub">
          {client.slug}.virtualcloser.com · {info.label} · ${client.monthly_fee}/mo · build ${client.build_fee}
        </p>
        <p className="nav">
          <Link href="/admin/clients">← All clients</Link>
          <span>·</span>
          <Link href={`/dashboard`}>Open their dashboard</Link>
          <span>·</span>
          <Link href="/offer">Offer page</Link>
        </p>
      </header>

      <section className="grid-4">
        <article className="card stat">
          <p className="label">Leads</p>
          <p className="value">{summary.leads}</p>
        </article>
        <article className="card stat">
          <p className="label">Pending drafts</p>
          <p className="value">{summary.drafts}</p>
        </article>
        <article className="card stat">
          <p className="label">Agent runs</p>
          <p className="value">{summary.runs}</p>
        </article>
        <article className="card stat">
          <p className="label">Onboarding</p>
          <p className="value">{pct}%</p>
          <p className="hint">{doneCount} / {steps.length} steps</p>
        </article>
      </section>

      <section className="grid-2">
        <article className="card">
          <div className="section-head">
            <h2>Onboarding steps</h2>
            <p>{info.label} template</p>
          </div>
          {steps.length === 0 ? (
            <p className="empty">No steps.</p>
          ) : (
            <ul className="list">
              {steps.map((s) => (
                <li key={s.key} className="row" style={{ alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <p className="name" style={{ textDecoration: s.done ? 'line-through' : 'none', opacity: s.done ? 0.6 : 1 }}>
                      {s.title}
                    </p>
                    <p className="meta">{s.description}</p>
                    <p className="meta" style={{ color: s.owner === 'client' ? '#fcb293' : 'var(--gold)' }}>
                      owner: {s.owner}
                    </p>
                  </div>
                  <form action={toggleStep}>
                    <input type="hidden" name="key" value={s.key} />
                    <input type="hidden" name="done" value={s.done ? '0' : '1'} />
                    <button type="submit" className={`btn ${s.done ? 'dismiss' : 'approve'}`}>
                      {s.done ? 'Undo' : 'Mark done'}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="card">
          <div className="section-head">
            <h2>Integrations & build notes</h2>
          </div>
          <form action={saveIntegrations} style={{ display: 'grid', gap: '0.6rem' }}>
            <label style={lblStyle}>
              <span>Slack webhook URL</span>
              <input
                name="slack_webhook"
                defaultValue={client.slack_webhook ?? ''}
                style={inputStyle}
                placeholder="https://hooks.slack.com/..."
              />
            </label>
            <label style={lblStyle}>
              <span>HubSpot private app token</span>
              <input
                name="hubspot_token"
                defaultValue={client.hubspot_token ?? ''}
                style={inputStyle}
                placeholder="pat-na1-..."
              />
            </label>
            <label style={lblStyle}>
              <span>Claude API key (optional override / BYOK)</span>
              <input
                name="claude_api_key"
                defaultValue={client.claude_api_key ?? ''}
                style={inputStyle}
                placeholder="sk-ant-..."
              />
            </label>
            <label style={lblStyle}>
              <span>Build notes (private)</span>
              <textarea
                name="build_notes"
                defaultValue={client.build_notes ?? ''}
                rows={4}
                style={{ ...inputStyle, fontFamily: 'inherit' }}
                placeholder="ICP, objection playbook, gotchas, passwords stored in 1Password, etc."
              />
            </label>
            <button type="submit" className="btn approve">Save</button>
          </form>

          <div className="section-head" style={{ marginTop: '1rem' }}>
            <h2>Activity</h2>
            <p>{events.length}</p>
          </div>
          <form action={addNote} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <input name="body" placeholder="Add a note…" style={{ ...inputStyle, flex: 1 }} />
            <button type="submit" className="btn approve">Log</button>
          </form>
          {events.length === 0 ? (
            <p className="empty">No activity yet.</p>
          ) : (
            <ul className="list">
              {events.map((e) => (
                <li key={(e as { id: string }).id} className="row">
                  <div>
                    <p className="name">{(e as { title: string }).title}</p>
                    {(e as { body?: string | null }).body && (
                      <p className="meta">{(e as { body?: string | null }).body}</p>
                    )}
                    <p className="meta">
                      {(e as { kind: string }).kind} ·{' '}
                      {new Date((e as { created_at: string }).created_at).toLocaleString()}
                    </p>
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

const lblStyle: React.CSSProperties = {
  display: 'grid',
  gap: '0.3rem',
  fontSize: '0.78rem',
  color: '#aea78f',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}

const inputStyle: React.CSSProperties = {
  padding: '0.55rem',
  borderRadius: 10,
  border: '1px solid #2f2a1f',
  background: '#0b0b0b',
  color: '#f7f7f5',
  fontFamily: 'inherit',
  fontSize: '0.9rem',
  textTransform: 'none',
  letterSpacing: 'normal',
}
