'use client'

import { useState } from 'react'
import { noticeTag } from '@/lib/followups/shared'
import type { NoticeView } from '@/lib/followups/notices'
import { actionsFor } from '@/lib/followups/noticeActionsShared'
import { ASSISTANT_NAME } from '@/lib/assistantName'

/**
 * "From Mira" on an employee's page: their own follow-up nudges, close notes
 * and approval results. "Got it" clears one. Reads and writes only through
 * /api/employees/me/notices, which is scoped to the signed-in member.
 */
export default function MiraNotices({ initial }: { initial: NoticeView[] }) {
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  if (!rows.length && !note) return null

  async function doAction(id: string, action: string) {
    setBusy(id)
    setNote(null)
    try {
      const r = await fetch('/api/employees/me/notices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'act', id, action }) })
      const j = (await r.json().catch(() => ({}))) as { note?: string; error?: string }
      setNote(j.note || j.error || null)
      if (r.ok) {
        setRows((xs) => xs.filter((x) => x.id !== id))
        window.dispatchEvent(new Event('cxo:todos'))
      }
    } finally {
      setBusy(null)
    }
  }

  async function gotIt(id: string) {
    setBusy(id)
    try {
      const r = await fetch('/api/employees/me/notices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'read', id }) })
      if (r.ok) setRows((xs) => xs.filter((x) => x.id !== id))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="cx-panel">
      <div className="cxp-head"><h2>From {ASSISTANT_NAME}</h2></div>
      {note && <p className="cx-msg-note" role="status">{note}</p>}
      <ul className="cx-todo-rows cx-due-rows" aria-label={`From ${ASSISTANT_NAME}`}>
        {rows.map((n) => (
          <li key={n.id} className={`cx-msg cx-due${n.kind === 'escalate' ? ' is-overdue' : ''}`}>
            <p className="cx-msg-meta">
              <strong>{ASSISTANT_NAME}</strong>
              <span className="cx-msg-tag">{noticeTag(n.kind)}</span>
            </p>
            <p className="cx-msg-body">{n.title}</p>
            {n.body && <p className="cx-msg-note" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
            <div className="cx-msg-actions">
              {actionsFor(n).map((a) => (
                <button key={a.action} type="button" className="cx-todo-act" disabled={busy === n.id} onClick={() => void doAction(n.id, a.action)}>
                  {a.label}
                </button>
              ))}
              <button type="button" className="cx-msg-link" disabled={busy === n.id} onClick={() => void gotIt(n.id)}>
                Got it
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
