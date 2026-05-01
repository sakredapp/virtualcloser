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
import {
  AI_DIALER_CENTS_PER_MIN,
  ROLEPLAY_CENTS_PER_MIN,
  DIALER_MAX_STEP,
  DIALER_STEP,
  ROLEPLAY_MAX_STEP,
  ROLEPLAY_STEP,
  dialerMonthlyCents,
  roleplayMonthlyCents,
  approxAppts,
} from '@/lib/minutePricing'

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

// Cart → plain-text summary that lands in the Cal.com booking confirmation
// email under "Additional notes". Lets us see the exact build the prospect
// configured the moment we get the booking ping.
function buildSummaryText(
  cart: AddonKey[],
  mrrCents: number,
  dialerMin: number,
  roleplayMin: number,
): string {
  const lines: string[] = []
  lines.push('Virtual Closer build request')
  lines.push('')
  lines.push(`Monthly: ${formatPriceCents(mrrCents)}/mo (+ one-time build fee, quoted on call)`)
  lines.push('')
  lines.push('Cart:')
  for (const key of cart) {
    const def = ADDON_CATALOG[key]
    if (!def) continue
    const cap = formatCap(def)
    lines.push(
      `  • ${def.label} — ${formatPriceCents(def.monthly_price_cents)}/mo` +
        (cap ? ` (cap ${cap})` : ''),
    )
  }
  if (dialerMin > 0) {
    lines.push(
      `  • AI Dialer — ${dialerMin} min/mo cap (≈ ${approxAppts(dialerMin)} confirmed appts) — ${formatPriceCents(dialerMonthlyCents(dialerMin))}/mo`,
    )
  }
  if (roleplayMin > 0) {
    lines.push(
      `  • AI Roleplay — ${roleplayMin} min/mo cap — ${formatPriceCents(roleplayMonthlyCents(roleplayMin))}/mo`,
    )
  }
  return lines.join('\n')
}

function bookingHref(opts: {
  cart: AddonKey[]
  mrrCents: number
  dialerMin: number
  roleplayMin: number
}): string {
  try {
    const url = new URL(CAL_BOOKING_URL)
    url.searchParams.set('metadata[mode]', 'individual')
    url.searchParams.set('metadata[cart]', opts.cart.join(','))
    url.searchParams.set('metadata[mrr_cents]', String(opts.mrrCents))
    if (opts.dialerMin > 0) {
      url.searchParams.set('metadata[dialer_min_cap]', String(opts.dialerMin))
      // Telemetry counts confirmed appts (≈3 min each), so we also surface
      // the appts-equivalent so admin can set client_addons.cap_value
      // (which is in the catalog cap_unit = appts_confirmed) directly.
      url.searchParams.set(
        'metadata[dialer_appts_cap_equiv]',
        String(approxAppts(opts.dialerMin)),
      )
    }
    if (opts.roleplayMin > 0) {
      url.searchParams.set('metadata[roleplay_min_cap]', String(opts.roleplayMin))
    }
    url.searchParams.set(
      'notes',
      buildSummaryText(opts.cart, opts.mrrCents, opts.dialerMin, opts.roleplayMin),
    )
    return url.toString()
  } catch {
    return CAL_BOOKING_URL
  }
}

// Slider thresholds — when "estimated monthly appointments" crosses these,
// the Pro variant becomes the recommended pick. Mirrors caps in addons.ts.
// (Currently unused since we moved to per-minute pricing — keep for any future
//  tier-based recommendation work.)

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
  /**
   * Categories to hide. Defaults to `['team', 'dialer', 'voice_training']`
   * because this cart is for individual quotes — team is enterprise-only,
   * and dialer/roleplay are now sold by the minute via the dedicated
   * minute-pricing panel below the catalog.
   */
  excludeCategories?: AddonCategory[]
  /**
   * Optional external monthly cost added to the cart total. Used by the
   * AI SDR pricing calculator on /offer to flow the slider-driven SDR
   * monthly into the "Build your quote" total + show as a line item.
   */
  extraMonthlyCents?: number
  /** Label for the external line item (only shown when extraMonthlyCents > 0). */
  extraLineLabel?: string
  /** Optional sub-line describing the external item. */
  extraLineSub?: string
}

