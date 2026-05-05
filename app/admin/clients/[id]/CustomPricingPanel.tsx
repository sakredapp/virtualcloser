'use client'

// Admin-only panel for per-client pricing overrides and sending a custom
// build-fee checkout link. Lives on the client detail page.

import { useState } from 'react'

type Props = {
  repId: string
  clientEmail: string | null
  initialOverrides: {
    monthly_flat_cents?: number
    sdr_hourly_cents?: number
  }
}

export default function CustomPricingPanel({ repId, clientEmail, initialOverrides }: Props) {
  // ── Build-fee link state ─────────────────────────────────────────────
  const [feeAmount, setFeeAmount] = useState('')
  const [feeNote, setFeeNote] = useState('')
  const [feeBusy, setFeeBusy] = useState(false)
  const [feeResult, setFeeResult] = useState<{ ok: boolean; url?: string; error?: string } | null>(null)

  async function sendFeeLink(e: React.FormEvent) {
    e.preventDefault()
    const dollars = parseFloat(feeAmount)
    if (!Number.isFinite(dollars) || dollars < 1) {
      setFeeResult({ ok: false, error: 'Enter a valid dollar amount (min $1).' })
      return
    }
    setFeeBusy(true)
    setFeeResult(null)
    try {
      const res = await fetch(`/api/admin/billing/${repId}/send-build-fee-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountCents: Math.round(dollars * 100), note: feeNote.trim() }),
      })
      const json = await res.json() as { ok: boolean; url?: string; reason?: string }
      if (json.ok) {
        setFeeResult({ ok: true, url: json.url })
        setFeeAmount('')
        setFeeNote('')
      } else {
        setFeeResult({ ok: false, error: json.reason ?? 'Failed to create link.' })
      }
    } catch {
      setFeeResult({ ok: false, error: 'Network error.' })
    } finally {
      setFeeBusy(false)
    }
  }

  // ── Subscription pricing overrides state ─────────────────────────────
  const [monthlyFlat, setMonthlyFlat] = useState(
    initialOverrides.monthly_flat_cents ? String(initialOverrides.monthly_flat_cents / 100) : ''
  )
  const [sdrHourly, setSdrHourly] = useState(
    initialOverrides.sdr_hourly_cents ? String(initialOverrides.sdr_hourly_cents / 100) : ''
  )
  const [pricingBusy, setPricingBusy] = useState(false)
  const [pricingResult, setPricingResult] = useState<{ ok: boolean; error?: string } | null>(null)

  async function savePricingOverrides(e: React.FormEvent) {
    e.preventDefault()
    setPricingBusy(true)
    setPricingResult(null)

    const body: Record<string, number | null> = {}

    const flat = monthlyFlat.trim()
    if (flat === '') {
      body.monthly_flat_cents = null
    } else {
      const n = parseFloat(flat)
      if (!Number.isFinite(n) || n < 0) {
        setPricingResult({ ok: false, error: 'Invalid monthly amount.' })
        setPricingBusy(false)
        return
      }
      body.monthly_flat_cents = Math.round(n * 100)
    }

    const hourly = sdrHourly.trim()
    if (hourly === '') {
      body.sdr_hourly_cents = null
    } else {
      const n = parseFloat(hourly)
      if (!Number.isFinite(n) || n < 0) {
        setPricingResult({ ok: false, error: 'Invalid hourly rate.' })
        setPricingBusy(false)
        return
      }
      body.sdr_hourly_cents = Math.round(n * 100)
    }

    try {
      const res = await fetch(`/api/admin/billing/${repId}/custom-pricing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json() as { ok: boolean; reason?: string }
      setPricingResult({ ok: json.ok, error: json.ok ? undefined : (json.reason ?? 'Save failed.') })
    } catch {
      setPricingResult({ ok: false, error: 'Network error.' })
    } finally {
      setPricingBusy(false)
    }
  }

  const hasOverrides = monthlyFlat.trim() !== '' || sdrHourly.trim() !== ''

  return (
    <section className="card" style={{ marginTop: '0.8rem', borderLeft: '4px solid #ff2800' }}>
      <div className="section-head">
        <h2>Custom pricing</h2>
        <p>Per-client overrides · build fee link · subscription rates</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'flex-start' }}>

        {/* ── Send custom build-fee link ─────────────────────────────── */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--royal)', margin: '0 0 8px' }}>
            Send custom build-fee link
          </p>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 10px' }}>
            Creates a Stripe Checkout for any dollar amount and emails the payment
            link to {clientEmail ? <strong>{clientEmail}</strong> : 'the client'}.
            Saves their card for subscription activation.
          </p>
          <form onSubmit={sendFeeLink} style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>$</span>
              <input
                type="number"
                min="1"
                step="1"
                placeholder="e.g. 800"
                value={feeAmount}
                onChange={(e) => setFeeAmount(e.target.value)}
                disabled={feeBusy}
                style={inputStyle}
              />
            </div>
            <input
              type="text"
              placeholder="Optional note to client (e.g. 'Agreed rate per our call')"
              value={feeNote}
              onChange={(e) => setFeeNote(e.target.value)}
              disabled={feeBusy}
              style={inputStyle}
            />
            <button type="submit" disabled={feeBusy || !feeAmount} className="btn approve" style={{ fontSize: 13 }}>
              {feeBusy ? 'Creating…' : 'Send payment link →'}
            </button>
          </form>
          {feeResult && (
            <div style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 6,
              fontSize: 12,
              background: feeResult.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${feeResult.ok ? '#86efac' : '#fca5a5'}`,
              color: feeResult.ok ? '#15803d' : '#991b1b',
            }}>
              {feeResult.ok
                ? <>Link sent to client. <a href={feeResult.url} target="_blank" rel="noreferrer" style={{ color: '#15803d', fontWeight: 700 }}>Preview link →</a></>
                : feeResult.error}
            </div>
          )}
        </div>

        {/* ── Subscription pricing overrides ────────────────────────── */}
        <div>
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--royal)', margin: '0 0 8px' }}>
            Subscription pricing overrides
          </p>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 10px' }}>
            Applied when you click <strong>Activate subscription</strong>. Leave blank to use
            catalog rates. <strong>Monthly flat</strong> replaces the entire plan total.{' '}
            <strong>SDR hourly</strong> overrides just the voice rate.
          </p>
          <form onSubmit={savePricingOverrides} style={{ display: 'grid', gap: 8 }}>
            <label style={labelStyle}>
              Monthly flat rate ($/mo)
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 350  (blank = catalog)"
                  value={monthlyFlat}
                  onChange={(e) => setMonthlyFlat(e.target.value)}
                  disabled={pricingBusy}
                  style={inputStyle}
                />
              </div>
            </label>
            <label style={labelStyle}>
              SDR voice hourly rate ($/hr)
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#374151' }}>$</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 4.50  (blank = catalog)"
                  value={sdrHourly}
                  onChange={(e) => setSdrHourly(e.target.value)}
                  disabled={pricingBusy}
                  style={inputStyle}
                />
              </div>
            </label>
            {hasOverrides && (
              <p style={{ fontSize: 11, color: '#b45309', background: '#fef9c3', padding: '6px 8px', borderRadius: 6, margin: 0 }}>
                Overrides are applied at activation time — they do not auto-update an already-live Stripe subscription.
              </p>
            )}
            <button type="submit" disabled={pricingBusy} className="btn" style={{ fontSize: 13 }}>
              {pricingBusy ? 'Saving…' : 'Save overrides'}
            </button>
          </form>
          {pricingResult && (
            <div style={{
              marginTop: 8,
              padding: '8px 10px',
              borderRadius: 6,
              fontSize: 12,
              background: pricingResult.ok ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${pricingResult.ok ? '#86efac' : '#fca5a5'}`,
              color: pricingResult.ok ? '#15803d' : '#991b1b',
            }}>
              {pricingResult.ok ? 'Overrides saved.' : pricingResult.error}
            </div>
          )}
        </div>

      </div>
    </section>
  )
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '7px 10px',
  fontSize: 13,
  border: '1px solid var(--border-soft)',
  borderRadius: 6,
  fontFamily: 'inherit',
  background: '#fff',
  color: '#0f172a',
  width: '100%',
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#374151',
  display: 'block',
}
