'use client'

/**
 * Team page: "Who is writing · last 60 days". Every agent the book shows
 * writing in the last 120 days, split by the last 60 days against the 60
 * before: Writing more, Steady, Slipping. Each row hands Mira a draft.
 * Real data only: two agent breakdowns from /api/pinnacle/breakdown, ended
 * at the day the book has data through (so a late sync never reads as a slip).
 */
import { useEffect, useMemo, useState } from 'react'
import type { BreakdownRow } from '@/lib/pinnacle/rollup'
import { fmtCount, fmtMoney } from '@/lib/pinnacle/kpis'
import { classifyWriting, shiftIso, type WritingBand, type WritingRow } from '@/lib/pinnacle/writing'

const LIMIT = 200

async function load(start: string, end: string): Promise<BreakdownRow[] | null> {
  const r = await fetch(`/api/pinnacle/breakdown?dim=agent&line=All&start=${start}&end=${end}&limit=${LIMIT}`, { cache: 'no-store' })
  if (!r.ok) return null
  const j = (await r.json()) as { rows?: BreakdownRow[]; unavailable?: boolean }
  return j.unavailable ? null : j.rows ?? []
}

const BAND_WORDS: Record<WritingBand, string> = { more: 'Writing more', steady: 'Steady', slipping: 'Slipping' }

function miraText(r: WritingRow): string {
  const facts = `${fmtCount(r.recent)} policies (${fmtMoney(r.recentPremium)}) in the last 60 days vs ${fmtCount(r.prior)} the 60 days before`
  const who = `${r.name}${r.team ? ` (${r.team})` : ''}`
  if (r.band === 'slipping') return `Draft a check-in to ${r.team ? `${r.team}'s` : 'their'} upline about ${who}: ${facts}. Ask what changed and how we can help.`
  if (r.band === 'more') return `Draft a short note recognising ${who}: ${facts}. Ask their upline what is working so other agents can copy it.`
  return `What should I know about ${who}? ${facts}.`
}

export default function TeamWriting({ through }: { through: string | null }) {
  const [rows, setRows] = useState<WritingRow[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [band, setBand] = useState<WritingBand>('slipping')
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    if (!through) return
    let cancelled = false
    const recentStart = shiftIso(through, -59)
    const priorEnd = shiftIso(through, -60)
    const priorStart = shiftIso(through, -119)
    Promise.all([load(recentStart, through), load(priorStart, priorEnd)])
      .then(([recent, prior]) => {
        if (cancelled) return
        if (!recent || !prior) setFailed(true)
        else setRows(classifyWriting(recent, prior))
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [through])

  const counts = useMemo(() => {
    const c: Record<WritingBand, number> = { more: 0, steady: 0, slipping: 0 }
    for (const r of rows ?? []) c[r.band]++
    return c
  }, [rows])

  if (!through) return null
  const list = (rows ?? []).filter((r) => r.band === band)
  const shown = showAll ? list : list.slice(0, 10)

  return (
    <section className="cx-panel">
      <div className="cx-retention-head" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div className="cx-eyebrow">Who is writing · last 60 days</div>
        <span className="cx-seg" role="group" aria-label="Writing trend">
          {(['more', 'steady', 'slipping'] as WritingBand[]).map((b) => (
            <button key={b} type="button" aria-pressed={band === b} onClick={() => { setBand(b); setShowAll(false) }}>
              {BAND_WORDS[b]}{rows ? ` · ${fmtCount(counts[b])}` : ''}
            </button>
          ))}
        </span>
      </div>
      {failed ? (
        <p className="cx-takeaway">The agent list could not be read just now. Refresh in a minute.</p>
      ) : rows === null ? (
        <p className="cx-kpi-sub" style={{ marginTop: 12 }}>Loading…</p>
      ) : list.length === 0 ? (
        <p className="cx-takeaway">No agents are {BAND_WORDS[band].toLowerCase()} right now.</p>
      ) : (
        <>
          <table className="cx-table cx-approach">
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: 'left' }}>Agent</th>
                <th scope="col">Last 60 days</th>
                <th scope="col">60 before</th>
                <th scope="col"><span className="cx-visually-hidden">Action</span></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.name}>
                  <th scope="row" style={{ textAlign: 'left' }}>
                    <div className="cx-approach-name">{r.name}</div>
                    <div className="cx-approach-team">{r.team || 'No agency'} · {fmtMoney(r.recentPremium)} submitted</div>
                  </th>
                  <td>{fmtCount(r.recent)}</td>
                  <td>{fmtCount(r.prior)}</td>
                  <td>
                    <button
                      type="button"
                      className="cx-btn cx-btn-ghost cx-btn-sm"
                      onClick={() => window.dispatchEvent(new CustomEvent('mira:focus', { detail: { text: miraText(r) } }))}
                    >
                      Ask Mira
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > 10 && (
            <button type="button" className="cx-link-quiet" style={{ marginTop: 10 }} onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show fewer' : `Show all ${fmtCount(list.length)}`}
            </button>
          )}
        </>
      )}
      <div className="cx-scope">
        Policies written, last 60 days vs the 60 before, through {through} · writing more = up at least 2 policies and 25% · slipping = down at least 2 and 25% · top {LIMIT} agents by premium in each window
      </div>
    </section>
  )
}
