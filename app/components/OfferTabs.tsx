'use client'

// ─────────────────────────────────────────────────────────────────────────
// OfferTabs — shared top-of-page swatchers, used on /offer, /offer/enterprise,
// /demo, and /demo/enterprise so every visitor sees the same nav.
//
// Two swatchers stacked vertically:
//   1. Primary  — [Individual] [Enterprise]            (which audience)
//   2. Secondary— [Pricing]    [Dashboard preview]     (which view)
//
// The active labels never say "demo" per brand direction. The page passes
// `side` + `view` to mark its own active state; the inactive buttons are
// plain links to the corresponding cross-page route.
// ─────────────────────────────────────────────────────────────────────────

import Link from 'next/link'

type Side = 'individual' | 'enterprise'
type View = 'pricing' | 'demo'

const ROUTES: Record<Side, Record<View, string>> = {
  individual: { pricing: '/offer', demo: '/demo' },
  enterprise: { pricing: '/offer/enterprise', demo: '/demo/enterprise' },
}

export default function OfferTabs({
  side,
  view,
}: {
  side: Side
  view: View
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem', marginBottom: '0.7rem' }}>
      <SwatchRow
        items={[
          {
            label: 'Individual',
            sub: 'Solo operator',
            active: side === 'individual',
            href: ROUTES.individual[view],
          },
          {
            label: 'Enterprise',
            sub: 'Whole sales org',
            active: side === 'enterprise',
            href: ROUTES.enterprise[view],
          },
        ]}
      />
      <SwatchRow
        items={[
          {
            label: 'Pricing',
            sub: 'Build your quote',
            active: view === 'pricing',
            href: ROUTES[side].pricing,
          },
          {
            label: 'Dashboard preview',
            sub: 'See it in action',
            active: view === 'demo',
            href: ROUTES[side].demo,
          },
        ]}
      />
    </div>
  )
}

function SwatchRow({
  items,
}: {
  items: { label: string; sub: string; active: boolean; href: string }[]
}) {
  return (
    <div
      role="tablist"
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4,
        padding: 4,
        background: 'var(--paper-2, #f7f4ef)',
        border: '1.5px solid var(--ink)',
        borderRadius: 12,
      }}
    >
      {items.map((item) => {
        const active = item.active
        const inner = (
          <div>
            <div>{item.label}</div>
            <div
              style={{
                fontSize: '0.72rem',
                fontWeight: 500,
                color: active ? 'rgba(255,255,255,0.85)' : 'var(--muted)',
                marginTop: 2,
              }}
            >
              {item.sub}
            </div>
          </div>
        )
        const style: React.CSSProperties = {
          cursor: active ? 'default' : 'pointer',
          border: '1.5px solid ' + (active ? 'var(--red)' : 'var(--ink)'),
          background: active ? 'var(--red)' : 'var(--paper)',
          color: active ? '#ffffff' : 'var(--ink)',
          borderRadius: 9,
          padding: '0.7rem 0.9rem',
          textAlign: 'center',
          fontWeight: 700,
          fontSize: '0.95rem',
          boxShadow: active ? '0 4px 12px rgba(255, 40, 0, 0.22)' : 'none',
          textDecoration: 'none',
          transition: 'background 120ms ease, border-color 120ms ease, color 120ms ease',
        }
        if (active) {
          return (
            <button
              key={item.label}
              type="button"
              role="tab"
              aria-selected
              style={style}
            >
              {inner}
            </button>
          )
        }
        return (
          <Link key={item.label} href={item.href} role="tab" aria-selected={false} style={style}>
            {inner}
          </Link>
        )
      })}
    </div>
  )
}
