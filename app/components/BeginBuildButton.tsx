'use client'

// Shared "Begin build" button. Builds the server cart from the in-page
// configuration, then redirects to Stripe Checkout (payment mode) for the
// build fee. Subscription activation happens later via admin once the
// build is ready.

import { useState, useTransition } from 'react'

export type BeginBuildPayload = {
  email?: string
  displayName?: string
  company?: string
  phone?: string
  tier: 'individual' | 'team' | 'enterprise'
  repCount: number
  weeklyHours: number
  trainerWeeklyHours?: number
  overflowEnabled?: boolean
  addons?: string[]
  metadata?: Record<string, unknown>
}

type Props = {
  buildPayload: () => BeginBuildPayload | null
  buildFeeCents: number
  disabled?: boolean
  variant?: 'primary' | 'secondary'
  className?: string
  style?: React.CSSProperties
  /** Override label. Default: "Begin build · $X" with the build fee. */
  label?: string
}

export function BeginBuildButton({
  buildPayload,
  buildFeeCents,
  disabled = false,
  variant = 'primary',
  className,
  style,
  label,
}: Props) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)

  function go() {
    setErr(null)
    const payload = buildPayload()
    if (!payload) {
      setErr('Pick at least the rep count + one feature first.')
      return
    }
    if (!payload.email) {
      const entered = prompt('Email to send your dashboard login to:')
      if (!entered) return
      payload.email = entered.trim()
    }
    start(async () => {
      try {
        // 1. Server-side cart
        const cartRes = await fetch('/api/checkout/cart', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const cartJ = await cartRes.json()
        if (!cartRes.ok || !cartJ.ok) throw new Error(cartJ.reason ?? 'cart_failed')
        const cartId = cartJ.cartId as string

        // 2. Stripe Checkout (payment mode → build fee only)
        const sessRes = await fetch('/api/checkout/build-fee', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ cartId }),
        })
        const sessJ = await sessRes.json()
        if (!sessRes.ok || !sessJ.ok) throw new Error(sessJ.reason ?? 'checkout_failed')

        // 3. Redirect to Stripe
        window.location.href = sessJ.url
      } catch (e) {
        setErr((e as Error).message ?? 'Something went wrong.')
      }
    })
  }

  const baseStyle: React.CSSProperties = {
    padding: '14px 22px',
    fontSize: 16,
    fontWeight: 800,
    border: 'none',
    borderRadius: 10,
    cursor: pending || disabled ? 'wait' : 'pointer',
    opacity: pending || disabled ? 0.7 : 1,
    width: '100%',
    transition: 'transform 80ms ease',
    letterSpacing: '0.02em',
    ...style,
  }
  const primaryStyle: React.CSSProperties = {
    ...baseStyle,
    background: '#ff2800',
    color: '#fff',
    boxShadow: '0 6px 20px rgba(255,40,0,0.28)',
  }
  const secondaryStyle: React.CSSProperties = {
    ...baseStyle,
    background: '#fff',
    color: '#ff2800',
    border: '2px solid #ff2800',
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={go}
        disabled={disabled || pending}
        style={variant === 'primary' ? primaryStyle : secondaryStyle}
      >
        {pending ? 'Loading checkout…' : (label ?? `Begin build · pay $${(buildFeeCents / 100).toFixed(0)} build fee`)}
      </button>
      <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.4 }}>
        Build fee charged today. Weekly subscription starts only after we activate your build.
      </p>
      {err && (
        <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--red)', textAlign: 'center' }}>
          {err}
        </p>
      )}
    </div>
  )
}
