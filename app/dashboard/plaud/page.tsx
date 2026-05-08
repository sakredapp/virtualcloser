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
            <p className="eyebrow">Recordings</p>
            <h1>Plaud</h1>
            <p className="sub">Connect Plaud to see your call notes here.</p>
          </div>
        </header>
        <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />
        <section className="card" style={{ marginTop: '0.8rem', maxWidth: 480 }}>
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
          <p className="eyebrow">Recordings</p>
          <h1>Plaud</h1>
          <p className="sub">
            {notes.length === 0
              ? 'No recordings yet — process a note in Plaud and it will appear here.'
              : `${notes.length} recording${notes.length === 1 ? '' : 's'} · tasks auto-created from each call`}
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {notes.length === 0 && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <p className="empty">
            Process your first recording in the Plaud app — it will show up here
            with the full transcript, summary, and extracted action items.
          </p>
          <div style={{ marginTop: '0.8rem' }}>
            <Link href="/dashboard/integrations" className="btn">
              Check Plaud setup →
            </Link>
          </div>
        </section>
      )}

      {notes.length > 0 && (
        <div style={{ display: 'grid', gap: '0.55rem', marginTop: '0.8rem' }}>
          {notes.map((note, i) => (
            <details key={note.id} className="card" open={i === 0}
              style={{ padding: 0, overflow: 'hidden' }}>
              <summary style={{
                padding: '0.85rem 1.1rem',
                cursor: 'pointer',
                listStyle: 'none',
                display: 'grid',
                gap: '0.1rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <p className="name" style={{ margin: 0 }}>{note.title}</p>
                  {note.action_items.length > 0 && (
                    <span className="status" style={{ flexShrink: 0 }}>
                      {note.action_items.length} task{note.action_items.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="meta" style={{ fontSize: '0.8rem' }}>
                  {formatDate(note.occurred_at)}
                </p>
              </summary>

              <div style={{
                borderTop: '1px solid var(--border-soft)',
                padding: '0.85rem 1.1rem',
                display: 'grid',
                gap: '0.85rem',
              }}>
                {note.summary && (
                  <div>
                    <p className="meta" style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginBottom: '0.3rem',
                    }}>
                      Summary
                    </p>
                    <p className="meta">{note.summary}</p>
                  </div>
                )}

                {note.action_items.length > 0 && (
                  <div>
                    <p className="meta" style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginBottom: '0.3rem',
                    }}>
                      Action items
                    </p>
                    {note.action_items.map((item, j) => (
                      <div key={j} style={{
                        display: 'flex',
                        gap: '0.5rem',
                        alignItems: 'flex-start',
                        padding: '0.2rem 0',
                      }}>
                        <span style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: 'var(--red)',
                          flexShrink: 0,
                          marginTop: '0.44em',
                        }} />
                        <p className="meta" style={{ margin: 0 }}>{item}</p>
                      </div>
                    ))}
                  </div>
                )}

                {note.transcript && (
                  <details>
                    <summary className="hint" style={{
                      cursor: 'pointer',
                      fontWeight: 600,
                      listStyle: 'none',
                    }}>
                      View full transcript
                    </summary>
                    <pre style={{
                      fontSize: '0.81rem',
                      color: 'var(--muted)',
                      lineHeight: 1.65,
                      whiteSpace: 'pre-wrap',
                      margin: '0.4rem 0 0',
                      maxHeight: 280,
                      overflowY: 'auto',
                      padding: '0.6rem 0.75rem',
                      background: 'var(--paper-2)',
                      borderRadius: 8,
                      border: '1px solid var(--border-soft)',
                    }}>
                      {note.transcript}
                    </pre>
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
