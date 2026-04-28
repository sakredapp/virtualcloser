'use client'

// ─────────────────────────────────────────────────────────────────────────
// QuoteCart — shared interactive cart used on /offer and /demo
//
// Renders:
//   • Required base-build card
//   • Toggleable add-on cards grouped by category (red on, ink off)
//   • A "scale slider" that recommends the right Lite / Pro tier based on
//     estimated monthly volume (appointments / roleplay minutes)
//   • Sticky monthly-total summary with line items + warnings + book CTA
//
// Same visual language on both pages so customers never feel a "seam".
// ─────────────────────────────────────────────────────────────────────────

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import {
  ADDON_CATALOG,
  publicAddons,
  priceCart,
  formatPriceCents,
  formatCap,
  type AddonKey,
  type AddonCategory,
  type AddonDef,
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

const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'

function bookingHref(opts: { cart: AddonKey[]; mrrCents: number }): string {
  try {
    const url = new URL(CAL_BOOKING_URL)
    url.searchParams.set('metadata[mode]', 'individual')
    url.searchParams.set('metadata[cart]', opts.cart.join(','))
    url.searchParams.set('metadata[mrr_cents]', String(opts.mrrCents))
    return url.toString()
  } catch {
    return CAL_BOOKING_URL
  }
}

// Slider thresholds — when "estimated monthly appointments" crosses these,
// the Pro variant becomes the recommended pick. Mirrors caps in addons.ts.
const SCALE_PRO_APPT_THRESHOLD = 100 // dialer_lite cap
const SCALE_PRO_ROLEPLAY_THRESHOLD = 300 // roleplay_lite cap (minutes)

export type QuoteCartProps = {
  /** When `true`, syncs cart state to ?cart= in the URL (offer page only). */
  syncQueryString?: boolean
  /** Compact layout for the demo legend (no sticky aside, no slider). */
  compact?: boolean
  /** Heading shown above the cart cards. */
  heading?: string
  /** Subheading copy. */
  subheading?: string
  /** Override CTA href; defaults to Cal booking link. */
  ctaHref?: string
  /** CTA label. */
  ctaLabel?: string
}

export default function QuoteCart({
  syncQueryString = false,
  compact = false,
  heading = 'Build your quote',
  subheading = 'Base build is required — that\'s your AI employee. Everything else is à la carte. Toggle what fits, see your monthly. We\'ll quote the one-time build fee on the call.',
  ctaHref,
  ctaLabel = 'Book a call with this quote',
}: QuoteCartProps) {
  const all = useMemo(() => publicAddons(), [])

  const [cart, setCart] = useState<Set<AddonKey>>(new Set())
  // Estimated monthly volume for the scale slider — drives Lite/Pro recommendation.
  const [scaleAppts, setScaleAppts] = useState<number>(60)
  const [scaleRpMin, setScaleRpMin] = useState<number>(180)

  // Hydrate from ?cart= on mount (offer page only).
  useEffect(() => {
    if (!syncQueryString || typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const raw = sp.get('cart')
    if (!raw) return
    const keys = raw.split(',').filter((k): k is AddonKey => k in ADDON_CATALOG)
    if (keys.length > 0) setCart(new Set(keys))
  }, [syncQueryString])

  // Persist cart back to ?cart=.
  useEffect(() => {
    if (!syncQueryString || typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)
    const keys = Array.from(cart).filter((k) => k !== 'base_build')
    if (keys.length === 0) sp.delete('cart')
    else sp.set('cart', keys.join(','))
    const next = sp.toString()
    const url = next ? `${window.location.pathname}?${next}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [cart, syncQueryString])

  const pricing = useMemo(() => priceCart(Array.from(cart)), [cart])

  const grouped = useMemo(() => {
    const out: Partial<Record<AddonCategory, AddonDef[]>> = {}
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

  // When scale slider crosses Pro threshold, auto-recommend (highlight) the
  // Pro variant. We don't auto-toggle — only recommend — so the user stays in control.
  const dialerRec: AddonKey | null =
    scaleAppts >= SCALE_PRO_APPT_THRESHOLD ? 'addon_dialer_pro' : 'addon_dialer_lite'
  const roleplayRec: AddonKey | null =
    scaleRpMin >= SCALE_PRO_ROLEPLAY_THRESHOLD ? 'addon_roleplay_pro' : 'addon_roleplay_lite'

  const cartArrayWithBase: AddonKey[] = [
    'base_build',
    ...Array.from(cart).filter((k) => k !== 'base_build'),
  ]
  const bookHref =
    ctaHref ??
    bookingHref({ cart: cartArrayWithBase, mrrCents: pricing.monthly_cents })

  const cardListPadding = '0.95rem 1rem'

  return (
    <section
      className="card"
      style={{
        marginTop: '0.8rem',
        background: '#fff',
        borderColor: 'var(--brand-red, var(--red))',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: '0.72rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--brand-red, var(--red))',
        }}
      >
        {heading}
      </p>
      <h2 style={{ margin: '0.3rem 0 0.4rem', color: 'var(--ink)' }}>
        Pick the pieces you need
      </h2>
      <p className="meta" style={{ margin: 0 }}>
        {subheading}
      </p>

      <div className={compact ? 'qc-grid qc-grid-compact' : 'qc-grid'}>
        {/* ── Cart inputs ──────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <BaseBuildCard padding={cardListPadding} />

          {!compact && (
            <ScaleSlider
              scaleAppts={scaleAppts}
              setScaleAppts={setScaleAppts}
              scaleRpMin={scaleRpMin}
              setScaleRpMin={setScaleRpMin}
            />
          )}

          {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => (
            <div key={cat}>
              <h3
                style={{
                  margin: '0 0 0.55rem',
                  fontSize: '0.74rem',
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: 'var(--ink)',
                  fontWeight: 700,
                  borderBottom: '1px solid var(--ink)',
                  paddingBottom: '0.35rem',
                }}
              >
                {CATEGORY_LABELS[cat]}
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                {grouped[cat]!.map((def) => {
                  const active = cart.has(def.key)
                  const cap = formatCap(def)
                  const recommended =
                    !compact &&
                    !active &&
                    (def.key === dialerRec || def.key === roleplayRec)
                  return (
                    <button
                      key={def.key}
                      type="button"
                      onClick={() => toggle(def.key)}
                      aria-pressed={active}
                      style={{
                        textAlign: 'left',
                        cursor: 'pointer',
                        border:
                          '1.5px solid ' +
                          (active
                            ? 'var(--red)'
                            : recommended
                              ? 'var(--ink)'
                              : 'var(--line, #e6e1d8)'),
                        background: active ? '#fff5f3' : 'var(--paper, #fff)',
                        borderRadius: 10,
                        padding: cardListPadding,
                        display: 'grid',
                        gridTemplateColumns: '22px 1fr auto',
                        gap: '0.85rem',
                        alignItems: 'start',
                        boxShadow: active
                          ? '0 2px 8px rgba(255,40,0,0.12)'
                          : 'none',
                        transition:
                          'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 5,
                          border:
                            '1.5px solid ' +
                            (active ? 'var(--red)' : 'var(--ink)'),
                          background: active ? 'var(--red)' : 'transparent',
                          display: 'inline-block',
                          marginTop: 2,
                        }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.45rem',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              fontWeight: 700,
                              color: 'var(--ink)',
                              fontSize: '0.95rem',
                            }}
                          >
                            {def.label}
                          </span>
                          {recommended && (
                            <span
                              style={{
                                fontSize: '0.62rem',
                                fontWeight: 700,
                                letterSpacing: '0.12em',
                                textTransform: 'uppercase',
                                padding: '2px 6px',
                                borderRadius: 4,
                                background: 'var(--ink)',
                                color: '#fff',
                              }}
                            >
                              Recommended
                            </span>
                          )}
                        </div>
                        <div
                          style={{
                            fontSize: '0.83rem',
                            color: 'var(--muted)',
                            marginTop: 3,
                            lineHeight: 1.45,
                          }}
                        >
                          {def.sales_blurb}
                        </div>
                        {cap && (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: '0.7rem',
                              color: 'var(--red)',
                              fontWeight: 700,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                            }}
                          >
                            Cap · {cap}
                          </div>
                        )}
                      </div>
                      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ fontWeight: 700, color: 'var(--ink)' }}>
                          {formatPriceCents(def.monthly_price_cents)}
                          <span
                            style={{
                              fontWeight: 400,
                              fontSize: '0.78rem',
                              color: 'var(--muted)',
                            }}
                          >
                            /mo
                          </span>
                        </div>
                        <div
                          style={{
                            marginTop: 6,
                            fontSize: '0.66rem',
                            fontWeight: 700,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: active ? 'var(--red)' : 'var(--ink)',
                          }}
                        >
                          {active ? 'In cart' : 'Add'}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* ── Summary rail ──────────────────────────────── */}
        <aside
          style={{
            padding: '1.05rem 1.1rem',
            borderRadius: 12,
            border: '1.5px solid var(--brand-red, var(--red))',
            background: 'linear-gradient(180deg, #fff 0%, #fff5f3 100%)',
            position: compact ? 'static' : 'sticky',
            top: '1rem',
            alignSelf: 'start',
          }}
        >
          <div
            style={{
              fontSize: '0.7rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--brand-red, var(--red))',
            }}
          >
            Your monthly
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.3rem',
              marginTop: '0.25rem',
            }}
          >
            <span
              style={{
                fontSize: '2.4rem',
                fontWeight: 800,
                color: 'var(--ink)',
                lineHeight: 1,
                letterSpacing: '-0.02em',
              }}
            >
              {formatPriceCents(pricing.monthly_cents)}
            </span>
            <span style={{ color: 'var(--muted)' }}>/ mo</span>
          </div>
          <p
            style={{
              margin: '0.35rem 0 0',
              fontSize: '0.72rem',
              color: 'var(--muted)',
            }}
          >
            + custom one-time build fee, quoted on the call
          </p>

          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: '0.85rem 0 0',
              fontSize: '0.85rem',
            }}
          >
            {pricing.line_items.map((li) => (
              <li
                key={li.key}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '0.5rem 0',
                  borderBottom: '1px dashed var(--line, #e6e1d8)',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ flex: 1, paddingRight: 8 }}>{li.label}</span>
                <strong>{formatPriceCents(li.monthly_price_cents)}</strong>
              </li>
            ))}
          </ul>

          {pricing.warnings.length > 0 && (
            <div
              style={{
                marginTop: '0.7rem',
                padding: '0.55rem 0.7rem',
                background: '#fff5f3',
                border: '1px solid var(--red)',
                borderRadius: 8,
                fontSize: '0.78rem',
                color: 'var(--ink)',
              }}
            >
              {pricing.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          )}

          <div
            style={{
              marginTop: '1rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem',
            }}
          >
            <Link
              className="btn approve"
              href={bookHref}
              style={{ textDecoration: 'none', textAlign: 'center' }}
            >
              {ctaLabel}
            </Link>
            {syncQueryString && (
              <button
                type="button"
                onClick={() => {
                  if (typeof window === 'undefined') return
                  navigator.clipboard
                    ?.writeText(window.location.href)
                    .catch(() => {})
                }}
                style={{
                  cursor: 'pointer',
                  background: 'var(--paper, #fff)',
                  color: 'var(--ink)',
                  border: '1.5px solid var(--ink)',
                  borderRadius: 8,
                  padding: '0.55rem 0.8rem',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  letterSpacing: '0.04em',
                }}
              >
                Copy shareable quote link
              </button>
            )}
          </div>

          <p
            style={{
              margin: '0.85rem 0 0',
              fontSize: '0.7rem',
              color: 'var(--muted)',
              lineHeight: 1.45,
            }}
          >
            Caps reset on the 1st of each month. Hit a cap mid-month and we
            pause that add-on (everything else keeps running) and email you
            to upgrade.
          </p>
        </aside>
      </div>

      <style jsx>{`
        .qc-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 320px);
          gap: 1.2rem;
          margin-top: 1rem;
          align-items: start;
        }
        .qc-grid-compact {
          grid-template-columns: minmax(0, 1fr) minmax(0, 280px);
        }
        @media (max-width: 760px) {
          .qc-grid,
          .qc-grid-compact {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// BaseBuildCard — required, always-on, ink-bordered
// ─────────────────────────────────────────────────────────────────────────

function BaseBuildCard({ padding }: { padding: string }) {
  const def = ADDON_CATALOG.base_build
  return (
    <div
      style={{
        border: '1.5px solid var(--ink)',
        borderRadius: 10,
        padding,
        background: 'var(--paper-alt, #f7f4ef)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: '0.5rem',
          marginBottom: '0.5rem',
        }}
      >
        <div>
          <span
            style={{
              fontSize: '0.62rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--red)',
              marginRight: 8,
            }}
          >
            Required
          </span>
          <strong style={{ color: 'var(--ink)' }}>{def.label}</strong>
        </div>
        <div style={{ fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {formatPriceCents(def.monthly_price_cents)}
          <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--muted)' }}>
            /mo
          </span>
        </div>
      </div>
      <p style={{ margin: 0, fontSize: '0.86rem', color: 'var(--ink)' }}>
        {def.description}
      </p>
      <ul
        style={{
          margin: '0.55rem 0 0',
          paddingLeft: '1.1rem',
          fontSize: '0.78rem',
          color: 'var(--muted)',
          lineHeight: 1.55,
        }}
      >
        {def.whats_included.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// ScaleSlider — estimates monthly appointment + roleplay-minute volume so
// the recommended Lite vs Pro tier highlights itself.
// ─────────────────────────────────────────────────────────────────────────

function ScaleSlider({
  scaleAppts,
  setScaleAppts,
  scaleRpMin,
  setScaleRpMin,
}: {
  scaleAppts: number
  setScaleAppts: (n: number) => void
  scaleRpMin: number
  setScaleRpMin: (n: number) => void
}) {
  return (
    <div
      style={{
        border: '1.5px solid var(--ink)',
        borderRadius: 10,
        padding: '0.95rem 1rem',
        background: 'var(--paper, #fff)',
      }}
    >
      <div
        style={{
          fontSize: '0.66rem',
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--ink)',
          marginBottom: 8,
        }}
      >
        Sliders · scale your build
      </div>

      <SliderRow
        label="Appointments confirmed / month"
        min={0}
        max={400}
        step={10}
        value={scaleAppts}
        onChange={setScaleAppts}
        marker={SCALE_PRO_APPT_THRESHOLD}
        markerLabel="Pro tier ↑"
        hint={
          scaleAppts >= SCALE_PRO_APPT_THRESHOLD
            ? 'AI Dialer Pro recommended (300 appts/mo cap).'
            : 'AI Dialer Lite covers you (100 appts/mo cap).'
        }
      />

      <div style={{ height: 12 }} />

      <SliderRow
        label="Roleplay minutes / month"
        min={0}
        max={1200}
        step={20}
        value={scaleRpMin}
        onChange={setScaleRpMin}
        marker={SCALE_PRO_ROLEPLAY_THRESHOLD}
        markerLabel="Pro tier ↑"
        hint={
          scaleRpMin >= SCALE_PRO_ROLEPLAY_THRESHOLD
            ? 'Roleplay Pro recommended (1,000 min/mo, org-wide pool).'
            : 'Roleplay Lite covers you (300 min/mo, org-wide pool).'
        }
      />
    </div>
  )
}

function SliderRow({
  label,
  min,
  max,
  step,
  value,
  onChange,
  marker,
  markerLabel,
  hint,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (n: number) => void
  marker: number
  markerLabel: string
  hint: string
}) {
  const pct = ((value - min) / (max - min)) * 100
  const markerPct = ((marker - min) / (max - min)) * 100
  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontSize: '0.82rem',
          color: 'var(--ink)',
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        <span>{label}</span>
        <span style={{ color: 'var(--red)', fontWeight: 700 }}>
          {value.toLocaleString()}
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={label}
          style={{
            width: '100%',
            accentColor: 'var(--red, #ff2800)',
            margin: 0,
          }}
        />
        {/* Marker tick for Pro threshold */}
        <div
          style={{
            position: 'absolute',
            left: `calc(${markerPct}% - 1px)`,
            top: '100%',
            width: 2,
            height: 8,
            background: 'var(--ink)',
            opacity: 0.5,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `calc(${markerPct}% - 28px)`,
            top: 'calc(100% + 10px)',
            fontSize: '0.62rem',
            color: 'var(--muted)',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {markerLabel}
        </div>
      </div>
      <p
        style={{
          margin: '24px 0 0',
          fontSize: '0.75rem',
          color: pct >= markerPct ? 'var(--red)' : 'var(--muted)',
          fontWeight: pct >= markerPct ? 700 : 500,
        }}
      >
        {hint}
      </p>
    </div>
  )
}
