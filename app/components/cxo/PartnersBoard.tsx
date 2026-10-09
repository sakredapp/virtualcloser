'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import { DialogProvider, useDialog } from './AppDialog'
import { REPORT_LINES, REPORT_WINDOWS, type Partner, type PartnerAction, type PartnerInput, type PartnerKind, type PartnersToday, type ReportLine } from '@/lib/partnersShared'
import type { PartnerMeeting, SenderStatus } from '@/lib/partners'

/**
 * The Partners page body. The dashboard feeds it a fetch-backed adapter;
 * the public demo feeds it an in-memory one with eight invented partners.
 * Everything a partner can receive goes through the red Actions button:
 * note, email, report, task, schedule check, or "ask Mira".
 */

export type PartnerDetail = {
  partner: Partner
  meetings: PartnerMeeting[]
  actions: PartnerAction[]
  sender: SenderStatus
  calendar: { connected: boolean; canWrite: boolean }
  timezone: string
}

export type ComposeRequest =
  | { kind: 'report'; items: Array<{ line: ReportLine | 'All'; window: string }>; intro?: string; closing?: string }
  | { kind: 'email' | 'note'; subject: string; body: string }

export type ComposeResult = { draft: PartnerAction; subject: string; body: string; missing: string[]; data_through: string | null; sender: SenderStatus }
export type SendResult = { sent: boolean; via?: string; from?: string; reason?: string; gap?: string; action?: PartnerAction }

export type PartnersApi = {
  list(q: string, kind: PartnerKind | ''): Promise<Partner[]>
  detail(id: string): Promise<PartnerDetail>
  create(input: PartnerInput): Promise<Partner>
  update(id: string, input: PartnerInput): Promise<Partner>
  remove(id: string): Promise<void>
  compose(id: string, req: ComposeRequest): Promise<ComposeResult>
  send(id: string, draftId: string, fromAccount?: string): Promise<SendResult>
  record(id: string, input: { kind: 'note' | 'task'; subject?: string; body: string; due_at?: string }): Promise<PartnerAction>
  done(id: string, actionId: string): Promise<void>
  askMira(text: string): void
  /** The Today view: meetings today, what partners sent, notes. */
  today?(): Promise<PartnersToday>
}

type Mode = 'idle' | 'note' | 'email' | 'report' | 'task' | 'schedule' | 'mira' | 'edit'

const EMPTY: PartnerInput = { name: '', org: '', role: '', kind: 'other', email: '', phone: '', notes: '' }

function fmtWhen(iso: string | null | undefined, tz?: string): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: tz || undefined })
  } catch {
    return new Date(iso).toLocaleString('en-US')
  }
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function actionLabel(a: PartnerAction): string {
  if (a.kind === 'report') return a.status === 'sent' ? 'Report sent' : 'Report drafted'
  if (a.kind === 'email') return a.status === 'sent' ? 'Email sent' : 'Email drafted'
  if (a.kind === 'note') return a.status === 'sent' ? 'Note sent' : a.status === 'draft' ? 'Note drafted' : 'Note'
  if (a.kind === 'task') return a.status === 'done' ? 'Task done' : 'Task open'
  if (a.kind === 'meeting') return 'Meeting'
  return a.kind
}

export default function PartnersBoard(props: { api: PartnersApi; initial: Partner[]; hint?: string }) {
  return (
    <DialogProvider>
      <PartnersBoardInner {...props} />
    </DialogProvider>
  )
}

