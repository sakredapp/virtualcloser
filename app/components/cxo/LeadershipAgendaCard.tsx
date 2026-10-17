'use client'

import { useEffect, useState } from 'react'
import { ASSISTANT_NAME } from '@/lib/assistantName'
import { askCiao } from '@/lib/followups/noticeActionsShared'
import { agendaInvitePrompt, AGENDA_ANCHOR } from '@/lib/meetings/agendaShared'

type Agenda = { id: string; title: string; when: string; body: string; edited: boolean; on_invite: boolean }

/**
 * The next leadership meeting's agenda (Suite CXO, owner and admins). Shows
 * once Ciao has drafted it, about a day before. Edit the text here; "Add to
 * the invite" asks Ciao, who shows the exact text and waits for a yes.
 */
export default function LeadershipAgendaCard() {
  const [agenda, setAgenda] = useState<Agenda | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    fetch('/api/meetings/agenda')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { agenda?: Agenda | null } | null) => {
        if (live && j?.agenda) setAgenda(j.agenda)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])

  if (!agenda) return null

  async function save() {
    if (!agenda) return
    setBusy(true)
    setNote(null)
    try {
      const r = await fetch('/api/meetings/agenda', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'save', id: agenda.id, body: draft }) })
      const j = (await r.json().catch(() => ({}))) as { agenda?: Agenda; error?: string }
      if (r.ok && j.agenda) {
        setAgenda(j.agenda)
        setEditing(false)
        setNote('Saved. It is not on the invite until you add it.')
      } else setNote(j.error || 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cx-panel" id={AGENDA_ANCHOR} aria-labelledby="leadership-agenda-h">
      <div className="cxp-head">
        <h2 id="leadership-agenda-h">Agenda: {agenda.title}</h2>
      </div>
      <p className="cx-msg-note" style={{ marginTop: 0 }}>
        {agenda.when}.{' '}
        {agenda.on_invite ? 'It is on the invite.' : `${ASSISTANT_NAME} drafted this from last meeting's notes, open to-dos, the weekly status and what people asked to raise. Nothing goes on the invite until you say yes.`}
      </p>
      {note && <p className="cx-msg-note" role="status">{note}</p>}
      {editing ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
          <textarea rows={14} value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Agenda text" />
          <div className="cx-msg-actions">
            <button type="button" className="cx-todo-act" disabled={busy || !draft.trim()} onClick={() => void save()}>
              Save
            </button>
            <button type="button" className="cx-msg-link" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 14, margin: '10px 0 0' }}>{agenda.body}</pre>
          <div className="cx-msg-actions" style={{ marginTop: 12 }}>
            <button type="button" className="cx-todo-act" disabled={busy} onClick={() => askCiao(agendaInvitePrompt({ id: agenda.id, title: agenda.title }))}>
              {agenda.on_invite ? 'Update the invite' : 'Add to the invite'}
            </button>
            <button
              type="button"
              className="cx-msg-link"
              disabled={busy}
              onClick={() => {
                setDraft(agenda.body)
                setEditing(true)
                setNote(null)
              }}
            >
              Edit
            </button>
          </div>
        </>
      )}
    </section>
  )
}
