import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import PageHeader from '@/app/components/PageHeader'
import ConnectState from '@/app/components/cxo/ConnectState'
import { isGatewayHost, requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Recordings — the feed of meeting transcripts and notes Mira learns from.
 * Reads the existing meeting-note store (Plaud / Fathom webhooks land in
 * plaud_notes). When nothing is connected the page is the connect state.
 */
type NoteRow = {
  id: string
  title: string | null
  transcript: string | null
  summary: string | null
  action_items: unknown
  occurred_at: string
  duration_seconds: number | null
}

function fmtWhen(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  } catch {
    return iso.slice(0, 10)
  }
}
function fmtDur(s: number | null): string | null {
  if (!s || s <= 0) return null
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`
}
function items(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x && 'text' in x ? String((x as { text: unknown }).text) : '')).filter(Boolean)
  return []
}

export default async function RecordingsPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')
  const { tenant, member } = await requireMember()
  const tz = member.timezone ?? tenant.timezone ?? 'America/New_York'

  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const connected = typeof integrations.plaud_webhook_secret === 'string' || typeof integrations.fathom_api_key === 'string'

  const { data } = connected
    ? await supabase
        .from('plaud_notes')
        .select('id, title, transcript, summary, action_items, occurred_at, duration_seconds')
        .eq('rep_id', tenant.id)
        .order('occurred_at', { ascending: false })
        .limit(60)
    : { data: [] as NoteRow[] }
  const notes = (data ?? []) as NoteRow[]

  return (
    <main className="wrap">
      <PageHeader eyebrow="Recordings" title="Meetings" subtitle={connected && notes.length > 0 ? 'Every transcript and note Mira has learned from, newest first.' : undefined} />

      {!connected || notes.length === 0 ? (
        <ConnectState
          kind="recordings"
          sentence="Put Wispr Flow on every executive's computer and Mira learns from every meeting."
          button="Connect"
          href="/dashboard/integrations#recordings"
        />
      ) : (
        <div className="cx-grid">
          {notes.map((n) => {
            const dur = fmtDur(n.duration_seconds)
            const todo = items(n.action_items)
            const body = n.summary || (n.transcript ? n.transcript.slice(0, 600) : '')
            return (
              <article key={n.id} className="cx-panel">
                <div className="cx-eyebrow">
                  {fmtWhen(n.occurred_at, tz)}
                  {dur ? ` · ${dur}` : ''}
                </div>
                <h2 className="cx-title" style={{ fontSize: 20, margin: '4px 0 8px' }}>{n.title || 'Untitled meeting'}</h2>
                {body && <p className="cx-takeaway" style={{ whiteSpace: 'pre-wrap' }}>{body}</p>}
                {todo.length > 0 && (
                  <details className="cx-details">
                    <summary>{todo.length} action item{todo.length === 1 ? '' : 's'}</summary>
                    <ul className="cx-details-body" style={{ paddingLeft: 18 }}>
                      {todo.map((t, i) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </details>
                )}
                {n.transcript && n.summary && (
                  <details className="cx-details">
                    <summary>Transcript</summary>
                    <div className="cx-details-body" style={{ whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>{n.transcript}</div>
                  </details>
                )}
              </article>
            )
          })}
        </div>
      )}
    </main>
  )
}