function PartnersBoardInner({ api, initial, hint }: { api: PartnersApi; initial: Partner[]; hint?: string }) {
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Partner[]>(initial)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PartnerDetail | null>(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refreshList = useCallback(async () => {
    setItems(await api.list(q, '' as PartnerKind | ''))
  }, [api, q])

  useEffect(() => {
    const t = window.setTimeout(() => { void refreshList() }, 180)
    return () => window.clearTimeout(t)
  }, [refreshList])

  const open = useCallback(async (id: string) => {
    setSelected(id)
    setLoading(true)
    try {
      setDetail(await api.detail(id))
    } catch {
      setNotice('Could not open that partner.')
    } finally {
      setLoading(false)
    }
  }, [api])

  const reload = useCallback(async () => {
    if (selected) setDetail(await api.detail(selected))
    await refreshList()
  }, [api, selected, refreshList])

  const filtered = items

  return (
    <main className="wrap">
      <PageHeader
        eyebrow="Partners"
        title="Partners"
        subtitle="The executives you work with: carrier leaders, agency principals, your board."
        actions={<button type="button" className="cx-btn" onClick={() => { setAdding(true); setSelected(null); setDetail(null) }}>+ Add partner</button>}
      />
      {hint && <p className="cx-notice">{hint}</p>}
      {notice && <p className="cx-notice">{notice}</p>}

      <div className="cx-partners">
        <section className="cx-panel cx-partners-list">
          <div className="cx-partners-tools">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, role" aria-label="Search partners" className="cx-partners-search" />
          </div>
          <button type="button" className={['cx-partner-row', 'cx-partner-today', !selected && !adding ? 'is-active' : ''].filter(Boolean).join(' ')} onClick={() => { setAdding(false); setSelected(null); setDetail(null) }}>
            <span className="cx-partner-avatar" aria-hidden>{new Date().getDate()}</span>
            <span className="cx-partner-main"><strong>Today</strong><small>Meetings, what came in, notes</small></span>
          </button>
          {filtered.length === 0 ? (
            <p className="cx-takeaway">No partners yet. Add the carrier reps, agency principals and board members you talk to, and Mira can brief them for you.</p>
          ) : (
            <ul className="cx-partners-rows">
              {filtered.map((p) => (
                <li key={p.id}>
                  <button type="button" className={['cx-partner-row', selected === p.id ? 'is-active' : ''].filter(Boolean).join(' ')} onClick={() => { setAdding(false); void open(p.id) }}>
                    <span className="cx-partner-avatar" aria-hidden>{p.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>
                    <span className="cx-partner-main">
                      <strong>{p.name}</strong>
                      <small>{[p.role, p.org].filter(Boolean).join(' · ') || p.email || ''}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cx-panel cx-partners-drawer">
          {adding ? (
            <PartnerForm
              initial={EMPTY}
              title="New partner"
              onCancel={() => setAdding(false)}
              onSave={async (input) => {
                const p = await api.create(input)
                setAdding(false)
                await refreshList()
                await open(p.id)
              }}
            />
          ) : !selected ? (
            <TodayPane api={api} hasPartners={items.length > 0} onOpen={(id) => { setAdding(false); void open(id) }} />
          ) : loading || !detail ? (
            <p className="cx-takeaway">Opening…</p>
          ) : (
            <PartnerPane
              key={detail.partner.id}
              api={api}
              detail={detail}
              onChanged={reload}
              onRemoved={async () => { setSelected(null); setDetail(null); await refreshList() }}
              setNotice={setNotice}
            />
          )}
        </section>
      </div>
    </main>
  )
}

// ── Today ────────────────────────────────────────────────────────────────────

function fmtTime(iso: string, tz?: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz || undefined })
  } catch {
    return ''
  }
}

function TodayPane({ api, hasPartners, onOpen }: { api: PartnersApi; hasPartners: boolean; onOpen: (id: string) => void }) {
  const [data, setData] = useState<PartnersToday | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    if (!api.today) { setFailed(true); return }
    api.today().then((d) => { if (live) setData(d) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [api])
  const tz = data?.timezone
  const dateLine = (data?.now ? new Date(data.now) : new Date()).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz || undefined })
  return (
    <div className="cx-today">
      <p className="cx-eyebrow">Today · {dateLine}</p>
      {!hasPartners && <p className="cx-takeaway">Add the carrier leaders, agency principals and board members you work with. Their meetings, mail and notes collect here.</p>}
      {failed && <p className="cx-takeaway">Today could not load. Pick a partner on the left.</p>}
      {!data && !failed && hasPartners && <p className="cx-takeaway">Loading today…</p>}
      {data && (
        <>
          <section className="cx-today-block">
            <h3>Meetings today</h3>
            {data.meetings.length === 0 ? (
              <p className="cx-today-empty">{data.calendar_connected ? 'No partner meetings today.' : 'Connect your calendar on the Calendar page to see partner meetings here.'}</p>
            ) : (
              <ul className="cx-today-list">
                {data.meetings.map((m) => (
                  <li key={m.id}>
                    <span className="cx-today-time">{fmtTime(m.start, tz)}</span>
                    <button type="button" className="cx-today-main" onClick={() => onOpen(m.partner_id)}>
                      <strong>{m.summary || m.partner_name}</strong>
                      <small>{[m.partner_name, m.org].filter(Boolean).join(' · ')}</small>
                    </button>
                    {m.conferenceLink && <a className="cx-btn cx-btn-sm" href={m.conferenceLink} target="_blank" rel="noreferrer">Join</a>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="cx-today-block">
            <h3>What partners sent</h3>
            {data.inbound === null ? (
              <p className="cx-today-empty">Connect Google on the Calendar page to see mail from partners here.</p>
            ) : data.inbound.length === 0 ? (
              <p className="cx-today-empty">Nothing from partners in the last 7 days.</p>
            ) : (
              <ul className="cx-today-list">
                {data.inbound.map((m) => (
                  <li key={m.thread_id}>
                    <span className="cx-today-time">{m.at ? fmtDay(m.at) : ''}</span>
                    <button type="button" className="cx-today-main" onClick={() => onOpen(m.partner_id)}>
                      <strong>{m.partner_name}{m.subject ? ` · ${m.subject}` : ''}</strong>
                      <small>{m.snippet}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="cx-today-block">
            <h3>Notes</h3>
            {data.notes.length === 0 ? (
              <p className="cx-today-empty">No notes yet. Open a partner and use Actions to add one.</p>
            ) : (
              <ul className="cx-today-list">
                {data.notes.map(({ partner_id, partner_name, action: a }) => (
                  <li key={a.id}>
                    <span className="cx-today-time">{a.kind === 'task' ? (a.due_at ? `Due ${fmtDay(a.due_at)}` : 'Task') : fmtDay(a.created_at)}</span>
                    <button type="button" className="cx-today-main" onClick={() => onOpen(partner_id)}>
                      <strong>{partner_name}</strong>
                      <small>{a.subject || a.body}</small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

// ── Partner pane ─────────────────────────────────────────────────────────────

function PartnerPane({ api, detail, onChanged, onRemoved, setNotice }: {
  api: PartnersApi
  detail: PartnerDetail
  onChanged: () => Promise<void>
  onRemoved: () => Promise<void>
  setNotice: (s: string | null) => void
}) {
  const p = detail.partner
  const [mode, setMode] = useState<Mode>('idle')
  const dialog = useDialog()
  const menu = useRef<HTMLDetailsElement | null>(null)
  const pick = (m: Mode) => { setMode(m); if (menu.current) menu.current.open = false }
  const first = p.name.split(/\s+/)[0]
  const next = detail.meetings[0]

  if (mode === 'edit') {
    return (
      <PartnerForm
        initial={{ name: p.name, org: p.org ?? '', role: p.role ?? '', kind: p.kind, email: p.email ?? '', phone: p.phone ?? '', notes: p.notes ?? '' }}
        title={`Edit ${p.name}`}
        onCancel={() => setMode('idle')}
        onSave={async (input) => { await api.update(p.id, input); setMode('idle'); await onChanged() }}
        onRemove={async () => { if (await dialog.confirm({ title: `Remove ${p.name}?`, body: 'Their notes and history leave your Partners list.', confirmLabel: 'Remove' })) { await api.remove(p.id); await onRemoved() } }}
      />
    )
  }

  return (
    <div className="cx-partner-pane">
      <div className="cx-partner-head">
        <div>
          <p className="cx-eyebrow">Partner</p>
          <h2 className="cx-title" style={{ fontSize: 24 }}>{p.name}</h2>
          <p className="cx-takeaway" style={{ marginTop: 4 }}>{[p.role, p.org].filter(Boolean).join(', ')}</p>
        </div>
        <div className="cx-partner-actions">
          <details className="cx-menu" ref={menu}>
            <summary className="cx-btn">Actions ▾</summary>
            <div className="cx-menu-body cx-partner-menu">
              <button type="button" onClick={() => pick('note')}>Send a note</button>
              <button type="button" onClick={() => pick('email')}>Send an email</button>
              <button type="button" onClick={() => pick('report')}>Send a report</button>
              <button type="button" onClick={() => pick('task')}>Assign a task</button>
              <button type="button" onClick={() => pick('schedule')}>Check schedule</button>
              <button type="button" onClick={() => pick('mira')}>Ask Mira to send something</button>
            </div>
          </details>
          <button type="button" className="cx-btn cx-btn-ghost" onClick={() => setMode('edit')}>Edit</button>
        </div>
      </div>

      <dl className="cx-partner-facts">
        {p.email && <div><dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a></dd></div>}
        {p.phone && <div><dt>Phone</dt><dd><a href={`tel:${p.phone}`}>{p.phone}</a></dd></div>}
        <div>
          <dt>Next meeting</dt>
          <dd>
            {next ? (
              <a href={next.htmlLink} target="_blank" rel="noreferrer">{fmtWhen(next.start, detail.timezone)} · {next.summary}</a>
            ) : detail.calendar.connected ? (
              <>Nothing booked. <button type="button" className="cx-link" onClick={() => api.askMira(`Find 30 minutes with ${p.name} in the next week and book it.`)}>Ask Mira to find a time</button></>
            ) : (
              <>Connect your calendar to see it here.</>
            )}
          </dd>
        </div>
        {p.notes && <div className="cx-partner-notes"><dt>Notes</dt><dd>{p.notes}</dd></div>}
      </dl>

      {mode === 'note' && <MessageComposer kind="note" api={api} detail={detail} onClose={() => setMode('idle')} onChanged={onChanged} setNotice={setNotice} />}
      {mode === 'email' && <MessageComposer kind="email" api={api} detail={detail} onClose={() => setMode('idle')} onChanged={onChanged} setNotice={setNotice} />}
      {mode === 'report' && <ReportComposer api={api} detail={detail} onClose={() => setMode('idle')} onChanged={onChanged} setNotice={setNotice} />}
      {mode === 'task' && <TaskComposer api={api} partner={p} onClose={() => setMode('idle')} onChanged={onChanged} />}
      {mode === 'schedule' && (
        <div className="cx-composer">
          <p className="cx-eyebrow">Schedule with {first}</p>
          {detail.meetings.length === 0 ? (
            <p className="cx-takeaway">{detail.calendar.connected ? `Nothing on the calendar with ${p.name} in the next 60 days.` : 'Connect Google Calendar on the Calendar page to see meetings here.'}</p>
          ) : (
            <ul className="cx-partner-meetings">
              {detail.meetings.map((m) => (
                <li key={m.id}><a href={m.htmlLink} target="_blank" rel="noreferrer">{fmtWhen(m.start, detail.timezone)}</a> · {m.summary}</li>
              ))}
            </ul>
          )}
          <div className="cx-composer-foot">
            <button type="button" className="cx-btn" onClick={() => { api.askMira(`Find 30 minutes with ${p.name} this week or next and book it with a Meet link.`); setMode('idle') }}>Ask Mira to book a call</button>
            <button type="button" className="cx-btn cx-btn-ghost" onClick={() => setMode('idle')}>Close</button>
          </div>
        </div>
      )}
      {mode === 'mira' && <MiraComposer partner={p} api={api} onClose={() => setMode('idle')} />}

      <div className="cx-partner-history">
        <p className="cx-eyebrow">Recent</p>
        {detail.actions.length === 0 ? (
          <p className="cx-takeaway">Nothing sent yet.</p>
        ) : (
          <ul className="cx-partner-log">
            {detail.actions.map((a) => (
              <li key={a.id}>
                <span className="cx-partner-log-when">{fmtDay(a.sent_at ?? a.created_at)}</span>
                <span className="cx-partner-log-main">
                  <strong>{actionLabel(a)}</strong>
                  {a.subject && <span> · {a.subject}</span>}
                  {a.kind === 'task' && a.due_at && a.status !== 'done' && <small> · due {fmtDay(a.due_at)}</small>}
                  {a.status === 'sent' && a.channel && <small> · via {a.channel === 'gmail' ? 'your Gmail' : 'Suite CXO mail'}</small>}
                </span>
                {a.kind === 'task' && a.status !== 'done' && (
                  <button type="button" className="cx-link" onClick={async () => { await api.done(p.id, a.id); await onChanged() }}>Done</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Composers ────────────────────────────────────────────────────────────────

/** Red Send, with a From picker when the exec has more than one Google account connected. */
function SendRow({ sender, draft, sending, onSend, onClose, onEdit, from, onFrom }: { sender: SenderStatus; draft: PartnerAction | null; sending: boolean; onSend: () => void; onClose: () => void; onEdit?: () => void; from?: string; onFrom?: (email: string) => void }) {
  const accounts = sender.accounts.filter((a) => a.email)
  const current = from || draft?.from_account || sender.from || ''
  return (
    <div className="cx-composer-foot">
      {draft && draft.status !== 'sent' && sender.ready && accounts.length > 1 && onFrom && (
        <label className="cx-from">
          <span>From</span>
          <select value={current} onChange={(e) => onFrom(e.target.value)} aria-label="Send from">
            {accounts.map((a) => <option key={a.email!} value={a.email!}>{a.email}{a.label && a.label !== a.email ? ` · ${a.label}` : ''}</option>)}
          </select>
        </label>
      )}
      {draft && draft.status !== 'sent' && (
        sender.ready ? (
          <button type="button" className="cx-btn" onClick={onSend} disabled={sending}>{sending ? 'Sending…' : `Send${sender.via === 'gmail' && accounts.length <= 1 ? ` as ${sender.from}` : ''}`}</button>
        ) : (
          <span className="cx-takeaway" style={{ margin: 0 }}>Draft saved. Connect Google on the Calendar page and the Send button appears here.</span>
        )
      )}
      {onEdit && draft && draft.status !== 'sent' && <button type="button" className="cx-btn cx-btn-ghost" onClick={onEdit}>Edit</button>}
      <button type="button" className="cx-btn cx-btn-ghost" onClick={onClose}>Close</button>
    </div>
  )
}

function MessageComposer({ kind, api, detail, onClose, onChanged, setNotice }: { kind: 'note' | 'email'; api: PartnersApi; detail: PartnerDetail; onClose: () => void; onChanged: () => Promise<void>; setNotice: (s: string | null) => void }) {
  const p = detail.partner
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [draft, setDraft] = useState<PartnerAction | null>(null)
  const [sender, setSender] = useState<SenderStatus>(detail.sender)
  const [from, setFrom] = useState<string>(detail.sender.from ?? '')
  const [busy, setBusy] = useState(false)

  async function saveDraft() {
    if (!body.trim()) return
    setBusy(true)
    try {
      const r = await api.compose(p.id, { kind, subject, body })
      setDraft(r.draft)
      setSubject(r.subject)
      setSender(r.sender)
      await onChanged()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not save the draft.')
    } finally {
      setBusy(false)
    }
  }
  async function send() {
    if (!draft) return
    setBusy(true)
    try {
      const r = await api.send(p.id, draft.id, from || undefined)
      if (r.sent) { setNotice(`Sent to ${p.name}${r.via === 'gmail' ? ` from ${r.from ?? 'your Gmail'}` : ''}.`); await onChanged(); onClose() }
      else setNotice(r.reason ?? 'Not sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cx-composer">
      <p className="cx-eyebrow">{kind === 'note' ? 'Note' : 'Email'} to {p.name}{p.email ? ` · ${p.email}` : ' · no email on file'}</p>
      {draft ? (
        <div className="cx-draft">
          <strong>{draft.subject}</strong>
          <pre>{draft.body}</pre>
        </div>
      ) : (
        <>
          {kind === 'email' && <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" aria-label="Subject" />}
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={kind === 'note' ? 3 : 6} placeholder={kind === 'note' ? `A quick line to ${p.name.split(' ')[0]}` : 'Write it in your words. Mira keeps the voice.'} aria-label="Message" />
        </>
      )}
      {draft ? (
        <SendRow sender={sender} draft={draft} sending={busy} onSend={send} onClose={onClose} onEdit={() => setDraft(null)} from={from} onFrom={setFrom} />
      ) : (
        <div className="cx-composer-foot">
          <button type="button" className="cx-btn" onClick={saveDraft} disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Save draft'}</button>
          <button type="button" className="cx-btn cx-btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      )}
    </div>
  )
}

function ReportComposer({ api, detail, onClose, onChanged, setNotice }: { api: PartnersApi; detail: PartnerDetail; onClose: () => void; onChanged: () => Promise<void>; setNotice: (s: string | null) => void }) {
  const p = detail.partner
  const [picks, setPicks] = useState<Record<ReportLine, string>>({ Health: '3m', Life: '', Annuity: '' })
  const [intro, setIntro] = useState('')
  const [result, setResult] = useState<ComposeResult | null>(null)
  const [from, setFrom] = useState<string>(detail.sender.from ?? '')
  const [busy, setBusy] = useState(false)
  const chosen = REPORT_LINES.filter((l) => picks[l])

  async function draft() {
    if (chosen.length === 0) return
    setBusy(true)
    try {
      const r = await api.compose(p.id, { kind: 'report', items: chosen.map((l) => ({ line: l, window: picks[l] })), intro: intro.trim() || undefined })
      setResult(r)
      await onChanged()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not draft the report.')
    } finally {
      setBusy(false)
    }
  }
  async function send() {
    if (!result) return
    setBusy(true)
    try {
      const r = await api.send(p.id, result.draft.id, from || undefined)
      if (r.sent) { setNotice(`Report sent to ${p.name}${r.via === 'gmail' ? ` from ${r.from ?? 'your Gmail'}` : ''}.`); await onChanged(); onClose() }
      else setNotice(r.reason ?? 'Not sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="cx-composer">
      <p className="cx-eyebrow">Production report for {p.name}</p>
      {result ? (
        <>
          <div className="cx-draft">
            <strong>{result.subject}</strong>
            <pre>{result.body}</pre>
          </div>
          {result.missing.length > 0 && <p className="cx-takeaway">No synced data for: {result.missing.join('; ')}. The draft says so rather than sending a zero.</p>}
          <SendRow sender={result.sender} draft={result.draft} sending={busy} onSend={send} onClose={onClose} onEdit={() => setResult(null)} from={from} onFrom={setFrom} />
        </>
      ) : (
        <>
          <div className="cx-report-grid">
            {REPORT_LINES.map((l) => (
              <div key={l} className="cx-report-line">
                <strong>{l}</strong>
                <div className="cx-seg" role="tablist" aria-label={`${l} period`}>
                  <button type="button" role="tab" aria-selected={!picks[l]} onClick={() => setPicks((c) => ({ ...c, [l]: '' }))}>Skip</button>
                  {REPORT_WINDOWS.map((w) => (
                    <button key={w.key} type="button" role="tab" aria-selected={picks[l] === w.key} onClick={() => setPicks((c) => ({ ...c, [l]: w.key }))}>{w.label}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <input value={intro} onChange={(e) => setIntro(e.target.value)} placeholder="Opening line (optional). Mira writes the numbers." aria-label="Opening line" />
          <div className="cx-composer-foot">
            <button type="button" className="cx-btn" onClick={draft} disabled={busy || chosen.length === 0}>{busy ? 'Reading the book…' : 'Draft with Mira'}</button>
            <button type="button" className="cx-btn cx-btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
    </div>
  )
}

function TaskComposer({ api, partner, onClose, onChanged }: { api: PartnersApi; partner: Partner; onClose: () => void; onChanged: () => Promise<void> }) {
  const [body, setBody] = useState('')
  const [due, setDue] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="cx-composer">
      <p className="cx-eyebrow">Task about {partner.name}</p>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="What needs doing" aria-label="Task" />
      <label className="cx-partner-due">Due <input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <div className="cx-composer-foot">
        <button
          type="button"
          className="cx-btn"
          disabled={busy || !body.trim()}
          onClick={async () => {
            setBusy(true)
            try { await api.record(partner.id, { kind: 'task', body, due_at: due || undefined }); await onChanged(); onClose() } finally { setBusy(false) }
          }}
        >
          Assign
        </button>
        <button type="button" className="cx-btn cx-btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

function MiraComposer({ partner, api, onClose }: { partner: Partner; api: PartnersApi; onClose: () => void }) {
  const [text, setText] = useState(`Send ${partner.name} the health premium for the last 3 months and life premium for the last 6 months.`)
  return (
    <div className="cx-composer">
      <p className="cx-eyebrow">Tell Mira what to send {partner.name.split(' ')[0]}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} aria-label="Ask Mira" />
      <p className="cx-takeaway">Mira drafts it from your live numbers and shows it before anything goes out.</p>
      <div className="cx-composer-foot">
        <button type="button" className="cx-btn" onClick={() => { api.askMira(text); onClose() }}>Ask Mira</button>
        <button type="button" className="cx-btn cx-btn-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  )
}

// ── Add / edit form ──────────────────────────────────────────────────────────

function PartnerForm({ initial, title, onSave, onCancel, onRemove }: { initial: PartnerInput; title: string; onSave: (input: PartnerInput) => Promise<void>; onCancel: () => void; onRemove?: () => Promise<void> }) {
  const [f, setF] = useState<PartnerInput>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = (k: keyof PartnerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((c) => ({ ...c, [k]: e.target.value }))
  return (
    <form
      className="cx-partner-form"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!f.name?.trim()) { setErr('A name is required.'); return }
        setBusy(true)
        setErr(null)
        try { await onSave(f) } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Could not save.') } finally { setBusy(false) }
      }}
    >
      <p className="cx-eyebrow">{title}</p>
      <div className="cx-grid cx-grid-2">
        <label>Name<input value={f.name} onChange={set('name')} required autoFocus /></label>
        <label>Company<input value={f.org ?? ''} onChange={set('org')} /></label>
        <label>Role<input value={f.role ?? ''} onChange={set('role')} /></label>
        <label>Email<input type="email" value={f.email ?? ''} onChange={set('email')} /></label>
        <label>Phone<input value={f.phone ?? ''} onChange={set('phone')} /></label>
      </div>
      <label>Notes<textarea rows={3} value={f.notes ?? ''} onChange={set('notes')} /></label>
      {err && <p className="cx-notice">{err}</p>}
      <div className="cx-composer-foot">
        <button type="submit" className="cx-btn" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="cx-btn cx-btn-ghost" onClick={onCancel}>Cancel</button>
        {onRemove && <button type="button" className="cx-link" style={{ marginLeft: 'auto' }} onClick={() => void onRemove()}>Remove</button>}
      </div>
    </form>
  )
}

/** The dashboard adapter: every call is one of the /api/partners routes. */
export function fetchPartnersApi(): PartnersApi {
  async function j<T>(res: Response): Promise<T> {
    const data = (await res.json().catch(() => ({}))) as T & { error?: string }
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
    return data
  }
  const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return {
    list: async (q, kind) => (await j<{ items: Partner[] }>(await fetch(`/api/partners?q=${encodeURIComponent(q)}&kind=${kind}`, { cache: 'no-store' }))).items,
    detail: async (id) => j<PartnerDetail>(await fetch(`/api/partners/${id}`, { cache: 'no-store' })),
    create: async (input) => (await j<{ partner: Partner }>(await post('/api/partners', input))).partner,
    update: async (id, input) => (await j<{ partner: Partner }>(await fetch(`/api/partners/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }))).partner,
    remove: async (id) => { await j(await fetch(`/api/partners/${id}`, { method: 'DELETE' })) },
    compose: async (id, req) => j<ComposeResult>(await post(`/api/partners/${id}/compose`, req)),
    send: async (id, draftId, fromAccount) => j<SendResult>(await post(`/api/partners/${id}/actions`, { op: 'send', draft_id: draftId, from_account: fromAccount })),
    record: async (id, input) => (await j<{ action: PartnerAction }>(await post(`/api/partners/${id}/actions`, { op: 'record', ...input }))).action,
    done: async (id, actionId) => { await j(await post(`/api/partners/${id}/actions`, { op: 'done', action_id: actionId })) },
    askMira: (text) => window.dispatchEvent(new CustomEvent('mira:ask', { detail: { text } })),
    today: async () => j<PartnersToday>(await fetch('/api/partners/today', { cache: 'no-store' })),
  }
}
