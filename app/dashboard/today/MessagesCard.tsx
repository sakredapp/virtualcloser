'use client'

import { useCallback, useEffect, useState } from 'react'
import type { MessageView, OrgMember } from '@/lib/memberMessages'
import { dueDateLabel, dueWords, type ReminderView } from '@/lib/dueRemindersShared'
import { noticeTag } from '@/lib/followups/shared'
import '../cxo-alerts.css'

type NoticeRow = { id: string; kind: string; title: string; body: string | null; href: string; due_date: string | null; created_at: string }
type Data = { inbox: MessageView[]; sent: MessageView[]; members: OrgMember[]; reminders?: ReminderView[]; /** Mira's follow-up notices (employee ops switch on). */ notices?: NoticeRow[] }

const KIND_TAG: Record<string, string> = { request: 'Request', question: 'Question', note: 'Note', message: '' }

function when(iso: string, tz: string): string {
  const d = new Date(iso)
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x)
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d).replace(' ', '').toLowerCase()
  if (day(d) === day(new Date())) return time
  if (day(d) === day(new Date(Date.now() - 86_400_000))) return `Yesterday ${time}`
  return `${new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(d)}, ${time}`
}
const first = (n: string) => n.split(/\s+/)[0]

async function op(body: Record<string, unknown>) {
  const res = await fetch('/api/messages', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((j as { error?: string }).error || 'That did not go through.')
  return j
}

/**
 * Today › Messages: notes, questions and requests from the other executives
 * in the company. Replies thread back to the sender's own card; a request is
 * already on the to-do list. Sent messages show whether they were read.
 */
export default function MessagesCard({ initial, timezone, brief = [], emailNeedReply = null, emailHref = '/dashboard/inbox?tab=email' }: { initial: Data; timezone: string; /** Mira's morning brief lines (deterministic, built on the server). */ brief?: string[]; /** The member's own emails needing a reply; null when Google is not connected. */ emailNeedReply?: number | null; /** Where the email line goes: the viewer's own inbox. */ emailHref?: string }) {
  const tz = timezone || 'America/New_York'
  const [data, setData] = useState<Data>(initial)
  const [replying, setReplying] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [alerts, setAlerts] = useState<'on' | 'off' | 'na'>('na')

  const refresh = useCallback(async () => {
    const r = await fetch('/api/messages', { cache: 'no-store' }).catch(() => null)
    if (r?.ok) setData((await r.json()) as Data)
  }, [])

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    setAlerts(Notification.permission === 'granted' ? 'on' : Notification.permission === 'denied' ? 'na' : 'off')
    const t = setInterval(refresh, 60_000)
    const onMsg = () => void refresh()
    window.addEventListener('cxo:messages', onMsg)
    return () => {
      clearInterval(t)
      window.removeEventListener('cxo:messages', onMsg)
    }
  }, [refresh])

  async function act(id: string, body: Record<string, unknown>) {
    setBusy(id)
    setErr(null)
    try {
      await op(body)
      if (body.op === 'reply') {
        setReplying(null)
        setDraft('')
      }
      await refresh()
      window.dispatchEvent(new Event('cxo:messages-read'))
      if (body.op === 'todo') window.dispatchEvent(new Event('cxo:todos'))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not go through.')
    } finally {
      setBusy(null)
    }
  }

  const inbox = data.inbox
  const sent = data.sent
  const reminders = data.reminders ?? []
  const notices = data.notices ?? []
  const total = inbox.length + reminders.length + notices.length

  return (
    <section className="cx-todo cx-msgs" aria-labelledby="today-msgs">
      <header className="cx-todo-head">
        <h2 id="today-msgs">
          Messages{total > 0 && <span>{total}</span>}
        </h2>
        {alerts === 'off' && (
          <button
            type="button"
            className="cx-todo-act"
            onClick={() => void Notification.requestPermission().then((p) => setAlerts(p === 'granted' ? 'on' : 'na'))}
          >
            Turn on alerts
          </button>
        )}
      </header>

      {brief.length > 0 && (
        <div className="cx-brief" role="note" aria-label="Mira's morning brief">
          <p className="cx-brief-head">Mira · morning brief</p>
          {brief.map((line) => (
            <p key={line} className="cx-brief-line">
              {line}
            </p>
          ))}
        </div>
      )}

      {notices.length > 0 && (
        <ul className="cx-todo-rows cx-due-rows" aria-label="From Mira">
          {notices.map((n) => (
            <li key={n.id} className={`cx-msg cx-due${n.kind === 'escalate' ? ' is-overdue' : ''}`}>
              <p className="cx-msg-meta">
                <strong>Mira</strong>
                <span className="cx-msg-tag">{noticeTag(n.kind)}</span>
                <span className="cx-msg-time">{when(n.created_at, tz)}</span>
              </p>
              <p className="cx-msg-body">{n.title}</p>
              {n.body && <p className="cx-msg-note" style={{ whiteSpace: 'pre-wrap' }}>{n.body}</p>}
              <div className="cx-msg-actions">
                <a className="cx-todo-act" href={n.href}>
                  {n.kind === 'approval' ? 'Review' : 'Open'}
                </a>
                <button type="button" className="cx-msg-link" disabled={busy === n.id} onClick={() => void act(n.id, { op: 'notice.read', id: n.id })}>
                  Got it
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {reminders.length > 0 && (
        <ul className="cx-todo-rows cx-due-rows" aria-label="Cards due soon">
          {reminders.map((r) => (
            <li key={r.id} className={`cx-msg cx-due${r.days_left < 0 ? ' is-overdue' : ''}`}>
              <p className="cx-msg-meta">
                <strong>{r.board_name}</strong>
                <span className="cx-msg-tag">{r.days_left < 0 ? 'Overdue' : 'Due soon'}</span>
                <span className="cx-msg-time">{dueDateLabel(r.due_date)}</span>
              </p>
              <p className="cx-msg-body">{r.title}</p>
              <p className="cx-msg-note">{dueWords(r.days_left)}</p>
              <div className="cx-msg-actions">
                <a className="cx-todo-act" href={r.href}>
                  Open card
                </a>
                <button type="button" className="cx-msg-link" disabled={busy === r.id} onClick={() => void act(r.id, { op: 'reminder.read', id: r.id })}>
                  Got it
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {inbox.length === 0 ? (
        reminders.length === 0 && notices.length === 0 && <p className="cx-msgs-empty">No new messages</p>
      ) : (
        <ul className="cx-todo-rows">
          {inbox.map((m) => (
            <li key={m.id} className="cx-msg">
              <p className="cx-msg-meta">
                <strong>{m.from_name}</strong>
                {m.acted_by_name && <span className="cx-by">by {first(m.acted_by_name)} for {first(m.from_name)}</span>}
                {KIND_TAG[m.kind] && <span className="cx-msg-tag">{KIND_TAG[m.kind]}</span>}
                <span className="cx-msg-time">{when(m.deliver_at, tz)}</span>
              </p>
              {m.parent && <p className="cx-msg-re">Re: {m.parent.body}</p>}
              <p className="cx-msg-body">{m.body}</p>
              {m.kind === 'request' && !m.replied_to_id && <p className="cx-msg-note">On your to-do list</p>}
              {replying === m.id ? (
                <form
                  className="cx-msg-reply"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (draft.trim()) void act(m.id, { op: 'reply', id: m.id, body: draft.trim() })
                  }}
                >
                  <textarea
                    autoFocus
                    rows={2}
                    value={draft}
                    placeholder={`Reply to ${first(m.from_name)}`}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        if (draft.trim()) void act(m.id, { op: 'reply', id: m.id, body: draft.trim() })
                      }
                      if (e.key === 'Escape') setReplying(null)
                    }}
                  />
                  <div className="cx-msg-actions">
                    <button type="submit" className="cx-todo-act cx-msg-send" disabled={busy === m.id || !draft.trim()}>
                      Send
                    </button>
                    <button type="button" className="cx-msg-link" onClick={() => setReplying(null)}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="cx-msg-actions">
                  {m.kind === 'note' ? (
                    <button type="button" className="cx-todo-act" disabled={busy === m.id} onClick={() => void act(m.id, { op: 'read', id: m.id })}>
                      Got it
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="cx-todo-act"
                      onClick={() => {
                        setReplying(m.id)
                        setDraft('')
                      }}
                    >
                      Reply
                    </button>
                  )}
                  {m.kind !== 'request' && (
                    <button type="button" className="cx-msg-link" disabled={busy === m.id} onClick={() => void act(m.id, { op: 'todo', id: m.id })}>
                      Add to my to-dos
                    </button>
                  )}
                  {m.kind !== 'note' && (
                    <button type="button" className="cx-msg-link" disabled={busy === m.id} onClick={() => void act(m.id, { op: 'read', id: m.id })}>
                      Mark read
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {err && <p className="cx-msgs-err">{err}</p>}

      {emailNeedReply !== null && emailNeedReply > 0 && (
        <a className="cx-msgs-email" href={emailHref}>
          Email · {emailNeedReply} {emailNeedReply === 1 ? 'needs' : 'need'} a reply <span aria-hidden>→</span>
        </a>
      )}

      {sent.length > 0 && (
        <details className="cx-todo-fold cx-msgs-sent">
          <summary>Sent ({sent.length})</summary>
          <ul className="cx-todo-rows">
            {sent.map((m) => {
              const pending = Date.parse(m.deliver_at) > Date.now()
              const status = pending ? `Shows ${when(m.deliver_at, tz)}` : m.read_at ? (m.kind === 'note' ? 'Seen' : 'Read') : 'Not read yet'
              return (
                <li key={m.id} className="cx-msg is-sent">
                  <p className="cx-msg-meta">
                    <span>To {first(m.to_name)}</span>
                    {m.acted_by_name && <span className="cx-by">by {first(m.acted_by_name)} for {first(m.from_name)}</span>}
                    <span className="cx-msg-time">{when(m.created_at, tz)}</span>
                    <span className={m.read_at ? 'cx-msg-read' : 'cx-msg-unread'}>{status}</span>
                  </p>
                  <p className="cx-msg-body">{m.body}</p>
                  {m.replies.map((r) => (
                    <div key={r.id} className="cx-msg-thread">
                      <p className="cx-msg-meta">
                        <strong>{first(r.from_name)}</strong>
                        {r.acted_by_name && <span className="cx-by">by {first(r.acted_by_name)} for {first(r.from_name)}</span>}
                        <span className="cx-msg-time">{when(r.created_at, tz)}</span>
                      </p>
                      <p className="cx-msg-body">{r.body}</p>
                    </div>
                  ))}
                </li>
              )
            })}
          </ul>
        </details>
      )}
      {data.members.length > 0 && (
        <p className="cx-msgs-hint">
          Ask Mira: &ldquo;Tell {first(data.members[0].display_name || data.members[0].email || 'Dana')} to &hellip;&rdquo;
        </p>
      )}
    </section>
  )
}
