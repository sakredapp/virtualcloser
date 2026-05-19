// Admin error log viewer. Reads app_errors written by lib/errors.ts.
// Plain server component with simple filters via search params:
//   ?severity=error|warn|fatal
//   ?source=webhook/revring  (exact match)
//   ?rep_id=rep_sakredcrm    (exact match)
//   ?since=24h|7d|30d        (default 24h)

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { isAdminAuthed } from '@/lib/admin-auth'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

type ErrorRow = {
  id: string
  occurred_at: string
  severity: string
  source: string
  rep_id: string | null
  member_id: string | null
  error_type: string
  message: string
  stack: string | null
  context: Record<string, unknown>
}

function sinceStart(s: string | undefined): Date {
  const ms =
    s === '7d'  ? 7  * 86_400_000 :
    s === '30d' ? 30 * 86_400_000 :
                  86_400_000        // default 24h
  return new Date(Date.now() - ms)
}

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ severity?: string; source?: string; rep_id?: string; since?: string }>
}) {
  if (!(await isAdminAuthed())) redirect('/admin/login')

  const sp = await searchParams
  const since = sinceStart(sp.since)

  let q = supabase
    .from('app_errors')
    .select('id, occurred_at, severity, source, rep_id, member_id, error_type, message, stack, context')
    .gte('occurred_at', since.toISOString())
    .order('occurred_at', { ascending: false })
    .limit(200)
  if (sp.severity) q = q.eq('severity', sp.severity)
  if (sp.source)   q = q.eq('source', sp.source)
  if (sp.rep_id)   q = q.eq('rep_id', sp.rep_id)

  const { data, error } = await q
  const rows = ((data ?? []) as ErrorRow[])

  // Quick aggregate: top sources + top error types in the window
  const bySource = new Map<string, number>()
  const byType   = new Map<string, number>()
  for (const r of rows) {
    bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1)
    byType.set(r.error_type, (byType.get(r.error_type) ?? 0) + 1)
  }
  const topSources = Array.from(bySource.entries()).sort((a,b) => b[1] - a[1]).slice(0, 6)
  const topTypes   = Array.from(byType.entries()).sort((a,b) => b[1] - a[1]).slice(0, 6)

  function sevColor(s: string) {
    return s === 'fatal' ? 'var(--alert-fg, #b91c1c)' : s === 'error' ? 'var(--red-deep, #dc2626)' : s === 'warn' ? '#d97706' : '#6b7280'
  }

  return (
    <main style={{ maxWidth: 1200, margin: '40px auto', padding: '0 24px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>App errors</h1>
          <p style={{ color: '#6b7280', marginTop: 4, fontSize: 13 }}>
            {rows.length} {rows.length === 1 ? 'entry' : 'entries'} · since {since.toLocaleString()} · max 200
          </p>
        </div>
        <nav style={{ display: 'flex', gap: 6, fontSize: 13 }}>
          {(['24h','7d','30d'] as const).map((r) => (
            <Link
              key={r}
              href={{ pathname: '/admin/errors', query: { ...sp, since: r } }}
              style={{
                padding: '4px 10px', borderRadius: 6,
                background: (sp.since ?? '24h') === r ? '#111' : '#f3f4f6',
                color:      (sp.since ?? '24h') === r ? '#fff' : '#111',
                textDecoration: 'none', fontWeight: 600,
              }}
            >{r}</Link>
          ))}
        </nav>
      </header>

      {error && (
        <div style={{ padding: 12, background: 'var(--alert-bg, #fef2f2)', border: '1px solid #fecaca', color: 'var(--alert-fg, #991b1b)', borderRadius: 8, marginBottom: 12 }}>
          Query failed: {error.message}
        </div>
      )}

      {/* Aggregates */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
        <Card title="Top sources">
          {topSources.length === 0
            ? <Empty>no errors in window</Empty>
            : topSources.map(([src, n]) => (
                <Row key={src}>
                  <Link href={{ pathname: '/admin/errors', query: { ...sp, source: src } }} style={{ color: '#111', textDecoration: 'none' }}>{src}</Link>
                  <strong>{n}</strong>
                </Row>
              ))}
        </Card>
        <Card title="Top error types">
          {topTypes.length === 0
            ? <Empty>no errors in window</Empty>
            : topTypes.map(([t, n]) => (
                <Row key={t}>
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{t}</span>
                  <strong>{n}</strong>
                </Row>
              ))}
        </Card>
      </section>

      {/* Active filters */}
      {(sp.severity || sp.source || sp.rep_id) && (
        <section style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          <span style={{ color: '#6b7280' }}>Filters:</span>
          {(['severity','source','rep_id'] as const).map((k) => (sp as Record<string,string|undefined>)[k] && (
            <span key={k} style={{ padding: '4px 10px', background: '#eef2ff', borderRadius: 6, color: '#3730a3', fontWeight: 600 }}>
              {k}={(sp as Record<string,string|undefined>)[k]}
            </span>
          ))}
          <Link href={{ pathname: '/admin/errors', query: { since: sp.since } }} style={{ color: 'var(--red-deep, #dc2626)', marginLeft: 6 }}>clear</Link>
        </section>
      )}

      {/* Rows */}
      <section>
        {rows.length === 0 ? (
          <p style={{ color: '#6b7280', textAlign: 'center', padding: 40 }}>No errors in this window 🎉</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {rows.map((r) => (
              <li key={r.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ padding: '2px 8px', borderRadius: 4, background: sevColor(r.severity), color: '#fff', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{r.severity}</span>
                    <strong style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}>{r.error_type}</strong>
                    <span style={{ color: '#6b7280', fontSize: 12 }}>{r.source}</span>
                    {r.rep_id && <span style={{ color: '#6b7280', fontSize: 12 }}>· {r.rep_id}</span>}
                  </div>
                  <time style={{ color: '#6b7280', fontSize: 12 }}>{new Date(r.occurred_at).toLocaleString()}</time>
                </div>
                <div style={{ fontSize: 14, marginBottom: 6 }}>{r.message}</div>
                {Object.keys(r.context).length > 0 && (
                  <details style={{ fontSize: 12 }}>
                    <summary style={{ color: '#6b7280', cursor: 'pointer' }}>context</summary>
                    <pre style={{ marginTop: 6, padding: 8, background: '#f9fafb', borderRadius: 4, overflow: 'auto', maxHeight: 240, fontFamily: 'ui-monospace, monospace' }}>
                      {JSON.stringify(r.context, null, 2)}
                    </pre>
                  </details>
                )}
                {r.stack && (
                  <details style={{ fontSize: 12 }}>
                    <summary style={{ color: '#6b7280', cursor: 'pointer' }}>stack</summary>
                    <pre style={{ marginTop: 6, padding: 8, background: '#f9fafb', borderRadius: 4, overflow: 'auto', maxHeight: 240, fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap' }}>
                      {r.stack}
                    </pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <h3 style={{ margin: 0, marginBottom: 8, fontSize: 13, color: '#374151', textTransform: 'uppercase', letterSpacing: 0.5 }}>{title}</h3>
      {children}
    </div>
  )
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderTop: '1px solid #f3f4f6', fontSize: 13 }}>{children}</div>
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ color: '#6b7280', fontSize: 13, margin: 0 }}>{children}</p>
}
