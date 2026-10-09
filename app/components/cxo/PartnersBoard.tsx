'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '@/app/components/PageHeader'
import { DialogProvider, useDialog } from './AppDialog'
import PartnerOpenCards from './PartnerOpenCards'
import {
  CONTACT_TYPES,
  CONTACT_TYPE_LABEL,
  CONTACT_TYPE_PLURAL,
  REPORT_LINES,
  REPORT_WINDOWS,
  looksLikeEmail,
  looksLikePhone,
  telHref,
  typeOfKind,
  typesForScope,
  type ContactType,
  type DirectoryScope,
  type ImportResult,
  type Partner,
  type PartnerAction,
  type PartnerInput,
  type PartnerKind,
  type PartnersToday,
  type ReportLine,
} from '@/lib/partnersShared'
import type { PartnerMeeting, SenderStatus } from '@/lib/partners'
import { IMPORT_FIELDS, guessMapping, parseCsv, parseVcf, rowsFromCsv, type ColumnMap, type ImportField } from '@/lib/contactImport'

/**
 * The Partners page body: the exec team's shared contact directory.
 * Execs first, then carrier reps, vendors and everyone else.
 * The dashboard feeds it a fetch-backed adapter; the public demo feeds it an
 * in-memory one. Everything a partner can receive goes through the Actions
 * button: note, email, report, task, schedule check, or "ask Mira".
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
  /** Server-side search (name, company, role, email, phone) and type filter. */
  /** scope: which directory page is asking (Execs or Partners); absent = everyone. */
  list(q: string, type: ContactType | '', scope?: DirectoryScope): Promise<Partner[]>
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
  /** CSV / vCard import. Absent → no Import button. */
  importRows?(rows: PartnerInput[]): Promise<ImportResult>
}

type Mode = 'idle' | 'note' | 'email' | 'report' | 'task' | 'schedule' | 'mira'

const EMPTY: PartnerInput = {
  name: '', org: '', role: '', kind: 'executive', on_platform: false,
  email: '', email_secondary: '', email_support: '',
  phone: '', phone_office: '', phone_office_ext: '',
  website: '', address: '', notes: '', tags: [],
}

function toInput(p: Partner): PartnerInput {
  return {
    name: p.name, org: p.org ?? '', role: p.role ?? '', kind: p.kind, on_platform: p.on_platform ?? false,
    email: p.email ?? '', email_secondary: p.email_secondary ?? '', email_support: p.email_support ?? '',
    phone: p.phone ?? '', phone_office: p.phone_office ?? '', phone_office_ext: p.phone_office_ext ?? '',
    website: p.website ?? '', address: p.address ?? '', notes: p.notes ?? '', tags: p.tags ?? [],
  }
}

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

function initials(name: string): string {
  return name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase()
}

function websiteHref(w: string): string {
  return /^https?:\/\//i.test(w) ? w : `https://${w}`
}

/** A small Copy button; says "Copied" for a moment. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="cx-dir-copy"
      aria-label={`Copy ${label}`}
      title={`Copy ${label}`}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          window.setTimeout(() => setDone(false), 1200)
        } catch {
          /* clipboard blocked: nothing to do */
        }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

const SCOPE_COPY: Record<DirectoryScope, { title: string; subtitle: string; add: string; empty: string }> = {
  execs: {
    title: 'Execs',
    subtitle: 'Pinnacle Life Group\u2019s exec team. Message, call or email in one tap.',
    add: 'Add exec',
    empty: 'No execs yet. Import or add one from the top of the page.',
  },
  partners: {
    title: 'Partners',
    subtitle: 'Carrier reps, vendors and outside partners.',
    add: 'Add contact',
    empty: 'No contacts yet. Import or add one from the top of the page.',
  },
}

export default function PartnersBoard(props: { api: PartnersApi; initial: Partner[]; hint?: string; scope?: DirectoryScope }) {
  return (
    <DialogProvider>
      <PartnersBoardInner {...props} />
    </DialogProvider>
  )
}

