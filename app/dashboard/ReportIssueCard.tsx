'use client'

import { useState } from 'react'

/**
 * "Request a change / report an issue" — an always-available box on the
 * dashboard for Spencer and Lauren to flag anything that needs a code fix or
 * isn't working right. Goes to fix_requests and lands in the developer's daily
 * digest email. Distinct from the AI feedback loops: this is for things the
 * assistant can't fix itself.
 */
export default function ReportIssueCard() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [severity, setSeverity] = useState<'low' | 'normal' | 'high'>('normal')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/feedback/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, severity }),
    })
    setBusy(false)
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
    if (json.ok) {
      setDone(true)
      setText('')
    } else {
      setError(json.error ?? 'Could not send — try again.')
    }
  }

  return (
    <section
      className="card"
      style={{ marginTop: '1rem', padding: '0.9rem 1.1rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
        <div>
          <strong style={{ fontSize: 14 }}>Request a change / report an issue</strong>
          <p className="meta" style={{ margin: '0.15rem 0 0', fontSize: '0.78rem' }}>
            Something broken or working wrong? Tell us — it goes straight to the team to fix.
          </p>
        </div>
        {!open && !done && (
          <button className="btn approve" onClick={() => setOpen(true)}>Open</button>
        )}
      </div>

      {done ? (
        <p
          className="meta"
          style={{ margin: '0.7rem 0 0', fontSize: '0.82rem', color: 'var(--signal-ok, #16a34a)' }}
        >
          ✓ Logged — it’ll be in the team’s daily fix digest. Thank you.
          <button
            className="btn"
            style={{ marginLeft: '0.6rem', fontSize: '0.74rem', padding: '0.2rem 0.5rem' }}
            onClick={() => { setDone(false); setOpen(true) }}
          >
            Report another
          </button>
        </p>
      ) : open ? (
        <div style={{ display: 'grid', gap: '0.45rem', marginTop: '0.7rem' }}>
          <textarea
            placeholder="What’s wrong, or how do you want it to work? Be as specific as you like — there’s no length limit."
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            autoFocus
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="meta" style={{ fontSize: '0.76rem' }}>
              Priority:{' '}
              <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High — blocking</option>
              </select>
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
            <button className="btn approve" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? 'Sending…' : 'Send to team'}
            </button>
          </div>
          {error && (
            <p className="meta" style={{ color: 'var(--red)', fontSize: '0.78rem', margin: 0 }}>{error}</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
