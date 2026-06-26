'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Msg = { role: 'user' | 'assistant'; text: string }

const SUGGESTIONS = [
  'Which deposits are still unmatched?',
  'What commission is still owed, by agent?',
  'Summarize money in vs money out this month',
  'Any deposits that don’t line up with commissions?',
]

/**
 * AI subagent over the payroll data — Lauren asks questions, it answers from her
 * commissions/deposits/sheets and flags issues. Read-only advisory for now.
 */
export default function PayrollAssistant() {
  const router = useRouter()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  async function ask(q: string) {
    const question = q.trim()
    if (!question || busy) return
    setMsgs((m) => [...m, { role: 'user', text: question }])
    setInput('')
    setBusy(true)
    try {
      const res = await fetch('/api/payroll/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const json = (await res.json().catch(() => ({}))) as { answer?: string; error?: string; didMutate?: boolean }
      setMsgs((m) => [...m, { role: 'assistant', text: json.answer || `Sorry — ${json.error ?? 'something went wrong'}.` }])
      // If it changed data (added/marked paid), refresh so the other tabs reflect it.
      if (json.didMutate) router.refresh()
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', text: 'Network error — try again.' }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card" style={{ marginTop: '0.4rem' }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>Payroll assistant</h2>
      <p className="meta" style={{ margin: '0.2rem 0 0.7rem', fontSize: '0.82rem' }}>
        Ask about your commissions, deposits, and what’s owed. It reads your data and flags what looks off.
      </p>

      {msgs.length === 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.7rem' }}>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="btn" onClick={() => ask(s)} disabled={busy} style={{ fontSize: '0.76rem' }}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', maxHeight: 420, overflowY: 'auto' }}>
        {msgs.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              background: m.role === 'user' ? 'var(--ink)' : 'var(--paper-2, #f1efe9)',
              color: m.role === 'user' ? 'var(--text-inv, #fff)' : 'var(--text)',
              borderRadius: 12,
              padding: '0.6rem 0.85rem',
              fontSize: '0.88rem',
              lineHeight: 1.55,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.text}
          </div>
        ))}
        {busy && <div className="meta" style={{ fontSize: '0.8rem' }}>Thinking…</div>}
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.7rem' }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') ask(input) }}
          placeholder="Ask about your commissions, deposits, who’s owed…"
          style={{ flex: 1 }}
          disabled={busy}
        />
        <button className="btn approve" onClick={() => ask(input)} disabled={busy || !input.trim()}>Ask</button>
      </div>
    </section>
  )
}
