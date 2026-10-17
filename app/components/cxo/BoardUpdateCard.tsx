'use client'

import { useEffect, useState } from 'react'
import { useAssistantName } from '@/app/components/AssistantNameProvider'
import { monthLabel } from '@/lib/boardUpdate/shared'

type Update = { id: string; month: string; body: string; draft_text: string; status: 'draft' | 'edited' | 'sent'; edited: boolean; generated_at: string; sent_at: string | null }

/**
 * The monthly board update (Suite CXO, owners and admins). Ciao drafts it on
 * the first business day of the month from the book, the plan, QuickBooks,
 * goals, board cards and meeting decisions. Edit it here, copy it and send it
 * yourself: Ciao never sends it. Reads and writes through /api/board-update.
 */
export default function BoardUpdateCard() {
  const assistantName = useAssistantName()
  const [update, setUpdate] = useState<Update | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/board-update')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { update?: Update | null; current_month?: string } | null) => {
        if (!live || !j?.update) return
        setUpdate(j.update)
        setText(j.update.body)
        setCurrent(j.current_month ?? null)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  // An older update that was already sent has nothing left to do here.
  if (!update || (update.status === 'sent' && current && update.month !== current)) return null

  async function post(body: Record<string, unknown>, ok: string) {
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch('/api/board-update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const j = (await r.json().catch(() => ({}))) as { update?: Update; error?: string }
      if (r.ok && j.update) {
        setUpdate(j.update)
        setText(j.update.body)
        setEditing(false)
        setNote(ok)
      } else setNote(j.error || 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(editing ? text : update!.body)
      setNote('Copied. Paste it into your email to the board.')
    } catch {
      setNote('Could not copy. Select the text and copy it.')
    }
  }

  const sent = update.status === 'sent'
  return (
    <section className="cx-panel" id="board-update" aria-labelledby="board-update-h">
      <div className="cxp-head">
        <h2 id="board-update-h">Board update: {monthLabel(update.month)}</h2>
      </div>
      <p className="cx-msg-note" style={{ marginTop: 0 }}>
        {sent
          ? 'You marked this as sent.'
          : `${assistantName} drafted this from your numbers, goals, board and meetings. Edit it, copy it and send it yourself. ${assistantName} never sends it.`}
      </p>
      {note && <p className="cx-msg-note" role="status">{note}</p>}
      {editing ? (
        <textarea
          aria-label="Board update text"
          rows={18}
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ width: '100%', marginTop: 8, fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5 }}
        />
      ) : (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, lineHeight: 1.5, margin: '8px 0 0', fontVariantNumeric: 'tabular-nums' }}>{update.body}</pre>
      )}
      <div className="cx-msg-actions" style={{ marginTop: 12 }}>
        {editing ? (
          <>
            <button type="button" className="cx-todo-act" disabled={busy} onClick={() => void post({ op: 'save', id: update.id, body: text }, 'Saved.')}>
              Save
            </button>
            <button type="button" className="cx-msg-link" disabled={busy} onClick={() => { setText(update.body); setEditing(false) }}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="cx-todo-act" disabled={busy} onClick={() => void copy()}>
              Copy
            </button>
            <button type="button" className="cx-msg-link" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
            <button
              type="button"
              className="cx-msg-link"
              disabled={busy}
              title={update.edited ? 'Fresh numbers. Your edited text stays as it is.' : 'Redraw it from fresh numbers.'}
              onClick={() => void post({ op: 'regenerate', month: update.month, keep_edits: true }, update.edited ? 'Numbers refreshed. Your edits were kept.' : 'Redrawn from fresh numbers.')}
            >
              Refresh numbers
            </button>
            {update.edited && (
              <button type="button" className="cx-msg-link" disabled={busy} onClick={() => { if (window.confirm('Replace your edits with a fresh draft?')) void post({ op: 'regenerate', month: update.month, keep_edits: false }, 'Fresh draft in place of your edits.') }}>
                Start over
              </button>
            )}
            <button type="button" className="cx-msg-link" disabled={busy} onClick={() => void post({ op: 'sent', id: update.id, sent: !sent }, sent ? 'Marked as not sent.' : 'Marked as sent.')}>
              {sent ? 'Not sent yet' : 'I sent it'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
