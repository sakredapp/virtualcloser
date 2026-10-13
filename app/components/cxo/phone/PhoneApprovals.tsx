'use client'

/**
 * Approvals on a phone: Waiting and Done, one card each, and a full-page
 * detail with Approve and Decline at the thumb. Same data and the same two
 * calls as the desktop list (ApprovalsClient owns them); this only draws it.
 * Only what the product really stores is shown: who asked, what it does, why
 * it needs an OK, and when.
 */
import { useEffect, useMemo, useState } from 'react'

export type PhonePending = { id: string; summary: string; reason: string; status: string; tool: string; requested_by: string; decided_by: string | null; decided_at: string | null; created_at: string }
export type PhonePlaud = { id: string; kind: string; to: string | null; subject: string | null; created_at: string }

const REASON: Record<string, string> = { outside_send: 'Sends outside the company', others_work: "Changes someone else's work" }
const STATUS: Record<string, string> = { approved: 'Approved', executed: 'Approved and done', declined: 'Declined', failed: 'Approved, did not go through' }
const tool = (t: string) => t.replace(/_/g, ' ')

function ago(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs} ${hrs === 1 ? 'hour' : 'hours'} ago`
  const days = Math.round(hrs / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}
const when = (iso: string) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

type Item =
  | { kind: 'ask'; id: string; row: PhonePending }
  | { kind: 'notes'; id: string; row: PhonePlaud }

export default function PhoneApprovals({ pending, plaud, canApprove, busy, err, assistantName, onDecide, onPlaud, demoDone }: {
  pending: PhonePending[]
  plaud: PhonePlaud[]
  canApprove: boolean
  busy: string | null
  err: string | null
  assistantName: string
  onDecide: (id: string, approve: boolean) => void
  onPlaud: (id: string, op: 'approve' | 'dismiss') => void
  /** The public demo: the decided list is handed in and nothing is requested. */
  demoDone?: PhonePending[]
}) {
  const [seg, setSeg] = useState<'waiting' | 'done'>('waiting')
  const [openId, setOpenId] = useState<string | null>(null)
  const [done, setDone] = useState<PhonePending[] | null>(null)

  const items = useMemo<Item[]>(() => [...pending.map((row) => ({ kind: 'ask' as const, id: row.id, row })), ...plaud.map((row) => ({ kind: 'notes' as const, id: row.id, row }))], [pending, plaud])
  const open = items.find((i) => i.id === openId) ?? null

  // Decided ones are asked for the first time Done is opened.
  useEffect(() => {
    if (seg !== 'done' || demoDone) return
    let alive = true
    fetch('/api/approvals?status=all', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { pending?: PhonePending[] } | null) => {
        if (alive) setDone((j?.pending ?? []).filter((p) => p.status !== 'pending'))
      })
      .catch(() => {
        if (alive) setDone([])
      })
    return () => {
      alive = false
    }
  }, [seg, pending.length, demoDone])
  const doneList = demoDone ?? done

  // The detail closes itself once its item is decided.
  useEffect(() => {
    if (openId && !items.some((i) => i.id === openId)) setOpenId(null)
  }, [openId, items])

  const title = (i: Item) => (i.kind === 'ask' ? i.row.summary : i.row.subject || (i.row.kind === 'send_email' ? 'Email' : 'Calendar invite'))
  const tags = (i: Item) =>
    i.kind === 'ask'
      ? [REASON[i.row.reason] ?? i.row.reason]
      : ['Meeting notes', i.row.kind === 'send_email' ? 'Email' : 'Invite']
  const approve = (i: Item) => (i.kind === 'ask' ? onDecide(i.id, true) : onPlaud(i.id, 'approve'))
  const decline = (i: Item) => (i.kind === 'ask' ? onDecide(i.id, false) : onPlaud(i.id, 'dismiss'))
  const mayDecide = (i: Item) => i.kind === 'notes' || canApprove

  if (open) {
    const i = open
    return (
      <div className="cxph cxph-only cxph-detail">
        <div className="cxph-nav">
          <button type="button" className="cxph-round" onClick={() => setOpenId(null)} aria-label="Back to approvals">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m14.5 6-6 6 6 6" /></svg>
          </button>
        </div>
        {err && <p className="cxph-err" role="alert">{err}</p>}
        <div className="cxph-dhead">
          <span className="cxph-tag solid">Needs your OK</span>{' '}
          {tags(i).map((t) => <span key={t} className="cxph-tag" style={{ marginLeft: 4 }}>{t}</span>)}
          <h2>{title(i)}</h2>
        </div>
        <p className="cxph-dverdict">
          {i.kind === 'ask'
            ? `${assistantName} will ${tool(i.row.tool)} as ${i.row.requested_by} once you approve.`
            : `${assistantName} wrote this from your meeting notes. Approve and it goes out.`}
        </p>
        <div className="cxph-card cxph-facts">
          {i.kind === 'ask' ? (
            <>
              <div><span>Asked by</span><b>{i.row.requested_by}</b></div>
              <div><span>What it does</span><b>{tool(i.row.tool)}</b></div>
              <div><span>Why it needs you</span><b>{REASON[i.row.reason] ?? i.row.reason}</b></div>
              <div><span>Asked</span><b>{when(i.row.created_at)}</b></div>
            </>
          ) : (
            <>
              <div><span>From</span><b>Meeting notes</b></div>
              <div><span>Kind</span><b>{i.row.kind === 'send_email' ? 'Email' : 'Calendar invite'}</b></div>
              {i.row.to && <div><span>To</span><b>{i.row.to}</b></div>}
              <div><span>Written</span><b>{when(i.row.created_at)}</b></div>
            </>
          )}
        </div>
        {i.kind === 'ask' && (
          <>
            <p className="cxph-sub">What was asked</p>
            <div className="cxph-card cxph-letter">{i.row.summary}</div>
          </>
        )}
        {mayDecide(i) ? (
          <div className="cxph-actionbar">
            <button type="button" className="cxph-btn grow" disabled={busy === i.id} onClick={() => approve(i)}>Approve</button>
            <button type="button" className="cxph-btn ghost" disabled={busy === i.id} onClick={() => decline(i)}>{i.kind === 'ask' ? 'Decline' : 'Dismiss'}</button>
          </div>
        ) : (
          <p className="cxph-conn">An owner, admin or manager decides this one.</p>
        )}
      </div>
    )
  }

  return (
    <div className="cxph cxph-only">
      <div className="cxph-title">
        <h2>Approvals</h2>
        <p>{items.length === 0 ? 'Nothing is waiting for you.' : `${assistantName} did the work. ${items.length === 1 ? 'This 1 needs' : `These ${items.length} need`} your OK.`}</p>
      </div>
      <div className="cxph-seg" role="tablist" aria-label="Approvals">
        <button type="button" role="tab" aria-selected={seg === 'waiting'} className={seg === 'waiting' ? 'is-on' : ''} onClick={() => setSeg('waiting')}>Waiting {items.length}</button>
        <button type="button" role="tab" aria-selected={seg === 'done'} className={seg === 'done' ? 'is-on' : ''} onClick={() => setSeg('done')}>Done{doneList ? ` ${doneList.length}` : ''}</button>
      </div>
      {err && <p className="cxph-err" role="alert">{err}</p>}

      {seg === 'waiting' ? (
        items.length === 0 ? (
          <div className="cxph-card cxph-appr">
            <div className="cxph-why" style={{ marginTop: 0 }}>
              <span className="cxph-orb" aria-hidden />
              <span>{assistantName} runs an executive&apos;s own asks straight away. An employee&apos;s outside sends land here first.</span>
            </div>
          </div>
        ) : (
          items.map((i) => (
            <div key={i.id} className="cxph-card cxph-appr">
              <div className="top">
                {tags(i).map((t, n) => <span key={t} className={n === 0 ? 'cxph-tag solid' : 'cxph-tag'}>{t}</span>)}
                <span className="when">Asked {ago(i.row.created_at)}</span>
              </div>
              <h3>{title(i)}</h3>
              <p className="who">{i.kind === 'ask' ? `For ${i.row.requested_by}` : i.row.to ? `To ${i.row.to}` : 'From your meeting notes'}</p>
              <div className="cxph-acts">
                {mayDecide(i) && <button type="button" className="cxph-btn grow" disabled={busy === i.id} onClick={() => approve(i)}>Approve</button>}
                {mayDecide(i) && <button type="button" className="cxph-btn ghost" disabled={busy === i.id} onClick={() => decline(i)}>{i.kind === 'ask' ? 'Decline' : 'Dismiss'}</button>}
                <button type="button" className={mayDecide(i) ? 'cxph-btn ghost' : 'cxph-btn ghost grow'} onClick={() => setOpenId(i.id)} aria-label={`Details: ${title(i)}`}>Details</button>
              </div>
            </div>
          ))
        )
      ) : doneList === null ? (
        <p className="cxph-quiet">Loading…</p>
      ) : doneList.length === 0 ? (
        <p className="cxph-quiet">Nothing has been decided yet.</p>
      ) : (
        doneList.map((d) => (
          <div key={d.id} className="cxph-card cxph-appr">
            <div className="top">
              <span className={d.status === 'declined' || d.status === 'failed' ? 'cxph-tag' : 'cxph-tag solid'}>{STATUS[d.status] ?? d.status}</span>
              <span className="when">{d.decided_at ? when(d.decided_at) : when(d.created_at)}</span>
            </div>
            <h3>{d.summary}</h3>
            <p className="who">For {d.requested_by}{d.decided_by ? `, decided by ${d.decided_by}` : ''}</p>
          </div>
        ))
      )}
    </div>
  )
}
