'use client'

import { useState } from 'react'

/**
 * Feedback-first: Lauren shapes this workstation as she uses it. Anything she
 * types here ("I'd rather…", "this should…", "what I actually do is…") goes to
 * the team's daily digest + the learning loop, tagged `payroll`, so we tune the
 * page to her real workflow over the first couple weeks.
 */
export default function PayrollFeedback() {
  const [text, setText] = useState('')
  const [severity, setSeverity] = useState<'low' | 'normal' | 'high'>('normal')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function submit() {
    const body = text.trim()
    if (!body) return
    setBusy(true)
    const res = await fetch('/api/feedback/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, area: 'payroll', severity }),
    })
    setBusy(false)
    if (res.ok) { setDone(true); setText('') }
  }

  return (
    <section className="card" style={{ marginTop: '1rem', borderTop: '3px solid var(--signal-info, #2563eb)' }}>
      <strong style={{ fontSize: 14 }}>Make this work the way you do</strong>
      <p className="meta" style={{ margin: '0.2rem 0 0.6rem', fontSize: '0.82rem' }}>
        This is your workstation — tell us what to change, what’s missing, or exactly how you run payroll today.
        We read this every day and tune it to you.
      </p>
      {done ? (
        <p className="meta" style={{ fontSize: '0.84rem', color: 'var(--signal-ok, #16a34a)' }}>
          ✓ Got it — thank you. Keep them coming.
          <button
            className="btn"
            style={{ marginLeft: '0.6rem', fontSize: '0.74rem', padding: '0.2rem 0.5rem' }}
            onClick={() => setDone(false)}
          >
            Add another
          </button>
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '0.45rem' }}>
          <textarea
            placeholder="e.g. “I match deposits by carrier + date — can the deposit row show which sales it covers?” or “I’d rather enter commission as a % of premium.”"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
          />
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="meta" style={{ fontSize: '0.76rem' }}>
              Priority:{' '}
              <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof severity)}>
                <option value="low">Nice to have</option>
                <option value="normal">Normal</option>
                <option value="high">Blocking me</option>
              </select>
            </label>
            <span style={{ flex: 1 }} />
            <button className="btn approve" onClick={submit} disabled={busy || !text.trim()}>
              {busy ? 'Sending…' : 'Send to team'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
