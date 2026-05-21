import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isGatewayHost, requireTenant, getCurrentMember } from '@/lib/tenant'
import { buildDashboardTabs } from '../dashboardTabs'
import DashboardNav from '../DashboardNav'
import { supabase } from '@/lib/supabase'
import PlaudActionRow, { type PlaudActionRowProps } from './PlaudActionRow'
import PlaudToProjectButton from './PlaudToProjectButton'

export const dynamic = 'force-dynamic'

type ActionRow = {
  id: string
  note_id: string
  kind: PlaudActionRowProps['kind']
  status: PlaudActionRowProps['status']
  payload: Record<string, unknown>
  target_member_id: string | null
  target_email: string | null
  result: Record<string, unknown> | null
  error: string | null
  auto_executed: boolean | null
  reasoning: string | null
  created_at: string
}

type ResolvedAction = PlaudActionRowProps & { note_id: string; created_at: string }

type PlaudNote = {
  id: string
  title: string
  transcript: string | null
  summary: string | null
  action_items: string[]
  occurred_at: string
  triage_class: string | null
  triage_reasoning: string | null
  duration_seconds: number | null
  actions: ResolvedAction[]
}

type MemberLite = { id: string; display_name: string; email: string | null }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const CLASS_LABEL: Record<string, string> = {
  trash: 'trash',
  action: 'action',
  training: 'training',
  executive: 'executive',
  unclear: 'unclear',
}

