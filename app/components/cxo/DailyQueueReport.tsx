'use client'

/**
 * The daily queue report: what Mira did ("Done", counts that open into
 * lines) and what is waiting on the person ("Needs you", one tap each).
 * Shown in the Mira panel after a run and kept on Today for the day.
 *
 *   mode='live'  a tap POSTs /api/daily-queue (approve / dismiss)
 *   mode='demo'  never fetches; a tap only marks the row
 *
 * Nothing in "Needs you" has been sent or added anywhere: the tap is the
 * send. Sections with nothing in them are not rendered.
 */
import { useState } from 'react'
import { NOTHING_LINE, reportIsEmpty, sectionLabel, type NeedItem, type QueueReport } from '@/lib/mira/dailyQueueShared'
import './daily-queue.css'

type RowState = { busy?: boolean; note?: string; error?: string; gone?: boolean }
const DEMO_NOTES: Record<NeedItem['kind'], string> = { reply_draft: 'Sent.', email_draft: 'Email sent.', inbox_draft: 'Reply sent.', talking_points: 'Added to the agenda.' }
/** The person can change these before the tap; an email draft is edited where it lives. */
const EDITABLE: NeedItem['kind'][] = ['reply_draft', 'talking_points']

export default function DailyQueueReport({ report, mode = 'live', onChange }: { report: QueueReport; mode?: 'live' | 'demo'; onChange?: () => void }) {
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [edits, setEdits] = useState<Record<string, string>>({})
  const set = (id: string, s: RowState) => setRows((cur) => ({ ...cur, [id]: { ...cur[id], ...s } }))

  const act = async (n: NeedItem, op: 'approve' | 'dismiss') => {
    if (rows[n.id]?.busy) return
    if (mode === 'demo') {
      set(n.id, op === 'approve' ? { note: DEMO_NOTES[n.kind] } : { gone: true })
      return
    }
    set(n.id, { busy: true, error: undefined })
    try {
      const r = await fetch('/api/daily-queue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, id: n.id, body: op === 'approve' && EDITABLE.includes(n.kind) ? edits[n.id] ?? undefined : undefined }) })
      const j = (await r.json().catch(() => null)) as { note?: string; error?: string } | null
      if (!r.ok) {
        set(n.id, { busy: false, error: j?.error || 'That did not go through. Try again.', gone: r.status === 404 })
        return
      }
      set(n.id, op === 'approve' ? { busy: false, note: j?.note || 'Done.' } : { busy: false, gone: true })
      onChange?.()
    } catch {
      set(n.id, { busy: false, error: 'Could not reach Suite CXO. Try again.' })
    }
  }

  const done = report.done.filter((s) => s.lines.length > 0)
  const needs = report.needs.filter((n) => !rows[n.id]?.gone)
  if (reportIsEmpty({ done, needs: report.needs })) {
    return (
      <div className="cx-dq">
        <p className="cx-dq__none">{NOTHING_LINE}</p>
        {report.note && <p className="cx-dq__note">{report.note}</p>}
      </div>
    )
  }

  return (
    <div className="cx-dq">
      {done.length > 0 && (
        <div className="cx-dq__block">
          <p className="cx-dq__h">Done</p>
          <div className="cx-dq__secs">
            {done.map((s) => (
              <details key={s.key} className="cx-dq__sec">
                <summary>{sectionLabel(s.key, s.lines.length)}</summary>
                <ul>
                  {s.lines.map((l) => (
                    <li key={l.key}>
                      {l.text}
                      {l.detail && <span>{l.detail}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </div>
      )}
      {needs.length > 0 && (
        <div className="cx-dq__block">
          <p className="cx-dq__h">
            Needs you <b>{needs.filter((n) => !rows[n.id]?.note).length}</b>
          </p>
          <ul className="cx-dq__needs">
            {needs.map((n) => {
              const st = rows[n.id] ?? {}
              return (
                <li key={n.id} data-done={st.note ? '' : undefined}>
                  <p className="cx-dq__t">{n.title}</p>
                  {st.note ? (
                    <p className="cx-dq__ok">{st.note}</p>
                  ) : (
                    <>
                      {EDITABLE.includes(n.kind) ? (
                        <textarea className="cx-dq__edit" aria-label={n.title} rows={Math.min(5, Math.max(2, (edits[n.id] ?? n.body).split('\n').length + 1))} value={edits[n.id] ?? n.body} onChange={(e) => setEdits((cur) => ({ ...cur, [n.id]: e.target.value }))} disabled={st.busy} />
                      ) : (
                        <p className="cx-dq__b">{n.body}</p>
                      )}
                      {st.error && <p className="cx-dq__err" role="alert">{st.error}</p>}
                      <div className="cx-dq__acts">
                        <button type="button" className="cx-todo-act cx-dq__go" disabled={st.busy} onClick={() => void act(n, 'approve')}>
                          {st.busy ? 'Working…' : n.cta}
                        </button>
                        <button type="button" className="cx-todo-act is-quiet" disabled={st.busy} onClick={() => void act(n, 'dismiss')}>
                          Dismiss
                        </button>
                      </div>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {report.note && <p className="cx-dq__note">{report.note}</p>}
    </div>
  )
}
