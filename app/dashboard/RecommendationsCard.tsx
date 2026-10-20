'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Chip, CountStrip, WhyDetails, splitHeadline } from '@/app/components/cxo/report-kit'

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
        <span className="meta" style={{ fontSize: '0.72rem' }}>from live signals</span>
      </div>
      <div style={{ marginTop: '0.55rem' }}>
        <CountStrip
          testId="recs-strip"
          count={recs.length}
          unit="open"
          chips={(['high', 'normal', 'low'] as const)
            .map((p) => ({ key: p, color: PRIORITY_COLOR[p], n: recs.filter((r) => r.priority === p).length }))
            .filter((c) => c.n > 0)
            .map((c) => ({ key: c.key, color: c.color, label: `${c.n} ${c.key}` }))}
        />
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
  const detail = splitHeadline(rec.detail ?? '', 170)

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <p className="name" style={{ margin: 0, fontSize: '0.9rem' }}>{rec.title}</p>
            {rec.kind && <Chip>{rec.kind.replace(/_/g, ' ')}</Chip>}
          </div>
          {detail.line && <p className="meta" style={{ margin: '0.15rem 0 0', fontSize: '0.8rem' }}>{detail.line}</p>}
          {(detail.why || rec.reasoning) && (
            <WhyDetails testId="rec-why">
              {detail.why && <p style={{ margin: 0 }}>{detail.why}</p>}
              {rec.reasoning && <p style={{ margin: detail.why ? '0.3rem 0 0' : 0 }}>{rec.reasoning}</p>}
            </WhyDetails>
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
