'use client'

import { useCallback, useEffect, useState } from 'react'

type Pending = { id: string; summary: string; reason: 'outside_send' | 'others_work'; status: string; tool: string; requested_by: string; decided_by: string | null; decided_at: string | null; created_at: string }
type Plaud = { id: string; kind: string; to: string | null; subject: string | null; created_at: string }
type Audit = { id: string; who: string; tool: string; result: string; approved: boolean | null; args: Record<string, unknown>; created_at: string }
type Data = { enabled: boolean; canApprove?: boolean; pending: Pending[]; plaud: Plaud[]; audit: Audit[] }

const REASON: Record<string, string> = { outside_send: 'Sends outside the company', others_work: "Changes someone else's work" }
const RESULT: Record<string, string> = { ok: 'Done', not_done: 'Not done', error: 'Failed', refused: 'Refused', queued: 'Waiting for OK' }

function when(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d)
}

const tool = (t: string) => t.replace(/_/g, ' ')

export default function ApprovalsClient() {
  const [data, setData] = useState<Data | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const r = await fetch('/api/approvals', { cache: 'no-store' }).catch(() => null)
    if (r?.ok) setData((await r.json()) as Data)
  }, [])
  useEffect(() => {
    void refresh()
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh])

  async function decide(id: string, approve: boolean) {
    setBusy(id)
    setErr(null)
    try {
      const r = await fetch('/api/approvals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, approve }) })
      const j = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) throw new Error(j.error || 'That did not go through.')
      await refresh()
      window.dispatchEvent(new Event('cxo:messages'))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not go through.')
    } finally {
      setBusy(null)
    }
  }

  async function plaud(id: string, op: 'approve' | 'dismiss') {
    setBusy(id)
    setErr(null)
    try {
      const r = await fetch(`/api/plaud/actions/${encodeURIComponent(id)}/${op}`, { method: 'POST' })
      if (!r.ok) throw new Error('That did not go through.')
      await refresh()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not go through.')
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <section className="cx-panel" style={{ marginTop: 16 }}><p className="cx-takeaway" style={{ margin: 0 }}>Loading…</p></section>
  const pending = data.pending.filter((p) => p.status === 'pending')

  return (
    <div className="cxp" style={{ display: 'grid', gap: 16, marginTop: 16 }}>
      {err && <p className="cx-pref-err" role="alert">{err}</p>}

      <section className="cx-panel">
        <div className="cxp-head"><h2>Waiting for an OK{pending.length + data.plaud.length > 0 && <span> · {pending.length + data.plaud.length}</span>}</h2></div>
        {pending.length === 0 && data.plaud.length === 0 ? (
          <p className="cxp-note">Nothing is waiting. Mira runs an executive&apos;s own asks straight away; an employee&apos;s outside sends land here first.</p>
        ) : (
          <ul className="cx-todo-rows cx-due-rows" aria-label="Waiting for approval">
            {pending.map((p) => (
              <li key={p.id} className="cx-msg cx-due">
                <p className="cx-msg-meta">
                  <strong>{p.requested_by}</strong>
                  <span className="cx-msg-tag">{REASON[p.reason] ?? p.reason}</span>
                  <span className="cx-msg-time">{when(p.created_at)}</span>
                </p>
                <p className="cx-msg-body">{p.summary}</p>
                <p className="cx-msg-note">Mira will {tool(p.tool)} as {p.requested_by} once approved.</p>
                {data.canApprove && (
                  <div className="cx-msg-actions">
                    <button type="button" className="cx-todo-act" disabled={busy === p.id} onClick={() => void decide(p.id, true)}>Approve</button>
                    <button type="button" className="cx-msg-link" disabled={busy === p.id} onClick={() => void decide(p.id, false)}>Decline</button>
                  </div>
                )}
              </li>
            ))}
            {data.plaud.map((p) => (
              <li key={p.id} className="cx-msg cx-due">
                <p className="cx-msg-meta">
                  <strong>Meeting notes</strong>
                  <span className="cx-msg-tag">{p.kind === 'send_email' ? 'Email' : 'Invite'}</span>
                  <span className="cx-msg-time">{when(p.created_at)}</span>
                </p>
                <p className="cx-msg-body">{p.subject || (p.kind === 'send_email' ? 'Email' : 'Calendar invite')}{p.to ? ` → ${p.to}` : ''}</p>
                <div className="cx-msg-actions">
                  <button type="button" className="cx-todo-act" disabled={busy === p.id} onClick={() => void plaud(p.id, 'approve')}>Approve</button>
                  <button type="button" className="cx-msg-link" disabled={busy === p.id} onClick={() => void plaud(p.id, 'dismiss')}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="cx-panel">
        <div className="cxp-head"><h2>What Mira did</h2></div>
        {data.audit.length === 0 ? (
          <p className="cxp-note">No actions yet.</p>
        ) : (
          <div className="cx-usage-scroll">
            <table className="cx-usage">
              <thead>
                <tr><th>When</th><th>Who</th><th>Action</th><th>Result</th></tr>
              </thead>
              <tbody>
                {data.audit.map((a) => (
                  <tr key={a.id}>
                    <td>{when(a.created_at)}</td>
                    <td>{a.who}</td>
                    <td>{tool(a.tool)}</td>
                    <td>{RESULT[a.result] ?? a.result}{a.approved === true ? ' · approved' : a.approved === false ? ' · declined' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
