import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireTenant, getCurrentMember } from '@/lib/tenant'
import { buildDashboardTabs } from '../dashboardTabs'
import DashboardNav from '../DashboardNav'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type PlaudNote = {
  id: string
  title: string
  transcript: string | null
  summary: string | null
  action_items: string[]
  occurred_at: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function PlaudPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  let tenant
  try {
    tenant = await requireTenant()
  } catch {
    redirect('/login')
  }

  const member = await getCurrentMember()
  const navTabs = await buildDashboardTabs(tenant.id, member)

  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const hasPlaud = typeof integrations.plaud_webhook_secret === 'string'

  if (!hasPlaud) {
    return (
      <main className="wrap">
        <header className="hero">
          <div>
            <h1>Plaud</h1>
            <p className="sub">Connect Plaud to see your call notes here.</p>
          </div>
        </header>
        <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
        <section style={{ marginTop: '2rem', maxWidth: 480 }}>
          <p className="meta" style={{ marginBottom: '1rem' }}>
            You haven&apos;t connected Plaud yet. Go to Integrations to generate your
            webhook URL and follow the Zapier setup guide.
          </p>
          <Link href="/dashboard/integrations" className="btn approve">
            Go to Integrations →
          </Link>
        </section>
      </main>
    )
  }

  const { data: rows } = await supabase
    .from('plaud_notes')
    .select('id, title, transcript, summary, action_items, occurred_at')
    .eq('rep_id', tenant.id)
    .order('occurred_at', { ascending: false })
    .limit(50)

  const notes: PlaudNote[] = (rows ?? []).map((r) => ({
    id: r.id,
    title: r.title ?? 'Plaud note',
    transcript: r.transcript ?? null,
    summary: r.summary ?? null,
    action_items: Array.isArray(r.action_items) ? (r.action_items as string[]) : [],
    occurred_at: r.occurred_at,
  }))

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <h1>Plaud</h1>
          <p className="sub">
            {notes.length === 0
              ? 'No calls yet — process a recording in Plaud and it will appear here automatically.'
              : `${notes.length} recording${notes.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      <style>{`
        .plaud-list { display: grid; gap: 0.65rem; margin-top: 1.25rem; }
        .plaud-card {
          background: var(--paper);
          border: 1px solid rgba(15,15,15,0.12);
          border-radius: 10px;
          overflow: hidden;
        }
        .plaud-card-summary {
          padding: 0.8rem 1rem;
          display: grid;
          gap: 0.12rem;
          cursor: pointer;
          list-style: none;
        }
        .plaud-card-summary::-webkit-details-marker { display: none; }
        .plaud-card-summary:hover { background: rgba(15,15,15,0.025); }
        .plaud-card-title {
          font-weight: 700;
          font-size: 0.95rem;
          color: var(--ink);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .plaud-card-title::after {
          content: '›';
          font-size: 1.1rem;
          color: var(--muted);
          margin-left: auto;
          transition: transform 0.15s;
        }
        details[open] .plaud-card-title::after { transform: rotate(90deg); }
        .plaud-card-date {
          font-size: 0.78rem;
          color: var(--muted);
          margin: 0;
        }
        .plaud-badge {
          font-size: 0.7rem;
          font-weight: 600;
          padding: 0.1rem 0.4rem;
          border-radius: 8px;
          background: rgba(15,15,15,0.07);
          color: var(--muted);
          white-space: nowrap;
        }
        .plaud-body {
          border-top: 1px solid rgba(15,15,15,0.08);
          padding: 0.85rem 1rem;
          display: grid;
          gap: 0.85rem;
        }
        .plaud-section-label {
          font-size: 0.7rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          color: var(--muted);
          margin: 0 0 0.3rem;
        }
        .plaud-summary-text {
          font-size: 0.88rem;
          line-height: 1.6;
          color: var(--ink);
          margin: 0;
        }
        .plaud-task {
          display: flex;
          gap: 0.5rem;
          align-items: flex-start;
          font-size: 0.86rem;
          color: var(--ink);
          padding: 0.18rem 0;
        }
        .plaud-task-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--royal);
          flex-shrink: 0;
          margin-top: 0.44em;
        }
        .plaud-transcript-toggle {
          font-size: 0.78rem;
          font-weight: 600;
          color: var(--royal);
          cursor: pointer;
          list-style: none;
          padding: 0;
        }
        .plaud-transcript-toggle::-webkit-details-marker { display: none; }
        .plaud-transcript-text {
          font-size: 0.81rem;
          color: var(--muted);
          line-height: 1.65;
          white-space: pre-wrap;
          margin: 0.4rem 0 0;
          max-height: 280px;
          overflow-y: auto;
          padding: 0.6rem 0.75rem;
          background: rgba(15,15,15,0.03);
          border-radius: 6px;
          border: 1px solid rgba(15,15,15,0.07);
        }
      `}</style>

      {notes.length === 0 && (
        <div style={{ marginTop: '2rem' }}>
          <p className="meta" style={{ marginBottom: '0.75rem' }}>
            Process your first recording in the Plaud app — it will show up here with the
            full transcript, summary, and extracted action items.
          </p>
          <Link href="/dashboard/integrations" style={{ color: 'var(--royal)', fontWeight: 600, fontSize: '0.88rem' }}>
            Check Plaud setup →
          </Link>
        </div>
      )}

      {notes.length > 0 && (
        <div className="plaud-list">
          {notes.map((note, i) => (
            <details key={note.id} className="plaud-card" open={i === 0}>
              <summary className="plaud-card-summary">
                <p className="plaud-card-title">
                  {note.title}
                  {note.action_items.length > 0 && (
                    <span className="plaud-badge">
                      {note.action_items.length} task{note.action_items.length === 1 ? '' : 's'}
                    </span>
                  )}
                </p>
                <p className="plaud-card-date">{formatDate(note.occurred_at)}</p>
              </summary>

              <div className="plaud-body">
                {note.summary && (
                  <div>
                    <p className="plaud-section-label">Summary</p>
                    <p className="plaud-summary-text">{note.summary}</p>
                  </div>
                )}

                {note.action_items.length > 0 && (
                  <div>
                    <p className="plaud-section-label">Action items</p>
                    {note.action_items.map((item, j) => (
                      <div key={j} className="plaud-task">
                        <span className="plaud-task-dot" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}

                {note.transcript && (
                  <details>
                    <summary className="plaud-transcript-toggle">View full transcript</summary>
                    <pre className="plaud-transcript-text">{note.transcript}</pre>
                  </details>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
    </main>
  )
}