export default function QuoteCart({
  syncQueryString = false,
  compact = false,
  heading = 'Available add-ons',
  subheading = 'Base build is required — that\'s your AI employee. Everything else is à la carte. Toggle what fits, see your monthly. We\'ll quote the one-time build fee on the call.',
  ctaHref,
  ctaLabel = 'Book a call with this quote',
  excludeCategories = ['team', 'dialer', 'voice_training'],
  extraMonthlyCents = 0,
  extraLineLabel,
  extraLineSub,
}: QuoteCartProps) {
  const all = useMemo(
    () => publicAddons().filter((a) => !excludeCategories.includes(a.category)),
    [excludeCategories],
  )

  const [cart, setCart] = useState<Set<AddonKey>>(new Set())
  // Per-minute caps the customer is buying. These convert directly to
  // `client_addons.cap_value` when admin finalizes the build. 0 = not selected.
  const [dialerMin, setDialerMin] = useState<number>(0)
  const [roleplayMin, setRoleplayMin] = useState<number>(0)
  // Toast state for the copy-link button so users get visible confirmation.
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle')
  const [drawerOpen, setDrawerOpen] = useState(false)

  // ── Hydrate from URL params on mount ───────────────────────────────────
  // Reads ?cart=, ?dialer_min=, ?roleplay_min= so a shared link restores
  // the full configuration the sender had (including minute-slider values).
  useEffect(() => {
    if (!syncQueryString || typeof window === 'undefined') return
    const sp = new URLSearchParams(window.location.search)

    const raw = sp.get('cart')
    if (raw) {
      const keys = raw
        .split(',')
        .filter((k): k is AddonKey => k in ADDON_CATALOG)
        .filter((k) => !excludeCategories.includes(ADDON_CATALOG[k].category))
      if (keys.length > 0) setCart(new Set(keys))
    }

    const dm = parseInt(sp.get('dialer_min') ?? '0', 10)
    if (dm > 0) setDialerMin(Math.min(dm, DIALER_MAX_STEP))

    const rm = parseInt(sp.get('roleplay_min') ?? '0', 10)
    if (rm > 0) setRoleplayMin(Math.min(rm, ROLEPLAY_MAX_STEP))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // run once on mount — syncQueryString/excludeCategories are stable props

  // ── Persist full cart state back to URL ──────────────────────────────────
  // Tracks catalog add-ons, dialer minutes, and roleplay minutes so
  // window.location.href is always a shareable link with the full config.
  useEffect(() => {
    if (!syncQueryString || typeof window === 'undefined') return
    const sp = new URLSearchParams()
    const keys = Array.from(cart).filter((k) => k !== 'base_build')
    if (keys.length > 0) sp.set('cart', keys.join(','))
    if (dialerMin > 0) sp.set('dialer_min', String(dialerMin))
    if (roleplayMin > 0) sp.set('roleplay_min', String(roleplayMin))
    const qs = sp.toString()
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [cart, dialerMin, roleplayMin, syncQueryString])

  const pricing = useMemo(() => priceCart(Array.from(cart)), [cart])

  // Per-minute add-ons live OUTSIDE the catalog priceCart() math. Compose
  // their monthly cents and add to the rail total + line items. The
  // extraMonthlyCents prop carries the AI SDR slider's monthly so the
  // "Build your quote" rail reflects what the customer is actually buying.
  const dialerCents = useMemo(() => dialerMonthlyCents(dialerMin), [dialerMin])
  const roleplayCents = useMemo(() => roleplayMonthlyCents(roleplayMin), [roleplayMin])
  const totalMonthlyCents =
    pricing.monthly_cents + dialerCents + roleplayCents + (extraMonthlyCents ?? 0)

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

  const cartArrayWithBase: AddonKey[] = [
    'base_build',
    ...Array.from(cart).filter((k) => k !== 'base_build'),
  ]
  const bookHref =
    ctaHref ??
    bookingHref({
      cart: cartArrayWithBase,
      mrrCents: totalMonthlyCents,
      dialerMin,
      roleplayMin,
    })

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
        Available add-ons
      </h2>

      <div className={compact ? 'qc-grid qc-grid-compact' : 'qc-grid'}>
        {/* ── Cart inputs ──────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Legacy MinutePricingPanel (dialer + roleplay sliders) is gone.
              Dialer is sold via the AI SDR hero card above; roleplay is
              sold via the AI Trainer hero card. The dialerMin/roleplayMin
              state stays at 0 so cart math is unaffected and any stale
              ?dialer_min= / ?roleplay_min= URL params hydrate harmlessly. */}

          <BaseBuildCard padding={cardListPadding} />

          {CATEGORY_ORDER.filter((c) => grouped[c]?.length).map((cat) => {
            const items = grouped[cat]!
            const activeCount = items.filter((def) => cart.has(def.key)).length
            // Auto-open any section the user has already added items to
            // so they can see what they picked at a glance.
            return (
              <details
                key={cat}
                open={activeCount > 0}
                className="qc-cat"
                style={{
                  border: '1px solid var(--border-soft)',
                  borderRadius: 10,
                  padding: '0.7rem 0.85rem',
                  background: 'var(--paper, #fff)',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    margin: 0,
                    fontSize: '0.74rem',
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: 'var(--ink)',
                    fontWeight: 700,
                    paddingBottom: 0,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    listStyle: 'none',
                  }}
                >
                  <span>
                    {CATEGORY_LABELS[cat]}
                    {activeCount > 0 && (
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: '0.6rem',
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: 'var(--red)',
                          color: '#fff',
                          letterSpacing: '0.08em',
                        }}
                      >
                        {activeCount} in cart
                      </span>
                    )}
                  </span>
                  <span aria-hidden style={{ fontSize: '0.7rem', opacity: 0.6 }}>
                    ▾
                  </span>
                </summary>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                  {items.map((def) => {
                    const active = cart.has(def.key)
                    const cap = formatCap(def)
                    const recommended = false
                    const hasDetails = Array.isArray(def.whats_included) && def.whats_included.length > 0
                    return (
                      <div
                        key={def.key}
                        style={{
                          border:
                            '1.5px solid ' +
                            (active
                              ? 'var(--red)'
                              : recommended
                                ? 'var(--ink)'
                                : 'var(--line, #e6e1d8)'),
                          background: active ? '#fff5f3' : 'var(--paper, #fff)',
                          borderRadius: 10,
                          overflow: 'hidden',
                          boxShadow: active
                            ? '0 2px 8px rgba(255,40,0,0.12)'
                            : 'none',
                          transition:
                            'border-color 120ms ease, background 120ms ease, box-shadow 120ms ease',
                        }}
                      >
                        {/* Toggle row */}
                        <button
                          type="button"
                          onClick={() => toggle(def.key)}
                          aria-pressed={active}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            cursor: 'pointer',
                            background: 'transparent',
                            border: 'none',
                            borderRadius: 0,
                            padding: cardListPadding,
                            display: 'grid',
                            gridTemplateColumns: '22px 1fr auto',
                            gap: '0.85rem',
                            alignItems: 'start',
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

                        {/* Expandable capabilities — only for addons that declare whats_included */}
                        {hasDetails && (
                          <details
                            onClick={(e) => e.stopPropagation()}
                            className="qc-addon-details"
                            style={{ borderTop: '1px solid var(--border-soft)' }}
                          >
                            <summary
                              style={{
                                cursor: 'pointer',
                                padding: '0.42rem 1rem',
                                fontSize: '0.71rem',
                                fontWeight: 700,
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                                color: 'var(--ink)',
                                listStyle: 'none',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 7,
                                userSelect: 'none',
                                WebkitUserSelect: 'none',
                              }}
                            >
                              <span
                                className="qc-addon-arrow"
                                aria-hidden
                                style={{
                                  display: 'inline-block',
                                  fontSize: '0.55rem',
                                  color: 'var(--red)',
                                  transition: 'transform 140ms ease',
                                }}
                              >
                                ▶
                              </span>
                              What&rsquo;s included
                            </summary>
                            <ul
                              style={{
                                margin: 0,
                                padding: '0.35rem 1rem 0.9rem 1rem',
                                listStyle: 'none',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.32rem',
                              }}
                            >
                              {def.whats_included!.map((item, i) => (
                                <li
                                  key={i}
                                  style={{
                                    fontSize: '0.8rem',
                                    color: 'var(--muted)',
                                    lineHeight: 1.5,
                                    display: 'flex',
                                    gap: '0.5rem',
                                    alignItems: 'baseline',
                                  }}
                                >
                                  <span aria-hidden style={{ color: 'var(--red)', flexShrink: 0, fontSize: '0.65rem', lineHeight: 1.5 }}>✓</span>
                                  {item}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                  )
                })}
              </div>
            </details>
            )
          })}
        </div>

        {/* ── Summary rail — now a slide-up drawer toggled by the
              floating bottom bar. Always rendered (so the click handler
              is wired) but hidden via transform when drawerOpen=false. */}
        {drawerOpen && (
          <div
            className="qc-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
        )}
        <aside
          className={`qc-drawer ${drawerOpen ? 'qc-drawer-open' : ''}`}
          aria-hidden={!drawerOpen}
          style={{
            padding: '1.5rem 1.5rem 2rem',
            borderRadius: '20px 20px 0 0',
            border: '1px solid var(--border-soft)',
            background: '#fff',
            boxShadow: '0 -16px 48px rgba(15,15,15,0.18)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <span style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--red)' }}>
              Your cart
            </span>
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close cart"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: 'var(--text-meta)', lineHeight: 1, padding: 4 }}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '0.3rem',
            }}
          >
            <span
              style={{
                fontSize: '2.4rem',
                fontWeight: 700,
                color: 'var(--ink)',
                lineHeight: 1,
                letterSpacing: '-0.02em',
              }}
            >
              {formatPriceCents(totalMonthlyCents)}
            </span>
            <span style={{ color: 'var(--text-meta)' }}>/ mo</span>
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
            {extraMonthlyCents > 0 && extraLineLabel && (
              <li
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '0.5rem 0',
                  borderBottom: '1px dashed var(--line, #e6e1d8)',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ flex: 1, paddingRight: 8 }}>
                  <span>{extraLineLabel}</span>
                  {extraLineSub && (
                    <span style={{ display: 'block', fontSize: '0.72rem', color: 'var(--muted)', marginTop: 2 }}>
                      {extraLineSub}
                    </span>
                  )}
                </span>
                <strong>{formatPriceCents(extraMonthlyCents)}</strong>
              </li>
            )}
            {dialerMin > 0 && (
              <li
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '0.5rem 0',
                  borderBottom: '1px dashed var(--line, #e6e1d8)',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ flex: 1, paddingRight: 8 }}>
                  AI Dialer · {dialerMin} min/mo cap
                </span>
                <strong>{formatPriceCents(dialerCents)}</strong>
              </li>
            )}
            {roleplayMin > 0 && (
              <li
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  padding: '0.5rem 0',
                  borderBottom: '1px dashed var(--line, #e6e1d8)',
                  color: 'var(--ink)',
                }}
              >
                <span style={{ flex: 1, paddingRight: 8 }}>
                  AI Roleplay · {roleplayMin} min/mo cap
                </span>
                <strong>{formatPriceCents(roleplayCents)}</strong>
              </li>
            )}
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
                  // Build the URL from current state so it's always correct,
                  // regardless of whether replaceState has run yet.
                  const sp = new URLSearchParams()
                  const keys = Array.from(cart).filter((k) => k !== 'base_build')
                  if (keys.length > 0) sp.set('cart', keys.join(','))
                  if (dialerMin > 0) sp.set('dialer_min', String(dialerMin))
                  if (roleplayMin > 0) sp.set('roleplay_min', String(roleplayMin))
                  const qs = sp.toString()
                  const url =
                    window.location.origin +
                    window.location.pathname +
                    (qs ? `?${qs}` : '')
                  const done = () => {
                    setCopyState('ok')
                    window.setTimeout(() => setCopyState('idle'), 2000)
                  }
                  const fail = () => {
                    setCopyState('err')
                    window.setTimeout(() => setCopyState('idle'), 2500)
                  }
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(url).then(done).catch(fail)
                  } else {
                    fail()
                  }
                }}
                title="Copies the current page URL with your selected add-ons baked in (?cart=...). Send it to anyone and they'll see this same configuration + price."
                style={{
                  cursor: 'pointer',
                  background:
                    copyState === 'ok' ? 'var(--red)' : 'var(--paper, #fff)',
                  color: copyState === 'ok' ? '#fff' : 'var(--ink)',
                  border:
                    '1.5px solid ' +
                    (copyState === 'ok' ? 'var(--red)' : 'var(--ink)'),
                  borderRadius: 8,
                  padding: '0.55rem 0.8rem',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  letterSpacing: '0.04em',
                  transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
                }}
              >
                {copyState === 'ok'
                  ? 'Link copied — paste anywhere'
                  : copyState === 'err'
                    ? 'Couldn\'t copy — select the URL bar instead'
                    : 'Copy shareable quote link'}
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
        /* Cart inputs now span full width — the summary lives in a drawer */
        .qc-grid {
          display: block;
          margin-top: 1rem;
        }
        .qc-grid-compact {
          display: block;
        }
        @media (max-width: 760px) {
          .qc-grid,
          .qc-grid-compact {
            grid-template-columns: 1fr;
          }
        }
        /* Rotate arrow when details is open */
        .qc-addon-details[open] .qc-addon-arrow {
          transform: rotate(90deg);
        }
        /* Remove default webkit disclosure triangle */
        .qc-addon-details > summary::-webkit-details-marker {
          display: none;
        }
        .qc-addon-details > summary::marker {
          display: none;
        }
        .qc-base-build > summary::-webkit-details-marker { display: none; }
        .qc-base-build > summary::marker { display: none; }
        .qc-base-build[open] > summary .qc-base-chevron { transform: rotate(180deg); }

        /* Floating cart bar — always visible bottom on every viewport. */
        .qc-float {
          position: fixed;
          bottom: 0;
          left: 0;
          right: 0;
          z-index: 40;
          background: var(--ink);
          color: #fff;
          padding: 14px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          box-shadow: 0 -8px 24px rgba(0,0,0,0.18);
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .qc-float-cta {
          background: var(--red);
          color: #fff;
          padding: 0 22px;
          min-height: 48px;
          border-radius: 999px;
          font-weight: 700;
          font-size: 14px;
          text-decoration: none;
          white-space: nowrap;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: none;
          cursor: pointer;
          font-family: inherit;
        }
        @media (max-width: 560px) {
          .qc-float { padding: 12px 16px; gap: 10px; }
          .qc-float-cta { padding: 0 18px; font-size: 13px; }
          .qc-float-total { font-size: 18px !important; }
          .qc-float-kicker { font-size: 10px !important; }
        }

        /* Slide-up drawer for the cart breakdown. Hidden by default
           (translated below the viewport). When .qc-drawer-open it
           slides up to sit just above the floating bar. */
        .qc-drawer {
          position: fixed;
          left: 0;
          right: 0;
          bottom: 76px; /* leaves the floating bar visible above */
          max-height: calc(100vh - 100px);
          overflow-y: auto;
          z-index: 41;
          transform: translateY(110%);
          transition: transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
          margin: 0 auto;
          width: min(640px, 100%);
        }
        .qc-drawer.qc-drawer-open { transform: translateY(0); }
        .qc-drawer-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(15,15,15,0.45);
          z-index: 40;
          animation: qc-fade 200ms ease;
        }
        @keyframes qc-fade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @media (max-width: 720px) {
          .qc-drawer { bottom: 70px; max-height: 80vh; border-radius: 20px 20px 0 0; }
        }

        /* Bottom safety so inline content isn't hidden behind the bar. */
        body { padding-bottom: 88px; }
      `}</style>

      {/* Floating "always-visible" running total bar. Tap → drawer slides up. */}
      <div className="qc-float">
        <div style={{ minWidth: 0 }}>
          <div className="qc-float-kicker" style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Your monthly
          </div>
          <div className="qc-float-total" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1, marginTop: 2, letterSpacing: '-0.01em' }}>
            {formatPriceCents(totalMonthlyCents)}
            <span style={{ fontSize: 14, opacity: 0.7, fontWeight: 400 }}> /mo</span>
          </div>
        </div>
        <button
          type="button"
          className="qc-float-cta"
          onClick={() => setDrawerOpen((v) => !v)}
          aria-expanded={drawerOpen}
        >
          {drawerOpen ? 'Close ▾' : 'Review cart ▴'}
        </button>
      </div>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// BaseBuildCard — required, always-on, ink-bordered
// ─────────────────────────────────────────────────────────────────────────

function BaseBuildCard({ padding }: { padding: string }) {
  const def = ADDON_CATALOG.base_build
  return (
    <details
      className="qc-base-build"
      style={{
        border: '1px solid var(--border-soft)',
        borderRadius: 12,
        padding,
        background: 'var(--paper)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '0.62rem',
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              fontWeight: 700,
              color: 'var(--red)',
            }}
          >
            Required
          </span>
          <strong style={{ color: 'var(--ink)' }}>{def.label}</strong>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>
            {formatPriceCents(def.monthly_price_cents)}
            <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--text-meta)' }}>
              /mo
            </span>
          </span>
          <span aria-hidden className="qc-base-chevron" style={{ color: 'var(--red)', fontSize: 14, transition: 'transform 160ms' }}>
            ▾
          </span>
        </div>
      </summary>
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-soft)' }}>
        <p style={{ margin: 0, fontSize: '0.92rem', color: 'var(--ink)', lineHeight: 1.65 }}>
          {def.description}
        </p>
        <ul
          style={{
            margin: '0.7rem 0 0',
            paddingLeft: '1.1rem',
            fontSize: '0.86rem',
            color: 'var(--text-meta)',
            lineHeight: 1.65,
          }}
        >
          {def.whats_included.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </details>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// MinutePricingPanel — two sliders (AI Dialer minutes, Roleplay minutes).
// Customer picks a hard cap; price is linear (cents-per-min × minutes). The
// chosen cap is what gets written to client_addons.cap_value when admin
// finalizes the build, so what they pick is what they actually get capped at.
// ─────────────────────────────────────────────────────────────────────────

/**
 * Roleplay minute pricing panel. The AI dialer used to share this panel
 * but is now sold via the dedicated SDR pricing calculator above the cart
 * (hours/wk × $/hr × 4.3 weeks/mo) — the dialerMin slider is gone here.
 * The dialerMin state in the parent stays as 0 so cart math stays
 * consistent; stale ?dialer_min= URL params hydrate harmlessly.
 */
function MinutePricingPanel({
  roleplayMin,
  setRoleplayMin,
}: {
  dialerMin: number
  setDialerMin: (n: number) => void
  roleplayMin: number
  setRoleplayMin: (n: number) => void
}) {
  return (
    <div
      style={{
        border: '2px solid var(--red, #ff2800)',
        borderRadius: 12,
        padding: '1.05rem 1.1rem',
        background: 'var(--paper, #fff)',
        boxShadow: '0 6px 20px rgba(255, 40, 0, 0.08)',
      }}
    >
      <div
        style={{
          fontSize: '0.7rem',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          fontWeight: 800,
          color: 'var(--red, #ff2800)',
          marginBottom: 6,
        }}
      >
        Roleplay · pick your monthly minutes
      </div>
      <p
        style={{
          margin: '0 0 14px',
          fontSize: '0.84rem',
          color: 'var(--ink)',
          lineHeight: 1.5,
        }}
      >
        Practice mode runs on metered voice minutes — pick a monthly cap
        and your bill is just minutes × rate. Set to zero to skip.
      </p>

      <SliderRow
        label="Roleplay minutes / month"
        min={0}
        max={ROLEPLAY_MAX_STEP}
        step={ROLEPLAY_STEP}
        value={roleplayMin}
        onChange={setRoleplayMin}
        priceCents={roleplayMonthlyCents(roleplayMin)}
        rateLabel={`$${(ROLEPLAY_CENTS_PER_MIN / 100).toFixed(2)}/min`}
        hint={
          roleplayMin === 0
            ? 'Skip Roleplay for now — you can add it later.'
            : `That's roughly ${Math.round(roleplayMin / 15).toLocaleString()} × 15-min sessions or ${Math.round(roleplayMin / 30).toLocaleString()} × 30-min sessions per month.`
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
  priceCents,
  rateLabel,
  hint,
}: {
  label: string
  min: number
  max: number
  step: number
  value: number
  onChange: (n: number) => void
  priceCents: number
  rateLabel: string
  hint: string
}) {
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
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <span>{label}</span>
        <span style={{ color: 'var(--red)', fontWeight: 700 }}>
          {value.toLocaleString()} min · {formatPriceCents(priceCents)}/mo
        </span>
      </div>
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
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginTop: 4,
          gap: 8,
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: '0.75rem',
            color: 'var(--muted)',
            flex: 1,
          }}
        >
          {hint}
        </p>
        <span
          style={{
            fontSize: '0.7rem',
            color: 'var(--ink)',
            fontWeight: 700,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
          }}
        >
          {rateLabel}
        </span>
      </div>
    </div>
  )
}

