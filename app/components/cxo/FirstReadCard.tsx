'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAssistantName } from '@/app/components/AssistantNameProvider'
import { askCiao } from '@/lib/followups/noticeActionsShared'
import type { FirstReadSummary } from '@/lib/firstRead/shared'

type Read = { id: string; accountId: string; email: string | null; status: 'pending' | 'done' | 'error'; summary: FirstReadSummary | null; error: string | null }

const POLL_MS = 4000
const POLL_MAX = 45

/**
 * "<Assistant>'s first read" (Suite CXO). After Google is connected the
 * assistant reads the account once (lib/firstRead) and this card shows what it
 * learned: the people they meet and write to most, recurring meetings,
 * upcoming double-bookings, emails waiting on their reply, and a few things it
 * can do this week. Every line comes from their own calendar and inbox
 * headers; nothing is guessed. Run again re-reads; the x hides it for good.
 */
export default function FirstReadCard() {
  const name = useAssistantName()
  const [reads, setReads] = useState<Read[] | null>(null)
  const [busy, setBusy] = useState(false)
  const polls = useRef(0)

  const load = useCallback(async () => {
    const r = await fetch('/api/me/first-read').catch(() => null)
    if (!r?.ok) return
    const j = (await r.json().catch(() => null)) as { reads?: Read[] } | null
    setReads(j?.reads ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const pending = !!reads?.some((r) => r.status === 'pending')
  useEffect(() => {
    if (!pending || polls.current >= POLL_MAX) return
    const t = setTimeout(() => {
      polls.current++
      void load()
    }, POLL_MS)
    return () => clearTimeout(t)
  }, [pending, reads, load])

  async function runAgain(accountId: string) {
    setBusy(true)
    polls.current = 0
    try {
      const r = await fetch('/api/me/first-read', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accountId }) })
      const j = (await r.json().catch(() => null)) as { reads?: Read[] } | null
      if (j?.reads) setReads(j.reads)
    } finally {
      setBusy(false)
    }
  }

  async function dismiss(id: string) {
    setReads((cur) => (cur ?? []).filter((r) => r.id !== id))
    await fetch('/api/me/first-read', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, dismiss: true }) }).catch(() => {})
  }

  if (!reads || reads.length === 0) return null

  return (
    <>
      {reads.map((r) => (
        <section key={r.id} className="cx-panel cx-first-read" aria-labelledby={`first-read-${r.id}`}>
          <div className="cxp-head">
            <h2 id={`first-read-${r.id}`}>{name}&rsquo;s first read</h2>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              {r.status !== 'pending' && (
                <button type="button" className="cx-todo-act" disabled={busy} onClick={() => void runAgain(r.accountId)}>
                  Run again
                </button>
              )}
              <button type="button" className="cx-todo-act" aria-label="Hide this card" title="Hide this card" onClick={() => void dismiss(r.id)}>
                ×
              </button>
            </span>
          </div>
          {r.email && (
            <p className="cx-msg-note" style={{ marginTop: 0 }}>
              {r.email}
            </p>
          )}
          {r.status === 'pending' && (
            <p className="cx-msg-note" role="status">
              {name} is reading your calendar…
            </p>
          )}
          {r.status === 'error' && (
            <p className="cx-msg-note" role="status">
              {name} could not read this account just now.{' '}
              <button type="button" className="cx-link-btn" style={linkBtn} disabled={busy} onClick={() => void runAgain(r.accountId)}>
                Run again
              </button>
            </p>
          )}
          {r.status === 'done' && r.summary && <Summary s={r.summary} name={name} />}
        </section>
      ))}
    </>
  )
}

const linkBtn: React.CSSProperties = { background: 'none', border: 0, padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }

function Summary({ s, name }: { s: FirstReadSummary; name: string }) {
  const tz = s.timezone || 'America/New_York'
  const when = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))
  const clock = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso)).replace(' ', '').toLowerCase()
  const ago = (iso: string) => {
    const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
  }
  const read = [
    `${s.calendars.length} ${s.calendars.length === 1 ? 'calendar' : 'calendars'}, two weeks back and two ahead`,
    s.inbox.read ? `${s.inbox.messages} recent ${s.inbox.messages === 1 ? 'email' : 'emails'} (senders and subjects only)` : null,
  ].filter(Boolean)
  const nothing = !s.people.length && !s.recurring.length && !s.conflicts.length && !s.waiting.length

  return (
    <div className="cx-first-read-body" style={{ display: 'grid', gap: 14, marginTop: 8 }}>
      <p className="cx-msg-note" style={{ margin: 0 }}>
        I read {read.join(' and ')}: {s.meetings.past} {s.meetings.past === 1 ? 'meeting' : 'meetings'} in the last two weeks, {s.meetings.upcoming} coming up.
      </p>

      {nothing && <p className="cx-msg-note" style={{ margin: 0 }}>Not much to go on yet. As your calendar fills, ask me and I will look again.</p>}

      {s.conflicts.length > 0 && (
        <Block title="Double-booked">
          {s.conflicts.map((c) => (
            <li key={c.id}>
              <Link href={`/dashboard/calendar?view=day&date=${c.day}`}>
                {when(c.b.start)}: &ldquo;{c.a.title}&rdquo; ({clock(c.a.start)} to {clock(c.a.end)}) overlaps &ldquo;{c.b.title}&rdquo;
              </Link>
            </li>
          ))}
        </Block>
      )}

      {s.waiting.length > 0 && (
        <Block title="Waiting on your reply">
          {s.waiting.map((w) => (
            <li key={w.id}>
              <b>{w.from}</b>: {w.subject} <span className="cx-msg-note" style={{ display: 'inline', margin: 0 }}>· {ago(w.at)}</span>
            </li>
          ))}
        </Block>
      )}

      {s.people.length > 0 && (
        <Block title="Who you spend time with">
          {s.people.map((p) => (
            <li key={p.email}>
              <b>{p.name}</b>{' '}
              <span className="cx-msg-note" style={{ display: 'inline', margin: 0 }}>
                · {[p.meetings ? `${p.meetings} ${p.meetings === 1 ? 'meeting' : 'meetings'}` : null, p.emails ? `${p.emails} ${p.emails === 1 ? 'email' : 'emails'}` : null].filter(Boolean).join(', ')}
              </span>
            </li>
          ))}
        </Block>
      )}

      {s.recurring.length > 0 && (
        <Block title="Recurring meetings">
          {s.recurring.map((m) => (
            <li key={m.title}>
              {m.title}{' '}
              <span className="cx-msg-note" style={{ display: 'inline', margin: 0 }}>
                · {m.count} times in four weeks{m.next ? `, next ${when(m.next)}` : ''}
              </span>
            </li>
          ))}
        </Block>
      )}

      {s.suggestions.length > 0 && (
        <Block title={`How ${name} can help this week`}>
          {s.suggestions.map((g) => (
            <li key={g.text} style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <span>{g.text}</span>
              <button type="button" className="cx-todo-act" onClick={() => askCiao(g.text)}>
                Ask {name}
              </button>
            </li>
          ))}
        </Block>
      )}
    </div>
  )
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{title}</h3>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 4, fontSize: 14 }}>{children}</ul>
    </div>
  )
}
