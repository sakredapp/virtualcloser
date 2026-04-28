'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ADDON_CATALOG,
  publicAddons,
  priceCart,
  formatPriceCents,
  formatCap,
  type AddonKey,
  type AddonCategory,
} from '@/lib/addons'

const CATEGORY_ORDER: AddonCategory[] = [
  'crm',
  'dialer',
  'voice_training',
  'analytics',
  'team',
  'branding',
  'messaging',
]
const CATEGORY_LABELS: Record<AddonCategory, string> = {
  base: 'Base build',
  crm: 'CRM integrations',
  dialer: 'AI dialer',
  voice_training: 'Voice training',
  analytics: 'Analytics & call intelligence',
  team: 'Team & leaderboard',
  branding: 'Branding',
  messaging: 'Messaging',
}

type Props = {
  prospectId: string
  initial: AddonKey[]
}

export default function AddonCart({ prospectId, initial }: Props) {
  // base_build is always implicitly included.
  const all = useMemo(() => publicAddons(), [])
  const [cart, setCart] = useState<Set<AddonKey>>(
    new Set(initial.filter((k) => k in ADDON_CATALOG && k !== 'base_build')),
  )
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [err, setErr] = useState<string | null>(null)

  // Debounced server save on every cart change.
  useEffect(() => {
    let cancelled = false
    const t = setTimeout(async () => {
      setSaving(true)
      setErr(null)
      try {
        const r = await fetch('/api/admin/prospect-addons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prospectId, addons: Array.from(cart) }),
        })
        if (!r.ok) throw new Error(`save failed (${r.status})`)
        if (!cancelled) setSavedAt(Date.now())
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'save failed')
      } finally {
        if (!cancelled) setSaving(false)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [cart, prospectId])

  const pricing = useMemo(() => priceCart(['base_build', ...Array.from(cart)]), [cart])

  const grouped = useMemo(() => {
    const out: Partial<Record<AddonCategory, typeof all>> = {}
    for (const a of all) {
      if (!out[a.category]) out[a.category] = []
      out[a.category]!.push(a)
    }
    return out
  }, [all])

  const toggle = (key: AddonKey) => {
    setCart((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
        const def = ADDON_CATALOG[key]
        for (const ex of def.excludes ?? []) next.delete(ex)
      }
      return next
    })
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.85rem',
          flexWrap: 'wrap',
        }}
      >
        <p style={{ margin: 0, fontSize: '13px', color: 'var(--muted)', lineHeight: 1.5, flex: 1 }}>
          Build the prospect&apos;s à-la-carte package. <strong>base_build is always included.</strong>{' '}
          Saves automatically. Copies forward to <code>client_addons</code> on convert.
        </p>
        <div style={{ fontSize: '11px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {saving ? 'Saving…' : err ? <span style={{ color: 'var(--red)' }}>{err}</span> : savedAt ? 'Saved ✓' : ''}
        </div>
      </div>

      {/* Always-on base */}
      <div
        style={{
          border: '1px solid var(--ink)',
          borderRadius: 10,
          padding: '0.75rem 0.9rem',
          background: 'var(--paper-2)',
          marginBottom: '1rem',
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <div>
          <span
            style={{
              fontSize: '10px',
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--red)',
              marginRight: 8,
            }}
          >
            Required
          </span>
          <strong style={{ color: 'var(--ink)' }}>{ADDON_CATALOG.base_build.label}</strong>
          <p style={{ margin: '0.2rem 0 0', fontSize: '12px', color: 'var(--muted)' }}>
            {ADDON_CATALOG.base_build.description}
          </p>
        </div>
        <div style={{ fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {formatPriceCents(ADDON_CATALOG.base_build.monthly_price_cents)}
          <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--muted)' }}>/mo</span>
        </div>
      </div>

      {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
        <div key={cat} style={{ marginBottom: '1rem' }}>
          <h3
            style={{
              margin: '0 0 0.4rem',
              fontSize: '11px',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--muted)',
              fontWeight: 700,
            }}
          >
            {CATEGORY_LABELS[cat]}
          </h3>
          <div style={{ display: 'grid', gap: '0.4rem' }}>
            {grouped[cat]!.map((def) => {
              const active = cart.has(def.key)
              const cap = formatCap(def)
              const margin = def.our_cost_at_cap_cents
                ? Math.round(
                    ((def.monthly_price_cents - def.our_cost_at_cap_cents) /
                      def.monthly_price_cents) *
                      100,
                  )
                : null
              return (
                <button
                  key={def.key}
                  type="button"
                  onClick={() => toggle(def.key)}
                  aria-pressed={active}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    border: '1px solid ' + (active ? 'var(--red)' : 'var(--ink-soft)'),
                    background: active ? '#fff5f3' : 'var(--paper)',
                    borderRadius: 8,
                    padding: '0.6rem 0.8rem',
                    display: 'grid',
                    gridTemplateColumns: '20px 1fr auto auto',
                    gap: '0.7rem',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--ink)'),
                      background: active ? 'var(--red)' : 'var(--paper)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {active ? '✓' : ''}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--ink)', fontSize: '13px' }}>
                      {def.label}
                    </div>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 2 }}>
                      {def.sales_blurb}
                      {cap ? <span style={{ color: 'var(--red)', marginLeft: 6 }}>· cap {cap}</span> : null}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: '11px',
                      color: margin === null ? 'var(--muted)' : margin >= 30 ? '#065f46' : 'var(--red)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                    title="Margin at cap"
                  >
                    {margin === null ? '—' : `${margin}% margin`}
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 700, color: 'var(--ink)' }}>
                    {formatPriceCents(def.monthly_price_cents)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ))}

      {/* Rollup */}
      <div
        style={{
          marginTop: '0.75rem',
          padding: '0.85rem 1rem',
          border: '1px solid var(--red)',
          borderRadius: 10,
          background: 'linear-gradient(180deg,#fff,#fff5f3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: '0.5rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: '11px', letterSpacing: '0.14em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--red)' }}>
            Quote rollup
          </div>
          <div>
            <span style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--ink)' }}>
              {formatPriceCents(pricing.monthly_cents)}
            </span>
            <span style={{ color: 'var(--muted)', marginLeft: 4 }}>/ mo</span>
          </div>
        </div>
        <div style={{ marginTop: '0.4rem', fontSize: '12px', color: 'var(--muted)' }}>
          Blended margin at cap:{' '}
          <strong style={{ color: pricing.blended_margin_pct >= 30 ? '#065f46' : 'var(--red)' }}>
            {pricing.blended_margin_pct}%
          </strong>{' '}
          · {pricing.line_items.length} line{pricing.line_items.length === 1 ? '' : 's'}
        </div>
        {pricing.warnings.length > 0 && (
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1rem', fontSize: '12px', color: 'var(--red)' }}>
            {pricing.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
