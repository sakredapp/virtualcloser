'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export type RecommendationLite = {
  id: string
  kind: string
  title: string
  detail: string | null
  reasoning: string | null
  priority: 'low' | 'normal' | 'high'
}

const PRIORITY_COLOR: Record<RecommendationLite['priority'], string> = {
  high: 'var(--red-deep, #dc2626)',
  normal: 'var(--signal-info, #2563eb)',
  low: 'var(--muted)',
}

/**
 * Proactive recommendations from the overseer — live business-signal nudges
 * (quiet deals, draft backlog, unanswered threads) the exec can act on or
 * dismiss. Dismiss-with-reason trains the overseer to stop suggesting it.
 */
export default function RecommendationsCard({ recommendations }: { recommendations: RecommendationLite[] }) {
  const [recs, setRecs] = useState(recommendations)
  if (recs.length === 0) return null

  return (
    <section className="card" style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
        <strong style={{ fontSize: 14 }}>Recommendations</strong>
        <span className="meta" style={{ fontSize: '0.72rem' }}>{recs.length} open · from live signals</span>
      </div>
      <div style={{ marginTop: '0.6rem', border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
        {recs.map((r) => (
          <RecRow key={r.id} rec={r} onDone={(id) => setRecs((rs) => rs.filter((x) => x.id !== id))} />
        ))}
      </div>
    </section>
  )
}

function RecRow({ rec, onDone }: { rec: RecommendationLite; onDone: (id: string) => void }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [dismissing, setDismissing] = useState(false)
  const [reason, setReason] = useState('')

  async function send(action: 'act' | 'dismiss') {
    setBusy(true)
    const res = await fetch(`/api/recommendations/${rec.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reason: action === 'dismiss' ? reason.trim() : undefined }),
    })
    setBusy(false)
    if (res.ok) {
      onDone(rec.id)
      router.refresh()
    }
  }

  return (
    <div style={{ padding: '0.6rem 0.8rem', borderTop: '1px solid var(--border-soft)' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start' }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: PRIORITY_COLOR[rec.priority], flexShrink: 0, marginTop: '0.5em' }} />
        <div style={{ flex: 1 }}>
          <p className="name" style={{ margin: 0, fontSize: '0.9rem' }}>{rec.title}</p>
          {rec.detail && <p className="meta" style={{ margin: '0.15rem 0 0', fontSize: '0.8rem' }}>{rec.detail}</p>}
          {rec.reasoning && (
            <p className="meta" style={{ margin: '0.2rem 0 0', fontSize: '0.74rem', fontStyle: 'italic' }}>
              Why: {rec.reasoning}
            </p>
          )}
        </div>
      </div>

      {dismissing ? (
        <div style={{ display: 'grid', gap: '0.35rem', marginTop: '0.45rem' }}>
          <input
            type="text"
            placeholder="Why dismiss? (optional — trains the assistant)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            autoFocus
          />
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <button className="btn" onClick={() => send('dismiss')} disabled={busy}>
              {busy ? 'Dismissing…' : reason.trim() ? 'Dismiss & teach' : 'Dismiss'}
            </button>
            <button className="btn" onClick={() => setDismissing(false)} disabled={busy}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.45rem' }}>
          <button className="btn approve" onClick={() => send('act')} disabled={busy}>Mark done</button>
          <button className="btn" onClick={() => setDismissing(true)} disabled={busy}>Dismiss</button>
        </div>
      )}
    </div>
  )
}
