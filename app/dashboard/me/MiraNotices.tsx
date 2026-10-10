'use client'

import { useState } from 'react'
import { noticeTag } from '@/lib/followups/shared'
import type { NoticeView } from '@/lib/followups/notices'

/**
 * "From Mira" on an employee's page: their own follow-up nudges, close notes
 * and approval results. "Got it" clears one. Reads and writes only through
 * /api/employees/me/notices, which is scoped to the signed-in member.
 */
export default function MiraNotices({ initial }: { initial: NoticeView[] }) {
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  if (!rows.length) return null

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
      <div className="cxp-head"><h2>From Mira</h2></div>
      <ul className="cx-todo-rows cx-due-rows" aria-label="From Mira">
        {rows.map((n) => (
          <li key={n.id} className={`cx-msg cx-due${n.kind === 'escalate' ? ' is-overdue' : ''}`}>
            <p className="cx-msg-meta">
              <strong>Mira</strong>
              <span className="cx-msg-tag">{noticeTag(n.kind)}</span>
            </p>
            <p className="cx-msg-body">{n.title}</p>
            {n.body && <p className="cx-msg-note" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
            <div className="cx-msg-actions">
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
