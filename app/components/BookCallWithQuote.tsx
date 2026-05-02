'use client'

// "Book a call with this quote" CTA. Captures the buyer's email + name,
// creates a server-side cart + prospect, then redirects to Cal.com with
// the prospect_id + cart_id baked in as metadata.
//
// If no email is needed (returning buyer in localStorage), skips the
// prompt and goes straight through.

import { useState, useTransition } from 'react'
import type { BeginBuildPayload } from './BeginBuildButton'

type Props = {
  buildPayload: () => BeginBuildPayload | null
  /** Plain Cal.com URL fallback if we can't capture email for some reason. */
  fallbackHref: string
  /** Visual variant — primary (red) or ghost (existing button styling). */
  variant?: 'primary' | 'ghost'
  className?: string
  style?: React.CSSProperties
  children?: React.ReactNode
}

const STORAGE_KEY = 'vc_buyer_contact_v1'

export function BookCallWithQuote({
  buildPayload,
  fallbackHref,
  variant = 'ghost',
  className,
  style,
  children,
}: Props) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function go() {
    setErr(null)
    const payload = buildPayload()
    if (!payload) {
      // Nothing configured — just go to the plain Cal link.
      window.open(fallbackHref, '_blank', 'noopener,noreferrer')
      return
    }

    // Pull cached contact info if we have it.
    let cached: { email?: string; name?: string; company?: string; phone?: string } | null = null
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) cached = JSON.parse(raw)
    } catch {}

    const email = (cached?.email ?? payload.email ?? '').trim() || prompt('Your email — so we can attach the quote to your booking:')?.trim()
    if (!email) return
    const name = cached?.name ?? payload.displayName ?? prompt('Your name (optional):')?.trim() ?? ''
    const company = cached?.company ?? payload.company ?? ''
    const phone = cached?.phone ?? payload.phone ?? ''

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ email, name, company, phone }))
    } catch {}

    start(async () => {
      try {
        const res = await fetch('/api/quote/attach', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cart: payload, email, name, company, phone }),
        })
        const j = await res.json()
        if (!res.ok || !j.ok) throw new Error(j.reason ?? 'attach_failed')
        // Redirect in the SAME tab so the prospect is steered through the
        // funnel; Cal.com handles its own modal flow.
        window.location.href = j.calUrl as string
      } catch (e) {
        setErr((e as Error).message)
        // Soft fallback: open the plain link so the booking still happens.
        window.open(fallbackHref, '_blank', 'noopener,noreferrer')
      }
    })
  }

  const baseStyle: React.CSSProperties = {
    cursor: pending ? 'wait' : 'pointer',
    opacity: pending ? 0.7 : 1,
    border: 'none',
    fontFamily: 'inherit',
    ...style,
  }
  const primaryStyle: React.CSSProperties = {
    ...baseStyle,
    background: '#ff2800',
    color: '#fff',
    padding: '12px 18px',
    borderRadius: 10,
    fontWeight: 700,
    fontSize: 14,
  }

  return (
    <>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className={className}
        style={variant === 'primary' ? primaryStyle : baseStyle}
      >
        {pending ? 'Saving quote…' : (children ?? 'Book a call with this quote')}
      </button>
      {err && <p style={{ marginTop: 6, fontSize: 11, color: 'var(--red, #ff2800)' }}>{err}</p>}
    </>
  )
}
