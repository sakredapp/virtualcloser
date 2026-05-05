'use client'

// Admin-only panel for per-client pricing overrides, sending a custom
// build-fee checkout link, and resending past invoices.

import { useState, useCallback } from 'react'

type InvoiceRow = {
  id: string
  stripeNumber: string | null
  amountCents: number
  status: string
  billingReason: string | null
  description: string | null
  createdAt: number
  hostedUrl: string | null
}

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

  // ── Invoice history state ────────────────────────────────────────────
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [invoicesError, setInvoicesError] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [resendResults, setResendResults] = useState<Record<string, { ok: boolean; msg: string }>>({})

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true)
    setInvoicesError(null)
    try {
      const res = await fetch(`/api/admin/billing/${repId}/invoices`)
      const json = await res.json() as { ok: boolean; invoices?: InvoiceRow[]; reason?: string }
      if (json.ok) {
        setInvoices(json.invoices ?? [])
      } else {
        setInvoicesError(json.reason ?? 'Failed to load.')
      }
    } catch {
      setInvoicesError('Network error.')
    } finally {
      setInvoicesLoading(false)
    }
  }, [repId])

  async function resendInvoice(stripeInvoiceId: string) {
    setResendingId(stripeInvoiceId)
    try {
      const res = await fetch(`/api/admin/billing/${repId}/resend-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stripeInvoiceId }),
      })
      const json = await res.json() as { ok: boolean; invoiceNumber?: string; reason?: string }
      setResendResults((prev) => ({
        ...prev,
        [stripeInvoiceId]: json.ok
          ? { ok: true, msg: `Sent as ${json.invoiceNumber}` }
          : { ok: false, msg: json.reason ?? 'Send failed.' },
      }))
    } catch {
      setResendResults((prev) => ({ ...prev, [stripeInvoiceId]: { ok: false, msg: 'Network error.' } }))
    } finally {
      setResendingId(null)
    }
  }

  async function resendLatest() {
    setResendingId('latest')
    try {
      const res = await fetch(`/api/admin/billing/${repId}/resend-invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json() as { ok: boolean; invoiceNumber?: string; reason?: string }
      setResendResults((prev) => ({
        ...prev,
        latest: json.ok
          ? { ok: true, msg: `Sent as ${json.invoiceNumber}` }
          : { ok: false, msg: json.reason ?? 'Send failed.' },
      }))
    } catch {
      setResendResults((prev) => ({ ...prev, latest: { ok: false, msg: 'Network error.' } }))
    } finally {
      setResendingId(null)
    }
  }

  const hasOverrides = monthlyFlat.trim() !== '' || sdrHourly.trim() !== ''

  return (
    <section className="card" style={{ marginTop: '0.8rem', borderLeft: '4px solid #ff2800' }}>
      <div className="section-head">
        <h2>Custom pricing &amp; invoices</h2>
        <p>Build fee link · subscription rates · invoice resend</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.2rem', alignItems: 'flex-start' }}>

        {/* ── Send custom build-fee link ─────────────────────────────── */}
        <div>
          <p style={sectionLabel}>Send custom build-fee link</p>
          <p style={hint}>
            Creates a Stripe Checkout for any dollar amount and emails the payment
            link to {clientEmail ? <strong>{clientEmail}</strong> : 'the client'}.
            Saves their card for subscription activation.
          </p>
          <form onSubmit={sendFeeLink} style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span style={dollarSign}>$</span>
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
              placeholder="Optional note (e.g. 'Agreed rate per our call')"
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
            <div style={feeResult.ok ? successBox : errorBox}>
              {feeResult.ok
                ? <>Link sent to client. <a href={feeResult.url} target="_blank" rel="noreferrer" style={{ color: '#15803d', fontWeight: 700 }}>Preview link →</a></>
                : feeResult.error}
            </div>
          )}
        </div>

        {/* ── Subscription pricing overrides ────────────────────────── */}
        <div>
          <p style={sectionLabel}>Subscription pricing overrides</p>
          <p style={hint}>
            Applied when you click <strong>Activate subscription</strong>. Leave blank to use
            catalog rates. <strong>Monthly flat</strong> replaces the entire plan total.{' '}
            <strong>SDR hourly</strong> overrides just the voice rate.
          </p>
          <form onSubmit={savePricingOverrides} style={{ display: 'grid', gap: 8 }}>
            <label style={labelStyle}>
              Monthly flat rate ($/mo)
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
                <span style={dollarSign}>$</span>
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
                <span style={dollarSign}>$</span>
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
            <div style={pricingResult.ok ? successBox : errorBox}>
              {pricingResult.ok ? 'Overrides saved.' : pricingResult.error}
            </div>
          )}
        </div>

      </div>

      {/* ── Invoice history & resend ─────────────────────────────────── */}
      <div style={{ marginTop: '1.2rem', borderTop: '1px solid var(--border-soft)', paddingTop: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <p style={{ ...sectionLabel, margin: 0 }}>Invoice history &amp; resend</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={loadInvoices}
              disabled={invoicesLoading}
              className="btn"
              style={{ fontSize: 12, padding: '5px 12px' }}
            >
              {invoicesLoading ? 'Loading…' : invoices === null ? 'Load invoices' : 'Refresh'}
            </button>
            <button
              onClick={resendLatest}
              disabled={resendingId === 'latest' || !clientEmail}
              className="btn approve"
              style={{ fontSize: 12, padding: '5px 12px' }}
              title={!clientEmail ? 'No email on file' : 'Resend the most recent invoice'}
            >
              {resendingId === 'latest' ? 'Sending…' : 'Resend latest →'}
            </button>
          </div>
        </div>

        {resendResults['latest'] && (
          <div style={{ ...resendResults['latest'].ok ? successBox : errorBox, marginBottom: 8 }}>
            Latest: {resendResults['latest'].msg}
          </div>
        )}

        {invoicesError && (
          <p style={{ fontSize: 12, color: '#991b1b', margin: 0 }}>{invoicesError}</p>
        )}

        {invoices !== null && invoices.length === 0 && (
          <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>No Stripe invoices found for this client.</p>
        )}

        {invoices && invoices.length > 0 && (
          <div style={{ display: 'grid', gap: 6 }}>
            {invoices.map((inv) => {
              const result = resendResults[inv.id]
              const isSending = resendingId === inv.id
              const dollars = `$${(inv.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`
              const date = new Date(inv.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
              const statusColor = inv.status === 'paid' ? '#15803d' : inv.status === 'open' ? '#b45309' : '#6b7280'

              return (
                <div
                  key={inv.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: '#f9fafb',
                    border: '1px solid #e5e7eb',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      {dollars}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {inv.status}
                      </span>
                    </p>
                    <p style={{ margin: '1px 0 0', fontSize: 11, color: '#6b7280' }}>
                      {date}
                      {inv.stripeNumber ? ` · ${inv.stripeNumber}` : ''}
                      {inv.billingReason ? ` · ${inv.billingReason.replace(/_/g, ' ')}` : ''}
                    </p>
                    {inv.description && (
                      <p style={{ margin: '1px 0 0', fontSize: 11, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 320 }}>
                        {inv.description}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    {result && (
                      <span style={{ fontSize: 11, color: result.ok ? '#15803d' : '#991b1b', fontWeight: 600 }}>
                        {result.msg}
                      </span>
                    )}
                    {inv.hostedUrl && (
                      <a
                        href={inv.hostedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn"
                        style={{ fontSize: 11, padding: '4px 10px' }}
                      >
                        View
                      </a>
                    )}
                    <button
                      onClick={() => resendInvoice(inv.id)}
                      disabled={isSending || !clientEmail}
                      className="btn approve"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      title={!clientEmail ? 'No email on file' : `Resend to ${clientEmail}`}
                    >
                      {isSending ? '…' : 'Resend PDF'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!clientEmail && (
          <p style={{ fontSize: 11, color: '#b45309', marginTop: 8 }}>
            Add a login email for this client before sending invoices.
          </p>
        )}
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

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--royal)',
  margin: '0 0 8px',
}

const hint: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  margin: '0 0 10px',
}

const dollarSign: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#374151',
}

const successBox: React.CSSProperties = {
  marginTop: 8,
  padding: '8px 10px',
  borderRadius: 6,
  fontSize: 12,
  background: '#f0fdf4',
  border: '1px solid #86efac',
  color: '#15803d',
}

const errorBox: React.CSSProperties = {
  marginTop: 8,
  padding: '8px 10px',
  borderRadius: 6,
  fontSize: 12,
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  color: '#991b1b',
}
