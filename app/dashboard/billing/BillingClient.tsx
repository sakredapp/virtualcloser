'use client'

// Card on file + plan picker for the agent's billing dashboard.
//
// Two stages:
//   1. No card → Stripe Elements card form bound to a SetupIntent client_secret
//   2. Card on file → plan picker (hours/wk slider) → POST /api/billing/subscribe

import { useEffect, useMemo, useState } from 'react'
import { Elements, useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import type { AgentBillingRow } from '@/lib/billing/agentBilling'

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
let _stripePromise: Promise<Stripe | null> | null = null
function stripePromise(): Promise<Stripe | null> {
  if (!_stripePromise) _stripePromise = loadStripe(PUBLISHABLE_KEY)
  return _stripePromise
}

const HOURS_MIN = 10
const HOURS_MAX = 80
const WEEKS_PER_MONTH = 4.3
const PRICE_PER_HOUR_DEFAULT = 6 // individual starter tier

export default function BillingClient({ billing }: { billing: AgentBillingRow | null }) {
  const hasCard = !!billing?.stripe_payment_method_id
  if (!hasCard) return <CardOnFileSection />
  return <PlanPickerSection billing={billing} />
}

// ── Card on file ────────────────────────────────────────────────────────

function CardOnFileSection() {
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/billing/setup-intent', { method: 'POST' })
        const json = (await res.json()) as { ok: boolean; clientSecret?: string; message?: string; reason?: string }
        if (cancelled) return
        if (!json.ok) {
          setError(json.message ?? json.reason ?? 'setup intent failed')
          return
        }
        setClientSecret(json.clientSecret ?? null)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'request failed')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <Section title="Save a card on file">
        <p style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>
      </Section>
    )
  }
  if (!clientSecret) {
    return (
      <Section title="Save a card on file">
        <p style={{ color: '#64748b', fontSize: 13 }}>Loading secure card form…</p>
      </Section>
    )
  }
  return (
    <Section title="Save a card on file">
      <p style={{ margin: '0 0 12px', fontSize: 13, color: '#64748b' }}>
        Your card is saved with Stripe. Card details never touch our servers.
        We only charge once you pick a plan below.
      </p>
      <Elements stripe={stripePromise()} options={{ clientSecret, appearance: { theme: 'stripe' } }}>
        <CardForm clientSecret={clientSecret} />
      </Elements>
    </Section>
  )
}

function CardForm({ clientSecret }: { clientSecret: string }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    setError(null)
    const { error: confirmErr } = await stripe.confirmSetup({
      elements,
      clientSecret,
      confirmParams: { return_url: `${window.location.origin}/dashboard/billing` },
      redirect: 'if_required',
    })
    if (confirmErr) {
      setError(confirmErr.message ?? 'card save failed')
      setSubmitting(false)
      return
    }
    // Webhook will populate stripe_payment_method_id + card metadata; refresh
    // the page to pick up the new state.
    window.location.reload()
  }

  return (
    <form onSubmit={onSubmit}>
      <PaymentElement />
      {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{error}</p>}
      <button type="submit" disabled={submitting || !stripe} style={primaryBtnStyle}>
        {submitting ? 'Saving…' : 'Save card'}
      </button>
    </form>
  )
}

// ── Plan picker ─────────────────────────────────────────────────────────

function PlanPickerSection({ billing }: { billing: AgentBillingRow }) {
  const initialHours = useMemo(() => {
    const planMin = billing.plan_minutes_per_month ?? 0
    if (!planMin) return 40
    const monthlyHours = planMin / 60
    const weekly = Math.round(monthlyHours / WEEKS_PER_MONTH)
    return Math.max(HOURS_MIN, Math.min(HOURS_MAX, weekly))
  }, [billing.plan_minutes_per_month])
  const [hoursPerWeek, setHoursPerWeek] = useState(initialHours)
  const [submitting, setSubmitting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const monthlyHours = Math.round(hoursPerWeek * WEEKS_PER_MONTH * 10) / 10
  const monthlyDollars = Math.round(monthlyHours * PRICE_PER_HOUR_DEFAULT)

  async function onSubscribe() {
    setSubmitting(true)
    setMsg(null)
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoursPerWeek, pricePerHour: PRICE_PER_HOUR_DEFAULT }),
      })
      const json = (await res.json()) as { ok: boolean; status?: string; message?: string; reason?: string }
      if (!json.ok) throw new Error(json.message ?? json.reason ?? 'subscribe failed')
      setMsg(`Plan updated — Stripe status: ${json.status ?? 'unknown'}`)
      setTimeout(() => window.location.reload(), 700)
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'subscribe failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Section title={billing.stripe_subscription_id ? 'Change your plan' : 'Pick your plan'}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#525252' }}>
          Hours per week
        </span>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#0f172a' }}>{hoursPerWeek} hrs/wk</span>
      </div>
      <input
        type="range"
        min={HOURS_MIN}
        max={HOURS_MAX}
        step={1}
        value={hoursPerWeek}
        onChange={(e) => setHoursPerWeek(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#ff2800' }}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
        <span>{HOURS_MIN}</span>
        <span>{HOURS_MAX}</span>
      </div>
      <p style={{ margin: '10px 0 0', fontSize: 13, color: '#64748b' }}>
        ≈ {monthlyHours} hrs/month · ${PRICE_PER_HOUR_DEFAULT}/hr starter rate ·{' '}
        <strong style={{ color: '#0f172a' }}>${monthlyDollars}/mo</strong>
      </p>
      <button type="button" onClick={onSubscribe} disabled={submitting} style={primaryBtnStyle}>
        {submitting ? 'Updating…' : billing.stripe_subscription_id ? 'Switch plan' : 'Activate plan'}
      </button>
      {msg && <p style={{ margin: '10px 0 0', fontSize: 12, color: msg.startsWith('Plan') ? '#16a34a' : '#dc2626' }}>{msg}</p>}
    </Section>
  )
}

// ── Shared ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: '#fff',
        border: '1px solid #e6e1d8',
        borderRadius: 12,
        padding: '1rem 1.1rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <h2
        style={{
          margin: '0 0 12px',
          fontSize: 14,
          fontWeight: 800,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: '#0f172a',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

const primaryBtnStyle: React.CSSProperties = {
  marginTop: 14,
  padding: '10px 18px',
  background: '#ff2800',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '0 4px 12px rgba(255,40,0,0.30)',
}
