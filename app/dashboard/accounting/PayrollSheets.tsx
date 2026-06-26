'use client'

import { useState } from 'react'

export type ConnectedSheetLite = {
  id: string
  title: string | null
  label: string | null
  default_tab: string | null
}

type Preview = { title?: string; tab: string; tabs: string[]; headers: string[]; rows: string[][]; total: number }

/**
 * Connect multiple Google Sheets and pull data in. Add/remove go through server
 * actions (passed as props); preview + import hit the API. Reuses the app's
 * existing Google OAuth (spreadsheets scope).
 */
export default function PayrollSheets({
  sheets,
  connectAction,
  removeAction,
}: {
  sheets: ConnectedSheetLite[]
  connectAction: (fd: FormData) => Promise<void>
  removeAction: (fd: FormData) => Promise<void>
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function loadPreview(id: string, tab?: string) {
    setLoading(true); setMsg(null); setOpenId(id)
    const qs = new URLSearchParams({ id, ...(tab ? { tab } : {}) })
    const res = await fetch(`/api/payroll/sheets/preview?${qs}`)
    const json = (await res.json().catch(() => ({}))) as Preview & { error?: string }
    setLoading(false)
    if ((json as { error?: string }).error) { setPreview(null); setMsg((json as { error?: string }).error ?? 'Could not read sheet.'); return }
    setPreview(json)
  }

  async function doImport(id: string, tab: string) {
    setLoading(true); setMsg(null)
    const res = await fetch('/api/payroll/sheets/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, tab }),
    })
    const json = (await res.json().catch(() => ({}))) as { imported?: number; skipped?: number; mapping?: Record<string, string>; error?: string }
    setLoading(false)
    if (json.error) { setMsg(json.error); return }
    const mapped = Object.entries(json.mapping ?? {}).map(([h, f]) => `${h}→${f}`).join(', ')
    setMsg(
      json.imported
        ? `Imported ${json.imported} commission rows${json.skipped ? ` (skipped ${json.skipped})` : ''}.${mapped ? ` Columns used: ${mapped}.` : ''} Refresh the Commissions tab to see them.`
        : `Nothing imported — I couldn't recognize the columns. Tell us your column names in the feedback box and we'll map them.`,
    )
  }

  return (
    <section className="card">
      <h2 style={{ margin: 0, fontSize: 16 }}>Connect your Google Sheets</h2>
      <p className="meta" style={{ margin: '0.2rem 0 0.7rem', fontSize: '0.82rem' }}>
        Paste a sheet URL to connect it (connect as many as you like). Preview the data, and pull it into your
        commissions. Uses your connected Google account — connect it in Integrations if a sheet won’t open.
      </p>

      <form action={connectAction} style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
        <input name="url" placeholder="https://docs.google.com/spreadsheets/d/…" style={{ flex: '2 1 280px', padding: '0.5rem 0.6rem' }} />
        <input name="label" placeholder="Label (e.g. Commissions paid)" style={{ flex: '1 1 160px', padding: '0.5rem 0.6rem' }} />
        <button className="btn approve" type="submit">Connect</button>
      </form>

      {sheets.length === 0 ? (
        <p className="meta" style={{ marginTop: '0.8rem', fontSize: '0.84rem' }}>No sheets connected yet.</p>
      ) : (
        <div style={{ marginTop: '0.8rem', display: 'grid', gap: '0.5rem' }}>
          {sheets.map((s) => (
            <div key={s.id} style={{ border: '1px solid var(--border-soft)', borderRadius: 8, padding: '0.6rem 0.8rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '0.9rem' }}>{s.label || s.title || 'Sheet'}</strong>
                {s.title && s.label && <span className="meta" style={{ fontSize: '0.74rem' }}>{s.title}</span>}
                <span style={{ flex: 1 }} />
                <button className="btn" onClick={() => loadPreview(s.id)} disabled={loading} style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem' }}>
                  {openId === s.id ? 'Refresh' : 'Preview'}
                </button>
                <form action={removeAction} style={{ display: 'inline' }}>
                  <input type="hidden" name="id" value={s.id} />
                  <button className="btn" type="submit" style={{ fontSize: '0.74rem', padding: '0.2rem 0.55rem', color: 'var(--red-deep, #dc2626)' }}>Remove</button>
                </form>
              </div>

              {openId === s.id && preview && (
                <div style={{ marginTop: '0.6rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                    {preview.tabs.length > 1 && (
                      <label className="meta" style={{ fontSize: '0.76rem' }}>
                        Tab:{' '}
                        <select value={preview.tab} onChange={(e) => loadPreview(s.id, e.target.value)}>
                          {preview.tabs.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </label>
                    )}
                    <span className="meta" style={{ fontSize: '0.74rem' }}>{preview.total} rows</span>
                    <span style={{ flex: 1 }} />
                    <button className="btn approve" onClick={() => doImport(s.id, preview.tab)} disabled={loading} style={{ fontSize: '0.74rem', padding: '0.25rem 0.6rem' }}>
                      Import to commissions
                    </button>
                  </div>
                  <div style={{ overflowX: 'auto', border: '1px solid var(--border-soft)', borderRadius: 6 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                      <thead>
                        <tr style={{ background: 'var(--paper-2, #f1efe9)' }}>
                          {preview.headers.map((h, i) => <th key={i} style={{ padding: '4px 8px', textAlign: 'left', whiteSpace: 'nowrap' }}>{h || `Col ${i + 1}`}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.slice(0, 12).map((r, ri) => (
                          <tr key={ri} style={{ borderTop: '1px solid var(--border-soft)' }}>
                            {preview.headers.map((_, ci) => <td key={ci} style={{ padding: '4px 8px', whiteSpace: 'nowrap' }}>{r[ci] ?? ''}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {loading && <p className="meta" style={{ marginTop: '0.6rem', fontSize: '0.8rem' }}>Working…</p>}
      {msg && <p className="meta" style={{ marginTop: '0.6rem', fontSize: '0.82rem', color: 'var(--signal-info, #2563eb)' }}>{msg}</p>}
    </section>
  )
}