function PartnersBoardInner({ api, initial, hint, scope = 'partners' }: { api: PartnersApi; initial: Partner[]; hint?: string; scope?: DirectoryScope }) {
  const copy = SCOPE_COPY[scope]
  const chipTypes = typesForScope(scope)
  // A new contact starts as the page's own kind: an exec on Execs, a carrier rep on Partners.
  const blank: PartnerInput = scope === 'execs' ? { ...EMPTY, kind: 'executive', on_platform: true } : { ...EMPTY, kind: 'carrier' }
  const [q, setQ] = useState('')
  const [type, setType] = useState<ContactType | ''>('')
  const [items, setItems] = useState<Partner[]>(initial)
  const [total, setTotal] = useState(initial.length)
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PartnerDetail | null>(null)
  const [modal, setModal] = useState<null | { kind: 'add' } | { kind: 'edit'; partner: Partner } | { kind: 'import' }>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const seq = useRef(0)

  const refreshList = useCallback(async () => {
    const mine = ++seq.current
    setSearching(true)
    try {
      const rows = await api.list(q.trim(), type, scope)
      if (mine !== seq.current) return
      setItems(rows)
      if (!q.trim() && !type) setTotal(rows.length)
    } catch {
      if (mine === seq.current) setNotice('Could not load contacts. Try again.')
    } finally {
      if (mine === seq.current) setSearching(false)
    }
  }, [api, q, type, scope])

  // Debounced: the search runs on the server once typing pauses.
  useEffect(() => {
    const t = window.setTimeout(() => { void refreshList() }, 250)
    return () => window.clearTimeout(t)
  }, [refreshList])

  const open = useCallback(async (id: string) => {
    setSelected(id)
    setLoading(true)
    try {
      setDetail(await api.detail(id))
    } catch {
      setNotice('Could not open that contact.')
    } finally {
      setLoading(false)
    }
  }, [api])

  const reload = useCallback(async () => {
    if (selected) setDetail(await api.detail(selected))
    await refreshList()
  }, [api, selected, refreshList])

  const filtering = Boolean(q.trim() || type)
  const headerActions = (
    <div className="cx-dir-head-actions">
      {api.importRows && <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => setModal({ kind: 'import' })}>Import</button>}
      <button type="button" className="cx-btn cx-btn-sm" onClick={() => setModal({ kind: 'add' })}>{copy.add}</button>
    </div>
  )

  return (
    <main className="wrap">
      <PageHeader
        title={copy.title}
        subtitle={copy.subtitle}
        actions={headerActions}
      />
      {hint && <p className="cx-notice">{hint}</p>}
      {notice && <p className="cx-notice" role="status">{notice}</p>}

      <div className="cx-partners">
        <section className="cx-panel cx-partners-list">
          <div className="cx-partners-tools">
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, company, email, phone" aria-label="Search contacts" className="cx-partners-search" />
            {chipTypes.length > 1 && (
            <div className="cx-dir-chips" role="tablist" aria-label="Contact type">
              <button type="button" role="tab" aria-selected={type === ''} className="cx-dir-chip" onClick={() => setType('')}>All</button>
              {chipTypes.map((t) => (
                <button key={t} type="button" role="tab" aria-selected={type === t} className="cx-dir-chip" onClick={() => setType(t)}>{CONTACT_TYPE_PLURAL[t]}</button>
              ))}
            </div>
            )}
          </div>
          <button type="button" className={['cx-partner-row', 'cx-partner-today', !selected ? 'is-active' : ''].filter(Boolean).join(' ')} onClick={() => { setSelected(null); setDetail(null) }}>
            <span className="cx-partner-avatar" aria-hidden>{new Date().getDate()}</span>
            <span className="cx-partner-main"><strong>Today</strong><small>Meetings, what came in, notes</small></span>
          </button>
          {items.length === 0 ? (
            total === 0 && !filtering ? (
              <p className="cx-dir-empty">{copy.empty}</p>
            ) : (
              <p className="cx-dir-empty">{searching ? 'Searching…' : 'No one matches that.'}</p>
            )
          ) : (
            <ul className="cx-partners-rows cx-dir-rows" aria-busy={searching}>
              {items.map((p) => (
                <li key={p.id} className={['cx-dir-row', selected === p.id ? 'is-active' : ''].filter(Boolean).join(' ')}>
                  <button type="button" className="cx-dir-row-main" onClick={() => void open(p.id)}>
                    <span className="cx-partner-avatar" aria-hidden>{initials(p.name)}</span>
                    <span className="cx-partner-main">
                      <strong>
                        {p.name}
                        {p.kind === 'executive' && <span className="cx-dir-tag">{p.on_platform ? 'On Suite CXO' : 'Executive'}</span>}
                        {p.kind !== 'executive' && <span className="cx-dir-tag is-quiet">{CONTACT_TYPE_LABEL[typeOfKind(p.kind)]}</span>}
                      </strong>
                      <small>{[p.org, p.role].filter(Boolean).join(' · ') || ' '}</small>
                    </span>
                  </button>
                  {(p.email || p.phone || p.phone_office) && (
                    <div className="cx-dir-row-contact">
                      {p.email && (
                        <span className="cx-dir-line">
                          <a href={`mailto:${p.email}`}>{p.email}</a>
                          <CopyButton value={p.email} label="email" />
                        </span>
                      )}
                      {(p.phone || p.phone_office) && (
                        <span className="cx-dir-line">
                          <a href={telHref((p.phone || p.phone_office)!, p.phone ? null : p.phone_office_ext)}>{p.phone || `${p.phone_office}${p.phone_office_ext ? ` x${p.phone_office_ext}` : ''}`}</a>
                          <CopyButton value={(p.phone || p.phone_office)!} label="phone" />
                        </span>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="cx-panel cx-partners-drawer">
          {!selected ? (
            <TodayPane api={api} hasPartners={total > 0} scope={scope} onOpen={(id) => void open(id)} />
          ) : loading || !detail ? (
            <p className="cx-takeaway">Opening…</p>
          ) : (
            <PartnerPane
              key={detail.partner.id}
              api={api}
              detail={detail}
              onChanged={reload}
              onEdit={() => setModal({ kind: 'edit', partner: detail.partner })}
              setNotice={setNotice}
            />
          )}
        </section>
      </div>

      {modal?.kind === 'add' && (
        <ContactModal
          initial={blank}
          title={copy.add}
          onClose={() => setModal(null)}
          onSave={async (input) => {
            const p = await api.create(input)
            setModal(null)
            setNotice(`${p.name} added.`)
            await refreshList()
            await open(p.id)
          }}
        />
      )}
      {modal?.kind === 'edit' && (
        <ContactModal
          initial={toInput(modal.partner)}
          title={`Edit ${modal.partner.name}`}
          onClose={() => setModal(null)}
          onSave={async (input) => { await api.update(modal.partner.id, input); setModal(null); await reload() }}
          onRemove={async () => {
            await api.remove(modal.partner.id)
            setModal(null)
            setSelected(null)
            setDetail(null)
            await refreshList()
          }}
        />
      )}
      {modal?.kind === 'import' && api.importRows && (
        <ImportModal
          run={api.importRows}
          initialType={scope === 'execs' ? 'executive' : 'carrier'}
          types={scope === 'execs' ? ['executive'] : chipTypes}
          onClose={() => setModal(null)}
          onDone={async (r) => { setNotice(`${r.added} added, ${r.updated} updated, ${r.skipped} skipped.`); await refreshList() }}
        />
      )}
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

function TodayPane({ api, hasPartners, scope, onOpen }: { api: PartnersApi; hasPartners: boolean; scope: DirectoryScope; onOpen: (id: string) => void }) {
  // Execs and Partners share this pane; every line names the page's own people.
  const who = scope === 'execs' ? { many: 'execs', one: 'an exec' } : { many: 'partners', one: 'a partner' }
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
      {failed && <p className="cx-takeaway">Today could not load. Pick {who.one} on the left.</p>}
      {!data && !failed && hasPartners && <p className="cx-takeaway">Loading today…</p>}
      {data && (
        <>
          <section className="cx-today-block">
            <h3>Meetings today</h3>
            {data.meetings.length === 0 ? (
              data.calendar_connected
                ? <p className="cx-today-empty">No meetings with {who.many} today.</p>
                : <ConnectGoogleLine text={`Connect Google to see your meetings with ${who.many} here.`} />
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
            <h3>What {who.many} sent</h3>
            {data.inbound === null ? (
              <ConnectGoogleLine text={`Connect Google to see your emails with ${who.many} here.`} />
            ) : data.inbound.length === 0 ? (
              <p className="cx-today-empty">Nothing from {who.many} in the last 7 days.</p>
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
              <p className="cx-today-empty">No notes yet. Open {who.one} and use Actions to add one.</p>
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

function PartnerPane({ api, detail, onChanged, onEdit, setNotice }: {
  api: PartnersApi
  detail: PartnerDetail
  onChanged: () => Promise<void>
  onEdit: () => void
  setNotice: (s: string | null) => void
}) {
  const p = detail.partner
  const [mode, setMode] = useState<Mode>('idle')
  const menu = useRef<HTMLDetailsElement | null>(null)
  const pick = (m: Mode) => { setMode(m); if (menu.current) menu.current.open = false }
  const first = p.name.split(/\s+/)[0]
  const next = detail.meetings[0]
  const typeLine = p.kind === 'executive' ? (p.on_platform ? 'Exec · on Suite CXO' : 'Exec') : CONTACT_TYPE_LABEL[typeOfKind(p.kind)]

  return (
    <div className="cx-partner-pane">
      <div className="cx-partner-head">
        <div>
          <p className="cx-eyebrow">{typeLine}</p>
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
          <button type="button" className="cx-btn cx-btn-ghost" onClick={onEdit}>Edit</button>
        </div>
      </div>

      <dl className="cx-partner-facts">
        {p.email && <div><dt>Email</dt><dd><a href={`mailto:${p.email}`}>{p.email}</a> <CopyButton value={p.email} label="email" /></dd></div>}
        {p.phone && <div><dt>Mobile</dt><dd><a href={telHref(p.phone)}>{p.phone}</a> <CopyButton value={p.phone} label="mobile" /></dd></div>}
        {p.phone_office && <div><dt>Office</dt><dd><a href={telHref(p.phone_office, p.phone_office_ext)}>{p.phone_office}{p.phone_office_ext ? ` x${p.phone_office_ext}` : ''}</a> <CopyButton value={p.phone_office_ext ? `${p.phone_office} x${p.phone_office_ext}` : p.phone_office} label="office phone" /></dd></div>}
        {p.email_secondary && <div><dt>Second email</dt><dd><a href={`mailto:${p.email_secondary}`}>{p.email_secondary}</a></dd></div>}
        {p.email_support && <div><dt>Support</dt><dd><a href={`mailto:${p.email_support}`}>{p.email_support}</a></dd></div>}
        {p.website && <div><dt>Website</dt><dd><a href={websiteHref(p.website)} target="_blank" rel="noreferrer">{p.website.replace(/^https?:\/\//i, '')}</a></dd></div>}
        {p.address && <div><dt>Address</dt><dd>{p.address}</dd></div>}
        {(p.tags ?? []).length > 0 && <div><dt>Tags</dt><dd className="cx-dir-tags">{p.tags.map((t) => <span key={t} className="cx-dir-tag is-quiet">{t}</span>)}</dd></div>}
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
            detail.calendar.connected
              ? <p className="cx-takeaway">{`Nothing on the calendar with ${p.name} in the next 60 days.`}</p>
              : <ConnectGoogleLine text={`Connect Google to see upcoming meetings with ${p.name}.`} />
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

      <PartnerOpenCards partnerId={p.id} />

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

/** One plain line plus an inline Connect Google button that comes back here. */
const CONNECT_GOOGLE_HREF = '/api/google/oauth/start?return=%2Fdashboard%2Fpartners'
function ConnectGoogleLine({ text, inline }: { text: string; inline?: boolean }) {
  return (
    <div className={`cx-gconnect${inline ? ' is-inline' : ''}`}>
      <span>{text}</span>
      <a className="cx-btn cx-btn-sm" href={CONNECT_GOOGLE_HREF}>Connect Google</a>
    </div>
  )
}

// ── Composers ────────────────────────────────────────────────────────────────

/** Send, with a From picker when the exec has more than one Google account connected. */
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
          <ConnectGoogleLine inline text="Draft saved. Connect Google to send it from your Gmail." />
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

// ── Add / edit modal ─────────────────────────────────────────────────────────

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="cx-dialog-scrim cx-dir-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={['cx-dialog', 'cx-dir-modal', wide ? 'is-wide' : ''].filter(Boolean).join(' ')} role="dialog" aria-modal="true" aria-labelledby="cx-dir-modal-title">
        <h2 id="cx-dir-modal-title">{title}</h2>
        {children}
      </div>
    </div>
  )
}

function ContactModal({ initial, title, onSave, onClose, onRemove }: { initial: PartnerInput; title: string; onSave: (input: PartnerInput) => Promise<void>; onClose: () => void; onRemove?: () => Promise<void> }) {
  const [f, setF] = useState<PartnerInput>(initial)
  const [tagText, setTagText] = useState((initial.tags ?? []).join(', '))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dialog = useDialog()
  const set = (k: keyof PartnerInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((c) => ({ ...c, [k]: e.target.value }))
  const warnEmail = (v: string | null | undefined) => (looksLikeEmail(v) ? null : <small className="cx-dir-warn">That doesn't look like an email. It saves anyway.</small>)
  const warnPhone = (v: string | null | undefined) => (looksLikePhone(v) ? null : <small className="cx-dir-warn">That doesn't look like a phone number. It saves anyway.</small>)
  const type = typeOfKind(f.kind ?? 'other')
  return (
    <Modal title={title} onClose={onClose} wide>
      <form
        className="cx-partner-form cx-dir-form"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!f.name?.trim()) { setErr('A name is required.'); return }
          setBusy(true)
          setErr(null)
          const tags = tagText.split(',').map((t) => t.trim()).filter(Boolean)
          try { await onSave({ ...f, tags, on_platform: f.kind === 'executive' ? Boolean(f.on_platform) : false }) } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Could not save.') } finally { setBusy(false) }
        }}
      >
        <fieldset>
          <legend>Who</legend>
          <div className="cx-grid cx-grid-2">
            <label>Name<input value={f.name} onChange={set('name')} required autoFocus autoComplete="off" /></label>
            <label>Company<input value={f.org ?? ''} onChange={set('org')} autoComplete="off" /></label>
            <label>Role / title<input value={f.role ?? ''} onChange={set('role')} autoComplete="off" /></label>
            <label>Type
              <select value={type === 'other' && f.kind && f.kind !== 'other' ? f.kind : type} onChange={(e) => setF((c) => ({ ...c, kind: e.target.value as PartnerKind }))}>
                {CONTACT_TYPES.map((t) => <option key={t} value={t}>{CONTACT_TYPE_LABEL[t]}</option>)}
                {f.kind && !(CONTACT_TYPES as readonly string[]).includes(f.kind) && <option value={f.kind}>Other ({f.kind})</option>}
              </select>
            </label>
          </div>
          {f.kind === 'executive' && (
            <label className="cx-dir-check"><input type="checkbox" checked={Boolean(f.on_platform)} onChange={(e) => setF((c) => ({ ...c, on_platform: e.target.checked }))} /> Has Suite CXO too</label>
          )}
        </fieldset>
        <fieldset>
          <legend>Email</legend>
          <div className="cx-grid cx-grid-3">
            <label>Primary<input type="email" value={f.email ?? ''} onChange={set('email')} />{warnEmail(f.email)}</label>
            <label>Secondary<input type="email" value={f.email_secondary ?? ''} onChange={set('email_secondary')} />{warnEmail(f.email_secondary)}</label>
            <label>Support<input type="email" value={f.email_support ?? ''} onChange={set('email_support')} />{warnEmail(f.email_support)}</label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Phone</legend>
          <div className="cx-grid cx-dir-phones">
            <label>Mobile<input type="tel" value={f.phone ?? ''} onChange={set('phone')} />{warnPhone(f.phone)}</label>
            <label>Office<input type="tel" value={f.phone_office ?? ''} onChange={set('phone_office')} />{warnPhone(f.phone_office)}</label>
            <label>Ext.<input inputMode="numeric" value={f.phone_office_ext ?? ''} onChange={set('phone_office_ext')} /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>More</legend>
          <div className="cx-grid cx-grid-2">
            <label>Website<input value={f.website ?? ''} onChange={set('website')} placeholder="example.com" /></label>
            <label>Tags<input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="Carrier, product line" /></label>
          </div>
          <label>Address (optional)<input value={f.address ?? ''} onChange={set('address')} /></label>
          <label>Notes<textarea rows={3} value={f.notes ?? ''} onChange={set('notes')} /></label>
        </fieldset>
        {err && <p className="cx-notice">{err}</p>}
        <footer className="cx-dir-foot">
          {onRemove && (
            <button
              type="button"
              className="cx-link cx-dir-remove"
              onClick={async () => {
                if (await dialog.confirm({ title: `Remove ${initial.name}?`, body: 'They leave the team directory, with their notes and history.', confirmLabel: 'Remove' })) {
                  setBusy(true)
                  try { await onRemove() } catch (ex) { setErr(ex instanceof Error ? ex.message : 'Could not remove.') } finally { setBusy(false) }
                }
              }}
            >
              Remove
            </button>
          )}
          <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onClose}>Cancel</button>
          <button type="submit" className="cx-btn cx-btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </footer>
      </form>
    </Modal>
  )
}

// ── Import ───────────────────────────────────────────────────────────────────

type Staged = { source: 'csv'; header: string[]; body: string[][]; map: ColumnMap } | { source: 'vcf'; rows: PartnerInput[] }

function ImportModal({ run, onClose, onDone, initialType = 'carrier', types = CONTACT_TYPES }: { run: (rows: PartnerInput[]) => Promise<ImportResult>; onClose: () => void; onDone: (r: ImportResult) => Promise<void>; initialType?: ContactType; types?: readonly ContactType[] }) {
  const [staged, setStaged] = useState<Staged | null>(null)
  const [fileName, setFileName] = useState('')
  const [defaultKind, setDefaultKind] = useState<ContactType>(initialType)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [over, setOver] = useState(false)

  async function take(file: File | undefined) {
    if (!file) return
    setErr(null)
    setResult(null)
    if (file.size > 5_000_000) { setErr('That file is over 5 MB. Split it and import each part.'); return }
    const text = await file.text()
    setFileName(file.name)
    if (/\.vcf$/i.test(file.name) || /^\s*BEGIN:VCARD/i.test(text)) {
      const rows = parseVcf(text, defaultKind)
      if (rows.length === 0) { setErr('No contacts found in that vCard file.'); return }
      setStaged({ source: 'vcf', rows })
      return
    }
    const all = parseCsv(text)
    if (all.length < 2) { setErr('That CSV needs a header row and at least one contact.'); return }
    const header = all[0]
    setStaged({ source: 'csv', header, body: all.slice(1), map: guessMapping(header) })
  }

  const rows: PartnerInput[] = !staged ? [] : staged.source === 'csv' ? rowsFromCsv(staged.body, staged.map, defaultKind) : staged.rows.map((r) => ({ ...r, kind: defaultKind }))
  const named = rows.filter((r) => r.name.trim())
  const noName = rows.length - named.length
  const csvReady = staged?.source !== 'csv' || staged.map.name !== undefined || staged.map.first_name !== undefined || staged.map.last_name !== undefined

  return (
    <Modal title="Import contacts" onClose={onClose} wide>
      {result ? (
        <>
          <p className="cx-dir-result">{result.added} added, {result.updated} updated, {result.skipped} skipped.</p>
          <p className="cx-takeaway">Matches were found by email first, then by name and company. A match only fills in what the file has.</p>
          <footer className="cx-dir-foot"><button type="button" className="cx-btn cx-btn-sm" onClick={onClose}>Done</button></footer>
        </>
      ) : !staged ? (
        <>
          <label
            className={['cx-dir-drop', over ? 'is-over' : ''].filter(Boolean).join(' ')}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void take(e.dataTransfer.files?.[0]) }}
          >
            <input type="file" accept=".csv,.vcf,text/csv,text/vcard,text/x-vcard" onChange={(e) => void take(e.target.files?.[0])} />
            <strong>Drop a CSV or vCard (.vcf) here</strong>
            <span>or click to choose a file. Exports from Outlook, Google Contacts, iPhone or a spreadsheet all work.</span>
          </label>
          {err && <p className="cx-notice">{err}</p>}
          <footer className="cx-dir-foot"><button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onClose}>Cancel</button></footer>
        </>
      ) : (
        <>
          <p className="cx-takeaway" style={{ marginTop: 0 }}>{fileName} · {rows.length} {rows.length === 1 ? 'contact' : 'contacts'}{noName ? ` · ${noName} without a name will be skipped` : ''}</p>
          <label className="cx-dir-inline">Type for these contacts
            <select value={defaultKind} onChange={(e) => setDefaultKind(e.target.value as ContactType)}>
              {types.map((t) => <option key={t} value={t}>{CONTACT_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          {staged.source === 'csv' && (
            <details className="cx-dir-map" open>
              <summary>Match your columns</summary>
              <div className="cx-dir-map-grid">
                {IMPORT_FIELDS.map((fld) => (
                  <label key={fld.key}>
                    <span>{fld.label}</span>
                    <select
                      value={staged.map[fld.key as ImportField] ?? -1}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setStaged({ ...staged, map: { ...staged.map, [fld.key]: v < 0 ? undefined : v } })
                      }}
                    >
                      <option value={-1}>Not in file</option>
                      {staged.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </details>
          )}
          <p className="cx-eyebrow" style={{ marginTop: 14 }}>Preview</p>
          <div className="cx-dir-preview">
            <table className="cx-table">
              <thead><tr><th>Name</th><th>Company · role</th><th>Email</th><th>Phone</th></tr></thead>
              <tbody>
                {rows.slice(0, 8).map((r, i) => (
                  <tr key={i} className={r.name.trim() ? '' : 'is-skip'}>
                    <th scope="row">{r.name || 'No name, skipped'}</th>
                    <td>{[r.org, r.role].filter(Boolean).join(' · ')}</td>
                    <td>{r.email}{r.email && !looksLikeEmail(r.email) ? ' (check)' : ''}</td>
                    <td>{r.phone || r.phone_office}{r.phone_office_ext ? ` x${r.phone_office_ext}` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 8 && <p className="cx-takeaway">and {rows.length - 8} more</p>}
          </div>
          {!csvReady && <p className="cx-notice">Pick the column that holds the name.</p>}
          {err && <p className="cx-notice">{err}</p>}
          <footer className="cx-dir-foot">
            <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={() => { setStaged(null); setErr(null) }}>Choose another file</button>
            <button
              type="button"
              className="cx-btn cx-btn-sm"
              disabled={busy || !csvReady || named.length === 0}
              onClick={async () => {
                setBusy(true)
                setErr(null)
                try {
                  const r = await run(rows)
                  setResult(r)
                  await onDone(r)
                } catch (ex) {
                  setErr(ex instanceof Error ? ex.message : 'The import did not finish.')
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? 'Importing…' : `Import ${named.length}`}
            </button>
          </footer>
        </>
      )}
    </Modal>
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
    list: async (q, type, scope) => (await j<{ items: Partner[] }>(await fetch(`/api/partners?q=${encodeURIComponent(q)}&type=${type}${scope ? `&scope=${scope}` : ''}`, { cache: 'no-store' }))).items,
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
    importRows: async (rows) => j<ImportResult>(await post('/api/partners/import', { rows })),
  }
}
