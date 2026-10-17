'use client'

import { useEffect, useState } from 'react'
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { cleanLines, type StatusLines } from '@/lib/status/weeklyShared'

type Status = StatusLines & { id: string; week: string; confirmed_at: string | null; edited: boolean }

const FIELDS: Array<{ key: keyof StatusLines; label: string; hint: string }> = [
  { key: 'moved', label: 'What you moved', hint: 'One per line' },
  { key: 'next', label: "What's next", hint: 'One per line' },
  { key: 'blockers', label: 'What is blocking you', hint: 'Leave empty if nothing' },
]

/**
 * Your weekly status (Suite CXO). Shows once Ciao has drafted this week's
 * (Friday afternoon): one tap to confirm, or edit the three lists. Reads and
 * writes only the signed-in person's own row, through /api/status/weekly.
 */
export default function WeeklyStatusCard() {
  const [status, setStatus] = useState<Status | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<keyof StatusLines, string>>({ moved: '', next: '', blockers: '' })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/status/weekly')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { status?: Status | null } | null) => {
        if (live && j?.status) setStatus(j.status)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (!status) return null

  function startEdit(s: Status) {
    setDraft({ moved: s.moved.join('\n'), next: s.next.join('\n'), blockers: s.blockers.join('\n') })
    setEditing(true)
    setNote(null)
  }

  async function send(op: 'confirm' | 'save') {
    if (!status) return
    setBusy(true)
    setNote(null)
    try {
      const body = op === 'save' ? { op, id: status.id, moved: cleanLines(draft.moved), next: cleanLines(draft.next), blockers: cleanLines(draft.blockers) } : { op, id: status.id }
      const r = await fetch('/api/status/weekly', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as { status?: Status; error?: string }
      if (r.ok && j.status) {
        setStatus(j.status)
        setEditing(false)
        setNote('Saved. It goes in the Monday rollup.')
      } else setNote(j.error || 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  const confirmed = !!status.confirmed_at
  return (
    <section className="cx-panel" id="weekly-status" aria-labelledby="weekly-status-h">
      <div className="cxp-head">
        <h2 id="weekly-status-h">Your weekly status</h2>
      </div>
      <p className="cx-msg-note" style={{ marginTop: 0 }}>
        {confirmed ? 'Confirmed. Your execs see it in the Monday rollup.' : `${ASSISTANT_NAME} drafted this from your to-dos, board cards and meetings. Confirm it or fix it.`}
      </p>
      {note && <p className="cx-msg-note" role="status">{note}</p>}
      {editing ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          {FIELDS.map((f) => (
            <label key={f.key} style={{ display: 'grid', gap: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{f.label}</span>
              <textarea rows={f.key === 'blockers' ? 2 : 4} value={draft[f.key]} placeholder={f.hint} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
            </label>
          ))}
          <div className="cx-msg-actions">
            <button type="button" className="cx-todo-act" disabled={busy} onClick={() => void send('save')}>
              Save and confirm
            </button>
            <button type="button" className="cx-msg-link" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {FIELDS.map((f) => (
            <div key={f.key} style={{ marginTop: 10 }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>{f.label}</p>
              {status[f.key].length ? (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {status[f.key].map((l) => (
                    <li key={l} style={{ fontSize: 14 }}>{l}</li>
                  ))}
                </ul>
              ) : (
                <p className="cx-msg-note">{f.key === 'blockers' ? 'Nothing blocking.' : 'Nothing yet.'}</p>
              )}
            </div>
          ))}
          <div className="cx-msg-actions" style={{ marginTop: 12 }}>
            {!confirmed && (
              <button type="button" className="cx-todo-act" disabled={busy} onClick={() => void send('confirm')}>
                Looks right
              </button>
            )}
            <button type="button" className={confirmed ? 'cx-todo-act' : 'cx-msg-link'} disabled={busy} onClick={() => startEdit(status)}>
              Edit
            </button>
          </div>
        </>
      )}
    </section>
  )
}
