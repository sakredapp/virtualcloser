'use client'

// First-run onboarding guide. Visible until all setup checks pass or user
// dismisses. Dismissal stored in localStorage keyed by tenant ID so it
// stays gone across page loads but resets per-account.

import Link from 'next/link'
import { useEffect, useState } from 'react'

type CheckItem = {
  key: string
  label: string
  ok: boolean
  note: string
  fix_url?: string
}

type Products = { sdr: boolean; receptionist: boolean; trainer: boolean }

type ReadinessData = {
  sdr: CheckItem[]
  receptionist: CheckItem[]
  trainer: CheckItem[]
  products?: Products
}

const DISMISS_KEY = (repId: string) => `vc_onboarding_dismissed_${repId}`

const ALL_STEPS = [
  {
    key: 'voice',
    forProduct: 'sdr' as keyof Products,
    emoji: '📞',
    label: 'Connect voice provider',
    desc: 'Your AI Dialer number is assigned — calls can go live.',
    check: (d: ReadinessData) => d.sdr.find((c) => c.key === 'voice_provider')?.ok ?? false,
    action: { label: 'Contact support', href: 'mailto:team@virtualcloser.com' },
  },
  {
    key: 'sdr_created',
    forProduct: 'sdr' as keyof Products,
    emoji: '🤖',
    label: 'Create your AI SDR',
    desc: 'Build the persona, upload scripts, set a schedule.',
    check: (d: ReadinessData) => d.sdr.find((c) => c.key === 'sdr_created')?.ok ?? false,
    action: { label: 'Create AI SDR', href: '/dashboard/dialer/appointment-setter' },
  },
  {
    key: 'receptionist',
    forProduct: 'receptionist' as keyof Products,
    emoji: '🤝',
    label: 'Enable AI Receptionist',
    desc: 'Auto-confirm appointments 30–60 min before they start.',
    check: (d: ReadinessData) => d.receptionist.find((c) => c.key === 'auto_confirm_enabled')?.ok ?? false,
    action: { label: 'Set up Receptionist', href: '/dashboard/dialer/receptionist' },
  },
  {
    key: 'product_summary',
    forProduct: null, // show whenever the guide shows at all
    emoji: '📝',
    label: 'Write your product summary',
    desc: 'Tell the AI what you sell so every call is on-brand.',
    check: (d: ReadinessData) => d.sdr.find((c) => c.key === 'product_summary')?.ok ?? d.receptionist.find((c) => c.key === 'product_summary')?.ok ?? false,
    action: { label: 'Write summary', href: '/dashboard/dialer/receptionist' },
  },
]

type Props = { repId: string }

export default function FirstRunGuide({ repId }: Props) {
  const [data, setData] = useState<ReadinessData | null>(null)
  const [dismissed, setDismissed] = useState(true) // start hidden to avoid flash
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const isDismissed = localStorage.getItem(DISMISS_KEY(repId)) === '1'
    if (isDismissed) { setLoading(false); return }
    setDismissed(false)

    fetch('/api/me/setup-readiness')
      .then((r) => r.json())
      .then((json: { ok: boolean; checks?: ReadinessData; products?: Products }) => {
        if (json.ok && json.checks) {
          setData({ ...json.checks, products: json.products })
        }
      })
      .finally(() => setLoading(false))
  }, [repId])

  function dismiss() {
    localStorage.setItem(DISMISS_KEY(repId), '1')
    setDismissed(true)
  }

  if (dismissed || loading) return null

  const products = data?.products
  const hasAnyProduct = products ? (products.sdr || products.receptionist || products.trainer) : true

  // If we know the tenant's products and they have none, hide the guide entirely.
  if (data && !hasAnyProduct) return null

  const steps = ALL_STEPS
    .filter((s) => s.forProduct === null || !products || products[s.forProduct])
    .map((s) => ({
      ...s,
      done: data ? s.check(data) : false,
    }))

  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length
  const pct = Math.round((doneCount / steps.length) * 100)

  // Auto-dismiss once everything is done
  if (allDone) {
    localStorage.setItem(DISMISS_KEY(repId), '1')
    return null
  }

  const nextStep = steps.find((s) => !s.done)

  return (
    <div style={{
      margin: '0 0 1.2rem',
      background: 'var(--paper)',
      borderRadius: 14,
      border: '1.5px solid var(--border-soft)',
      boxShadow: 'var(--shadow-card)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px 0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 10,
            background: 'linear-gradient(135deg, #ff2800 0%, #ff6b35 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, flexShrink: 0,
          }}>
            🚀
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>
              Get your AI running — {doneCount}/{steps.length} done
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
              {nextStep ? `Next: ${nextStep.label}` : 'Almost there!'}
            </div>
          </div>
        </div>
        <button
          onClick={dismiss}
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer',
            color: 'var(--muted)', fontSize: 18, padding: '4px 8px', borderRadius: 6,
            flexShrink: 0,
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>

      {/* Progress bar */}
      <div style={{ margin: '12px 20px 0', height: 6, borderRadius: 3, background: '#e5e7eb' }}>
        <div style={{
          height: '100%', borderRadius: 3,
          background: pct >= 80 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ff2800',
          width: `${pct}%`, transition: 'width 0.5s ease',
        }} />
      </div>

      {/* Steps */}
      <div style={{ padding: '12px 20px 16px', display: 'grid', gap: 8 }}>
        {steps.map((step) => (
          <div
            key={step.key}
            style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '10px 14px', borderRadius: 10,
              background: step.done ? '#f0fdf4' : 'var(--paper-2, #f7f4ef)',
              border: `1px solid ${step.done ? '#bbf7d0' : 'rgba(0,0,0,0.06)'}`,
              opacity: step.done ? 0.75 : 1,
            }}
          >
            <span style={{ fontSize: 18, flexShrink: 0, width: 24, textAlign: 'center' }}>
              {step.done ? '✅' : step.emoji}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 13, fontWeight: step.done ? 500 : 700,
                color: step.done ? 'var(--muted)' : 'var(--ink)',
                textDecoration: step.done ? 'line-through' : 'none',
              }}>
                {step.label}
              </div>
              {!step.done && (
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                  {step.desc}
                </div>
              )}
            </div>
            {!step.done && step.action && (
              <Link
                href={step.action.href}
                style={{
                  flexShrink: 0, fontSize: 12, fontWeight: 700,
                  padding: '5px 12px', borderRadius: 6,
                  background: 'var(--red, #ff2800)', color: '#fff',
                  textDecoration: 'none', whiteSpace: 'nowrap',
                }}
              >
                {step.action.label} →
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Footer dismiss */}
      <div style={{
        padding: '10px 20px', borderTop: '1px solid var(--border-soft)',
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <button
          onClick={dismiss}
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--muted)', fontSize: 12, cursor: 'pointer',
            textDecoration: 'underline', padding: 0,
          }}
        >
          Hide this guide
        </button>
      </div>
    </div>
  )
}