const CLASS_COLOR: Record<string, string> = {
  trash: 'var(--muted)',
  action: 'var(--red-deep, #dc2626)',
  training: '#0a66c2',
  executive: '#7c3aed',
  unclear: 'var(--muted)',
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

  // Parallel: notes + actions + members + contacts + recent resources.
  // Joining actions to notes client-side keeps the queries cheap and
  // avoids RPC.
  const [{ data: noteRows }, { data: actionRows }, { data: memberRows }, { data: contactRows }, { data: recentResources }] = await Promise.all([
    supabase
      .from('plaud_notes')
      .select('id, title, transcript, summary, action_items, occurred_at, triage_class, triage_reasoning, duration_seconds')
      .eq('rep_id', tenant.id)
      .order('occurred_at', { ascending: false })
      .limit(50),
    supabase
      .from('plaud_actions')
      .select('id, note_id, kind, status, payload, target_member_id, target_email, result, error, auto_executed, reasoning, created_at')
      .eq('rep_id', tenant.id)
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('members')
      .select('id, display_name, email')
      .eq('rep_id', tenant.id)
      .limit(100),
    supabase
      .from('rep_contacts')
      .select('display_name, email')
      .eq('rep_id', tenant.id)
      .not('email', 'is', null)
      .order('display_name', { ascending: true })
      .limit(500),
    // Only kinds that produce a clickable artifact land in the strip —
    // create_task / update_sheet / notify_member produce results but
    // aren't openable links, so filter them out at the query level.
    supabase
      .from('plaud_actions')
      .select('id, note_id, kind, payload, result, created_at')
      .eq('rep_id', tenant.id)
      .eq('status', 'executed')
      .in('kind', ['create_doc', 'create_calendar_event'])
      .not('result', 'is', null)
      .order('created_at', { ascending: false })
      .limit(8),
  ])

  const members = (memberRows ?? []) as MemberLite[]
  const memberById = new Map(members.map((m) => [m.id, m]))

  // Directory for the action edit form's recipient autocomplete. Merge
  // members + contacts; dedupe by email.
  type ContactLite = { display_name: string; email: string | null }
  const contacts = (contactRows ?? []) as ContactLite[]
  const directoryByEmail = new Map<string, string>()
  for (const c of contacts) {
    if (c.email) directoryByEmail.set(c.email.toLowerCase(), c.display_name)
  }
  for (const m of members) {
    if (m.email) directoryByEmail.set(m.email.toLowerCase(), m.display_name)
  }
  const directoryOptions = Array.from(directoryByEmail.entries()).map(([email, name]) => ({ email, name }))

  const actionsByNote = new Map<string, ResolvedAction[]>()
  for (const row of (actionRows ?? []) as ActionRow[]) {
    const targetMember = row.target_member_id ? memberById.get(row.target_member_id) : null
    const display = targetMember?.display_name ?? null
    const payload = row.payload ?? {}
    const recipientUnresolvedRaw = (payload as { recipient_unresolved?: unknown }).recipient_unresolved
    const recipientUnresolved =
      typeof recipientUnresolvedRaw === 'string' && recipientUnresolvedRaw.trim()
        ? recipientUnresolvedRaw.trim()
        : null
    const resolved: ResolvedAction = {
      id: row.id,
      note_id: row.note_id,
      kind: row.kind,
      status: row.status,
      payload,
      target_email: row.target_email,
      target_display_name: display,
      recipient_unresolved: recipientUnresolved,
      result: row.result,
      error: row.error,
      auto_executed: Boolean(row.auto_executed),
      reasoning: row.reasoning,
      created_at: row.created_at,
    }
    const list = actionsByNote.get(row.note_id) ?? []
    list.push(resolved)
    actionsByNote.set(row.note_id, list)
  }

  const notes: PlaudNote[] = ((noteRows ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    title: String(r.title ?? 'Plaud note'),
    transcript: (r.transcript as string | null) ?? null,
    summary: (r.summary as string | null) ?? null,
    action_items: Array.isArray(r.action_items) ? (r.action_items as string[]) : [],
    occurred_at: String(r.occurred_at),
    triage_class: (r.triage_class as string | null) ?? null,
    triage_reasoning: (r.triage_reasoning as string | null) ?? null,
    duration_seconds: (r.duration_seconds as number | null) ?? null,
    actions: actionsByNote.get(String(r.id)) ?? [],
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
              : `${notes.length} recording${notes.length === 1 ? '' : 's'} · agent triages, drafts emails, and creates Docs from each`}
          </p>
        </div>
        <Link href="/dashboard/contacts" className="btn" style={{ alignSelf: 'flex-start' }}>
          Contacts →
        </Link>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {(recentResources?.length ?? 0) > 0 && (
        <section style={{ marginTop: '0.8rem' }}>
          <p className="meta" style={{ fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
            Recent resources
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.3rem' }}>
            {(recentResources ?? []).map((r) => {
              const result = (r.result as Record<string, unknown> | null) ?? {}
              const url = (result.drive_url as string | undefined) ?? (result.html_link as string | undefined)
              const title = (result.title as string | undefined) ?? (r.payload as Record<string, unknown>)?.title as string | undefined ?? 'Resource'
              if (!url) return null
              return (
                <a key={r.id} href={url} target="_blank" rel="noreferrer" className="card" style={{ minWidth: 200, maxWidth: 240, padding: '0.6rem 0.8rem', textDecoration: 'none' }}>
                  <p className="name" style={{ margin: 0, fontSize: '0.88rem' }}>{title}</p>
                  <p className="meta" style={{ margin: '0.15rem 0 0', fontSize: '0.72rem' }}>
                    {r.kind === 'create_doc' ? 'Google Doc' : r.kind === 'create_calendar_event' ? 'Calendar event' : r.kind} · {formatDate(String(r.created_at))}
                  </p>
                </a>
              )
            })}
          </div>
        </section>
      )}

      {notes.length === 0 && (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <p className="empty">
            Process your first recording in the Plaud app — it will show up here
            with the full transcript, summary, and the agent&apos;s proposed actions.
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', flexWrap: 'wrap' }}>
                  <p className="name" style={{ margin: 0 }}>{note.title}</p>
                  {note.triage_class && (
                    <span className="status" style={{
                      flexShrink: 0,
                      background: CLASS_COLOR[note.triage_class] ?? 'var(--muted)',
                      color: '#fff',
                    }}>
                      {CLASS_LABEL[note.triage_class] ?? note.triage_class}
                    </span>
                  )}
                  {note.actions.length > 0 && (
                    <span className="status" style={{ flexShrink: 0 }}>
                      {note.actions.length} action{note.actions.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
                <p className="meta" style={{ fontSize: '0.8rem' }}>
                  {formatDate(note.occurred_at)}
                  {note.duration_seconds ? ` · ${note.duration_seconds}s` : ''}
                </p>
              </summary>

              <div style={{
                borderTop: '1px solid var(--border-soft)',
                padding: '0.85rem 1.1rem',
                display: 'grid',
                gap: '0.85rem',
              }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <PlaudToProjectButton noteId={note.id} />
                </div>

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

                {note.actions.length > 0 && (
                  <div>
                    <p className="meta" style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginBottom: '0.3rem',
                    }}>
                      Actions
                    </p>
                    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
                      {note.actions.map((a) => (
                        <PlaudActionRow key={a.id} {...a} directoryOptions={directoryOptions} />
                      ))}
                    </div>
                  </div>
                )}

                {note.actions.length === 0 && note.action_items.length > 0 && (
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

                {note.triage_reasoning && (
                  <p className="meta" style={{ fontSize: '0.75rem', fontStyle: 'italic' }}>
                    Agent: {note.triage_reasoning}
                  </p>
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
