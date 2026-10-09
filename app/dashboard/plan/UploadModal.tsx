'use client'

import { useMemo, useRef, useState } from 'react'
import { fmtMoney } from '@/lib/pinnacle/kpis'
import { MONTHS } from '@/lib/plan/shared'
import { spreadOf } from '@/lib/plan/comp'
import { applyReview, draftSummary, type Choices, type Draft, type Review, type UploadKind } from '@/lib/plan/importShared'

/**
 * Upload → review → Save, for the plan and for comp grids. Any layout: the
 * server reads it (by rule, or with Claude for messy sheets and PDFs) and
 * nothing is saved until the review is done and Save is pressed.
 */
export default function UploadModal({ kind, year, hasExisting, onClose, onDone }: { kind: UploadKind; year: number; hasExisting: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [step, setStep] = useState<'pick' | 'reading' | 'review'>('pick')
  const [link, setLink] = useState('')
  const [readingName, setReadingName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [choices, setChoices] = useState<Choices>({})
  const [keepTyped, setKeepTyped] = useState<string[]>([])
  const [replace, setReplace] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const what = kind === 'plan' ? `the ${year} plan` : 'a comp grid'

  const read = async (body: FormData | Record<string, unknown>, name: string) => {
    setErr(null)
    setReadingName(name)
    setStep('reading')
    const isForm = body instanceof FormData
    const res = await fetch('/api/plan/upload', {
      method: 'POST',
      ...(isForm ? { body } : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    if (!res || !res.ok || !json.draft) {
      setErr(json.error || "That file couldn't be read. Try again.")
      setStep('pick')
      return
    }
    const r = json.review as Review
    const d = json.draft as Draft
    // Safe defaults for the clear cases; everything else waits for a decision.
    const pre: Choices = {}
    for (const is of r.issues) if (is.type === 'no_payout' || is.type === 'negative_spread') pre[is.id] = 'keep'
    setDraft(d)
    setReview(r)
    setChoices(pre)
    setKeepTyped([])
    setStep('review')
  }

  const onFile = (f: File | undefined) => {
    if (!f) return
    if (f.size > 4 * 1024 * 1024) {
      setErr('That file is over 4MB. Save just the sheet you need, or as CSV.')
      return
    }
    const fd = new FormData()
    fd.set('file', f)
    fd.set('kind', kind)
    fd.set('year', String(year))
    void read(fd, f.name)
  }

  const applied = useMemo(() => (draft && review ? applyReview(draft, review, choices, keepTyped) : null), [draft, review, choices, keepTyped])
  const open = review ? review.issues.filter((is) => !choices[is.id]).length : 0

  const save = async () => {
    if (!draft || !applied || open > 0) return
    setBusy(true)
    setErr(null)
    const body: Record<string, unknown> = { action: 'save', kind, year, replace, filename: draft.filename, source: draft.source, readBy: draft.readBy, costUsd: draft.costUsd }
    if (applied.kind === 'plan') body.targets = applied.targets
    else body.rates = applied.rates
    const res = await fetch('/api/plan/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null)
    const json = res ? await res.json().catch(() => ({})) : {}
    setBusy(false)
    if (!res || !res.ok) {
      setErr(json.error || 'Could not save. Try again.')
      return
    }
    onDone(kind === 'plan' ? `Saved ${json.saved} plan ${json.saved === 1 ? 'cell' : 'cells'} from ${draft.filename}.` : `Saved ${json.saved} comp ${json.saved === 1 ? 'rate' : 'rates'} from ${draft.filename}.`)
  }

  const sum = draft ? draftSummary(draft) : null

  return (
    <div className="cx-dialog-scrim cxp-modal-scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="cx-dialog cxp-modal cxu" role="dialog" aria-modal="true" aria-labelledby="cxu-title">
        <h2 id="cxu-title">{step === 'review' ? 'Check what was read' : kind === 'plan' ? `Upload the ${year} plan` : 'Upload a comp grid'}</h2>

        {step === 'pick' && (
          <>
            <div className="cx-dialog-body">
              {kind === 'plan'
                ? 'Any layout works: months across or down, one tab or several, totals included. You check what was read before anything is saved.'
                : 'Your carrier contract levels and agent payout levels, by carrier and product, in any layout. You check what was read before anything is saved.'}
            </div>
            <button type="button" className="cxu-drop" onClick={() => fileRef.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onFile(e.dataTransfer.files?.[0]) }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
              <b>Choose a file</b>
              <span>XLSX, XLS, CSV or PDF, up to 4MB</span>
            </button>
            <input ref={fileRef} type="file" hidden accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
            <form className="cxu-link" onSubmit={(e) => { e.preventDefault(); if (link.trim()) void read({ action: 'parse', kind, year, link: link.trim() }, 'Google Sheet') }}>
              <label className="cxp-field">
                Or paste a Google Sheets link
                <input type="url" inputMode="url" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
              </label>
              <button type="submit" className="cx-btn cx-btn-ghost cx-btn-sm" disabled={!link.trim()}>Read link</button>
            </form>
            {err && <p className="cxu-problem" role="alert">{err}</p>}
            <footer>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" onClick={onClose}>Cancel</button>
            </footer>
          </>
        )}

        {step === 'reading' && (
          <div className="cxu-reading" aria-live="polite">
            <span className="cxu-spin" aria-hidden />
            <div>
              <b>Reading {readingName}…</b>
              <p className="cxp-note">Tidy sheets take a second. A PDF or an unusual layout is read by AI and can take up to a minute.</p>
            </div>
          </div>
        )}

        {step === 'review' && draft && review && sum && applied && (
          <>
            <p className="cxu-found">
              <b>{draft.filename}</b>: {sum.rows} {sum.rows === 1 ? 'row' : 'rows'}, {sum.carriers} {sum.carriers === 1 ? 'carrier' : 'carriers'}, {sum.products} {sum.products === 1 ? 'product' : 'products'}
              {sum.premium != null ? `, ${fmtMoney(sum.premium)} premium` : ''}.
              <span className="cxp-note" style={{ display: 'block' }}>
                {draft.readBy === 'claude' ? `Read by AI (cost about $${draft.costUsd.toFixed(2)}).` : 'Read directly from the sheet.'}
                {draft.notes.length ? ` ${draft.notes.join(' ')}` : ''}
              </span>
            </p>

            {review.matched.length > 0 && (
              <section>
                <h3>Matched to names you already use</h3>
                <ul className="cxu-list">
                  {review.matched.map((m) => {
                    const key = `${m.field}:${m.raw}`
                    const kept = keepTyped.includes(key)
                    return (
                      <li key={key}>
                        <span className="cxu-txt">
                          <span className="cxu-raw">{m.raw}</span> <span aria-hidden>→</span> <b>{kept ? m.raw : m.to}</b>
                          <small> {m.field}, {m.rows} {m.rows === 1 ? 'row' : 'rows'}</small>
                        </span>
                        <button type="button" className="cxu-chip" aria-pressed={kept} onClick={() => setKeepTyped((k) => (kept ? k.filter((x) => x !== key) : [...k, key]))}>
                          {kept ? 'Use the match' : 'Keep as typed'}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}

            <section>
              <h3>{review.issues.length === 0 ? 'Nothing needs fixing' : `Needs a decision (${review.issues.length - open} of ${review.issues.length} done)`}</h3>
              {review.issues.length > 0 && (
                <ul className="cxu-issues">
                  {review.issues.map((is) => {
                    const ch = choices[is.id]
                    return (
                      <li key={is.id} className={ch ? 'is-done' : undefined}>
                        <div className="cxu-txt">
                          <b>{is.title}</b>
                          <small>{is.detail}</small>
                        </div>
                        <div className="cxu-fixes" role="group" aria-label={`Fix: ${is.title}`}>
                          {is.fixes.map((f) => (
                            <button key={f.id} type="button" className="cxu-chip" aria-pressed={ch === f.id} onClick={() => setChoices((c) => ({ ...c, [is.id]: f.id }))}>
                              {f.label}
                            </button>
                          ))}
                          <button type="button" className="cxu-chip is-skip" aria-pressed={ch === 'skip'} onClick={() => setChoices((c) => ({ ...c, [is.id]: 'skip' }))}>
                            {is.skipLabel}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {review.issues.length > 1 && open > 0 && (
                <p className="cxp-note">
                  <button type="button" className="cxu-link-btn" onClick={() => setChoices((c) => { const n = { ...c }; for (const is of review.issues) if (!n[is.id]) n[is.id] = is.fixes[0]?.id ?? 'skip'; return n })}>
                    Use the first fix for the rest
                  </button>
                </p>
              )}
            </section>

            <section>
              <h3>What will be saved</h3>
              {applied.kind === 'plan' ? <PlanPreview targets={applied.targets} /> : <CompPreview rates={applied.rates} />}
              {applied.skippedRows > 0 && <p className="cxp-note">{applied.skippedRows} {applied.skippedRows === 1 ? 'row' : 'rows'} left out by your choices.</p>}
            </section>

            {hasExisting && (
              <label className="cxp-check" style={{ marginTop: 12 }}>
                <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                {kind === 'plan' ? `Replace the whole ${year} plan (otherwise these rows update or add to it)` : 'Replace every comp rate on file (otherwise these update or add to them)'}
              </label>
            )}
            {err && <p className="cxu-problem" role="alert">{err}</p>}
            <footer>
              <button type="button" className="cx-btn cx-btn-ghost cx-btn-sm" disabled={busy} onClick={() => { setStep('pick'); setDraft(null); setReview(null) }}>Upload a different file</button>
              <button type="button" className="cx-btn cx-btn-sm" disabled={busy || open > 0 || (applied.kind === 'plan' ? applied.targets.length === 0 : applied.rates.length === 0)} onClick={save}>
                {busy ? 'Saving…' : open > 0 ? `Decide ${open} more to save` : `Save ${what}`}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}

function PlanPreview({ targets }: { targets: Array<{ month: number; product: string; carrier: string; premium: number }> }) {
  const rows = useMemo(() => {
    const m = new Map<string, { product: string; carrier: string; months: number[] }>()
    for (const t of targets) {
      const k = `${t.product}\u0000${t.carrier}`
      const r = m.get(k) ?? { product: t.product, carrier: t.carrier, months: new Array(12).fill(0) }
      r.months[t.month - 1] += t.premium
      m.set(k, r)
    }
    return Array.from(m.values()).sort((a, b) => b.months.reduce((x, y) => x + y, 0) - a.months.reduce((x, y) => x + y, 0))
  }, [targets])
  const total = targets.reduce((s, t) => s + t.premium, 0)
  const shown = rows.slice(0, 8)
  return (
    <>
      <ul className="cxu-list">
        {shown.map((r) => {
          const filled = r.months.map((v, i) => (v ? MONTHS[i] : null)).filter(Boolean)
          return (
            <li key={`${r.product}-${r.carrier}`}>
              <span className="cxu-txt">
                <b>{[r.product, r.carrier].filter(Boolean).join(' · ')}</b>
                <small>{filled.length === 12 ? 'Every month' : filled.length ? filled.join(', ') : 'No premium'}</small>
              </span>
              <span className="cxu-num">{fmtMoney(r.months.reduce((x, y) => x + y, 0))}</span>
            </li>
          )
        })}
      </ul>
      <p className="cxp-note">
        {rows.length > shown.length ? `And ${rows.length - shown.length} more. ` : ''}
        {rows.length} {rows.length === 1 ? 'line' : 'lines'}, {fmtMoney(total)} premium for the year.
      </p>
    </>
  )
}

function CompPreview({ rates }: { rates: Array<{ product: string; carrier: string; agency_rate: number; payout_rate: number | null; agent_levels: Array<{ level: string; rate: number }> }> }) {
  const shown = rates.slice(0, 8)
  const pct = (n: number) => `${Math.round(n * 100) / 100}%`
  return (
    <>
      <ul className="cxu-list">
        {shown.map((r) => {
          const s = spreadOf(r)
          const top = r.agent_levels.length ? Math.max(...r.agent_levels.map((l) => l.rate)) : null
          return (
            <li key={`${r.carrier}-${r.product}`}>
              <span className="cxu-txt">
                <b>{[r.carrier, r.product].filter(Boolean).join(' · ')}</b>
                <small>Agency {pct(r.agency_rate)}{top != null ? `, top agent level ${pct(top)}` : ', no agent levels'}{r.agent_levels.length > 1 ? ` (${r.agent_levels.length} levels)` : ''}</small>
              </span>
              <span className="cxu-num">{s == null ? '—' : `${pct(s)} spread`}</span>
            </li>
          )
        })}
      </ul>
      <p className="cxp-note">{rates.length > shown.length ? `And ${rates.length - shown.length} more. ` : ''}{rates.length} {rates.length === 1 ? 'rate' : 'rates'} in all.</p>
    </>
  )
}
