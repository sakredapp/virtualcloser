'use client'

import { useState, useTransition, useRef, useCallback } from 'react'

type Props = {
  token: string
  agreementTitle: string
  agreementVersion: string
  bodyFragment: string
  clientName: string
  hasBuildFee: boolean
  feeCents: number
}

export default function SignStep({
  token,
  agreementTitle,
  agreementVersion,
  bodyFragment,
  clientName,
  hasBuildFee,
  feeCents,
}: Props) {
  const firstName = clientName.split(' ')[0] || clientName
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const docScrollRef = useRef<HTMLDivElement>(null)
  const signBlockRef = useRef<HTMLDivElement>(null)

  const feeDollars = (feeCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

  const canFinish = agreed && name.trim().length >= 2

  const scrollToSign = useCallback(() => {
    signBlockRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  function submit() {
    if (!canFinish || pending) return
    setError(null)
    start(async () => {
      try {
        const res = await fetch(`/api/onboard/${token}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          requiresPayment?: boolean
          checkoutUrl?: string | null
        }
        if (!res.ok || data.ok === false) {
          setError(data.error ?? `HTTP ${res.status}`)
          return
        }
        if (data.requiresPayment && data.checkoutUrl) {
          window.location.href = data.checkoutUrl
        } else {
          window.location.reload()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'request failed')
      }
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', flexDirection: 'column', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header style={{
        height: 52,
        flexShrink: 0,
        background: '#0f0f0f',
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        gap: 14,
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        zIndex: 10,
      }}>
        {/* VC mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexShrink: 0 }}>
          <div style={{
            width: 30, height: 30,
            background: '#ff2800',
            borderRadius: 7,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ color: '#fff', fontWeight: 900, fontSize: 12, letterSpacing: '-0.04em' }}>VC</span>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, fontWeight: 600, letterSpacing: '0.01em' }}>
            Virtual Closer
          </span>
        </div>

        <div style={{ width: 1, height: 22, background: 'rgba(255,255,255,0.12)', flexShrink: 0 }} />

        {/* Doc name */}
        <span style={{
          color: '#fff', fontSize: 13, fontWeight: 500,
          flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {agreementTitle}
        </span>

        {/* "Signature required" chip */}
        <div style={{
          flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 11px',
          background: 'rgba(255,40,0,0.12)',
          border: '1px solid rgba(255,40,0,0.3)',
          borderRadius: 20,
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ff2800', flexShrink: 0 }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#ff6b4a', letterSpacing: '0.07em', textTransform: 'uppercase' }}>
            Signature required
          </span>
        </div>

        {/* Go to signature */}
        <button
          onClick={scrollToSign}
          style={{
            flexShrink: 0,
            padding: '7px 14px',
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 7,
            color: 'rgba(255,255,255,0.75)',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: '0.01em',
          }}
        >
          View signature ↓
        </button>

        {/* Finish button */}
        <button
          onClick={submit}
          disabled={!canFinish || pending}
          style={{
            flexShrink: 0,
            padding: '7px 18px',
            background: canFinish && !pending ? '#ff2800' : 'rgba(255,255,255,0.08)',
            border: 'none',
            borderRadius: 7,
            color: canFinish && !pending ? '#fff' : 'rgba(255,255,255,0.3)',
            fontSize: 13,
            fontWeight: 700,
            cursor: canFinish && !pending ? 'pointer' : 'not-allowed',
            letterSpacing: '0.02em',
            transition: 'background 0.2s, color 0.2s',
          }}
        >
          {pending ? 'Submitting…' : hasBuildFee ? `Sign & Pay $${feeDollars} →` : 'Finish →'}
        </button>
      </header>

      {/* ── Sub-banner ──────────────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0,
        background: hasBuildFee ? '#431407' : '#052e16',
        borderBottom: `1px solid ${hasBuildFee ? 'rgba(251,146,60,0.2)' : 'rgba(34,197,94,0.2)'}`,
        padding: '8px 20px',
        fontSize: 12,
        color: hasBuildFee ? '#fb923c' : '#4ade80',
      }}>
        {hasBuildFee
          ? `Hey ${firstName} — review and sign the agreement, then you'll be redirected to pay the one-time setup fee of $${feeDollars}.`
          : `Hey ${firstName} — review and sign the agreement below. Your login credentials will be emailed to you immediately after.`}
      </div>

      {/* ── Document viewer ─────────────────────────────────────────────── */}
      <div
        ref={docScrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          background: '#f7f4ef',
          padding: '36px 20px 60px',
        }}
      >
        {/* White document card — looks like a printed page */}
        <div style={{
          maxWidth: 760,
          margin: '0 auto',
          background: '#fff',
          boxShadow: '0 2px 16px rgba(15,15,15,0.1), 0 1px 4px rgba(15,15,15,0.06)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          {/* Document inner padding */}
          <div style={{ padding: 'clamp(24px, 6vw, 72px) clamp(20px, 8vw, 72px) 0' }}>

            {/* Doc header */}
            <div style={{ borderBottom: '2px solid #ff2800', paddingBottom: 16, marginBottom: 24 }}>
              <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#ff2800' }}>
                Virtual Closer
              </p>
              <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, color: '#0f172a', lineHeight: 1.2 }}>
                {agreementTitle}
              </h1>
              <p style={{ margin: 0, fontSize: 11, color: '#6B7280' }}>
                Version <span style={{ fontFamily: 'monospace' }}>{agreementVersion}</span>
                &nbsp;·&nbsp;
                This document is not legal advice — consult qualified legal counsel for guidance specific to your business.
              </p>
            </div>

            {/* Agreement body */}
            <div dangerouslySetInnerHTML={{ __html: bodyFragment }} />
          </div>

          {/* ── SIGN HERE block (inline, at bottom of doc) ────────────── */}
          <div ref={signBlockRef} style={{ margin: '40px 0 0' }}>
            {/* Red "sign here" header tab */}
            <div style={{
              background: '#ff2800',
              padding: '8px clamp(20px, 8vw, 72px)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                ✎ Signature required
              </span>
              <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.3)' }} />
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
                1 of 1 signatures
              </span>
            </div>

            {/* Sign form */}
            <div style={{
              background: '#fff',
              border: '1px solid rgba(15,15,15,0.1)',
              borderTop: 'none',
              padding: 'clamp(20px, 4vw, 28px) clamp(20px, 8vw, 72px) clamp(32px, 5vw, 48px)',
            }}>
              <p style={{ margin: '0 0 20px', fontSize: 13, color: '#0f0f0f', lineHeight: 1.6 }}>
                By typing your full legal name and clicking <strong>Finish</strong>, you confirm that you have read
                this agreement in its entirety and that your typed name constitutes a legally binding
                electronic signature under the E-SIGN Act (15 U.S.C. § 7001) and UETA.
                A signed PDF copy will be emailed to you for your records.
              </p>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 32, alignItems: 'start' }}>

                {/* Left col — name input + signature preview */}
                <div>
                  <label style={{
                    display: 'block',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.09em',
                    textTransform: 'uppercase',
                    color: '#ff2800',
                    marginBottom: 8,
                  }}>
                    Full legal name
                  </label>

                  {/* Signature-style input */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    borderBottom: '2px solid #ff2800',
                    paddingBottom: 6,
                    marginBottom: 16,
                  }}>
                    <span style={{ fontSize: 20, color: '#ff2800', fontWeight: 300, lineHeight: 1, flexShrink: 0 }}>×</span>
                    <input
                      type="text"
                      placeholder="Type your full legal name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={pending}
                      autoComplete="name"
                      style={{
                        flex: 1,
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        fontSize: 16,
                        color: '#0f172a',
                        padding: '4px 0',
                        fontFamily: 'inherit',
                      }}
                    />
                  </div>

                  {/* Signature preview */}
                  <div style={{
                    minHeight: 52,
                    borderBottom: '1px solid #d1d5db',
                    marginBottom: 6,
                    display: 'flex',
                    alignItems: 'flex-end',
                    paddingBottom: 4,
                  }}>
                    {name.trim().length >= 2 ? (
                      <span style={{
                        fontSize: 34,
                        fontFamily: "'Brush Script MT', 'Segoe Script', 'URW Chancery L', cursive",
                        color: '#0f0f0f',
                        lineHeight: 1,
                        letterSpacing: '0.02em',
                      }}>
                        {name.trim()}
                      </span>
                    ) : (
                      <span style={{ fontSize: 13, color: '#6B7280', fontStyle: 'italic' }}>
                        Signature preview
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: 10, color: '#6B7280' }}>
                    Signature preview — for display only
                  </p>
                </div>

                {/* Right col — agreement + submit */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    cursor: 'pointer',
                    fontSize: 13,
                    color: '#0f0f0f',
                    lineHeight: 1.55,
                  }}>
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      disabled={pending}
                      style={{ marginTop: 2, flexShrink: 0, accentColor: '#ff2800', width: 15, height: 15 }}
                    />
                    I have read and fully understand the Virtual Closer — Operational &amp; Liability Agreement,
                    and I agree to its terms on behalf of myself and the business I represent.
                  </label>

                  {error ? (
                    <p style={{ margin: 0, fontSize: 12, color: '#dc2626', background: '#fef2f2', padding: '8px 12px', borderRadius: 6 }}>
                      {error}
                    </p>
                  ) : null}

                  <button
                    onClick={submit}
                    disabled={!canFinish || pending}
                    style={{
                      padding: '13px 24px',
                      background: canFinish && !pending ? '#ff2800' : '#e5e7eb',
                      color: canFinish && !pending ? '#fff' : '#9ca3af',
                      border: 'none',
                      borderRadius: 8,
                      fontSize: 14,
                      fontWeight: 700,
                      cursor: canFinish && !pending ? 'pointer' : 'not-allowed',
                      letterSpacing: '0.03em',
                      transition: 'background 0.15s, color 0.15s',
                      textAlign: 'center',
                    }}
                  >
                    {pending
                      ? 'Submitting…'
                      : hasBuildFee
                        ? `Sign & Proceed to Payment ($${feeDollars}) →`
                        : `Sign & Finish →`}
                  </button>

                  <p style={{ margin: 0, fontSize: 11, color: '#6B7280', lineHeight: 1.5 }}>
                    Secured by Virtual Closer · E-SIGN Act compliant ·{' '}
                    A signed PDF will be emailed to you upon completion.
                  </p>
                </div>
              </div>
            </div>
          </div>
          {/* End doc card */}
        </div>
      </div>
    </div>
  )
}
