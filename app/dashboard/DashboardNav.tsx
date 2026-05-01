'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import type { UpgradeOption } from './dashboardTabs'

/**
 * Unified pill-tab nav for every /dashboard/* page. Mirrors the styling of
 * the public /demo dashboard frame so the real product looks like the
 * marketing screenshot — pills, ink-on-paper, red active state.
 *
 * Missing features are NOT shown as locked pills. Instead, an "+ Upgrade"
 * pill at the end of the row opens a modal listing add-ons the rep could
 * request. Pill styling lives in app/globals.css (.dash-tab block).
 */
export type DashboardNavTab = {
  href: string
  label: string
  matchPrefixes?: string[]
  /** @deprecated kept for back-compat; new design always renders unlocked tabs. */
  unlocked?: boolean
  /** @deprecated unused now that locked features render via the Upgrade modal. */
  lockedHref?: string
}

export default function DashboardNav({
  tabs,
  lockedAddons = [],
}: {
  tabs: DashboardNavTab[]
  lockedAddons?: UpgradeOption[]
}) {
  const pathname = usePathname() ?? '/dashboard'
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  return (
    <nav className="dash-nav" aria-label="Dashboard sections">
      <div className="dash-nav-row">
        {tabs.map((t) => {
          const matches = t.matchPrefixes ?? [t.href]
          const isActive = matches.some((p) =>
            p === '/dashboard' ? pathname === p : pathname === p || pathname.startsWith(p + '/'),
          )
          const className = ['dash-tab', isActive ? 'dash-tab-active' : '']
            .filter(Boolean)
            .join(' ')
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className={className}
              aria-current={isActive ? 'page' : undefined}
            >
              {t.label}
            </Link>
          )
        })}

        {lockedAddons.length > 0 && (
          <button
            type="button"
            onClick={() => setUpgradeOpen(true)}
            className="dash-tab dash-tab-upgrade"
            aria-haspopup="dialog"
          >
            <span aria-hidden style={{ fontSize: 14, lineHeight: 1, marginRight: 4 }}>+</span>
            Upgrade
          </button>
        )}
      </div>

      {upgradeOpen && (
        <UpgradeModal options={lockedAddons} onClose={() => setUpgradeOpen(false)} />
      )}
    </nav>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// UpgradeModal — lists add-ons the tenant doesn't have. "Request" hits a
// server endpoint that emails team@virtualcloser.com so we can turn it on.
// ─────────────────────────────────────────────────────────────────────────

function UpgradeModal({
  options,
  onClose,
}: {
  options: UpgradeOption[]
  onClose: () => void
}) {
  const CAL_URL =
    process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'

  const [requesting, setRequesting] = useState<string | null>(null)
  const [booked, setBooked] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  async function onRequest(key: string) {
    setRequesting(key)
    setError(null)
    try {
      const res = await fetch('/api/me/addon-request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ addon_key: key }),
      })
      if (!res.ok) {
        const txt = await res.text().catch(() => '')
        throw new Error(txt || `request failed (${res.status})`)
      }
      setBooked((s) => new Set(s).add(key))
      window.open(CAL_URL, '_blank', 'noopener,noreferrer')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setRequesting(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add-ons available for your account"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(15,15,15,0.55)',
        backdropFilter: 'blur(4px)',
        zIndex: 50,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '6vh 1rem 2rem',
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          width: 'min(720px, 100%)',
          background: 'var(--paper, #fff)',
          color: 'var(--ink, #0f0f0f)',
          borderRadius: 14,
          border: '1px solid var(--border-soft)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.35)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--border-soft)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: '1rem',
          }}
        >
          <div>
            <p style={{
              fontSize: '0.7rem', letterSpacing: '0.18em', textTransform: 'uppercase',
              fontWeight: 800, color: 'var(--red, #ff2800)', margin: 0,
            }}>
              Available add-ons
            </p>
            <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.2rem', color: 'var(--ink)' }}>
              Add to your build
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              border: '1px solid var(--ink-soft, #e3ddd0)',
              background: 'var(--paper, #fff)',
              color: 'var(--ink)',
              borderRadius: 999, width: 32, height: 32,
              cursor: 'pointer', fontSize: 18, lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {error && (
          <div style={{
            padding: '0.6rem 1.25rem',
            background: '#fff1ed', color: '#7a1500',
            fontSize: '0.85rem',
          }}>
            {error}
          </div>
        )}

        <div style={{
          padding: '1rem 1.25rem',
          display: 'grid', gap: '0.7rem',
        }}>
          {options.map((opt) => {
            const isRequested = booked.has(opt.key)
            const isLoading = requesting === opt.key
            return (
              <article
                key={opt.key}
                style={{
                  border: '1.5px solid var(--line, #e6e1d8)',
                  borderRadius: 10,
                  padding: '0.85rem 1rem',
                  background: 'var(--paper-alt, #f7f4ef)',
                }}
              >
                <header style={{
                  display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
                  gap: '0.8rem', flexWrap: 'wrap',
                }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--ink)' }}>
                      {opt.label}
                    </h3>
                    <p style={{
                      margin: '0.2rem 0 0',
                      fontSize: '0.85rem',
                      color: 'var(--muted, #5a5a5a)',
                      lineHeight: 1.45,
                    }}>
                      {opt.description}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <strong style={{ color: 'var(--ink)' }}>
                      ${(opt.monthly_price_cents / 100).toFixed(0)}
                    </strong>
                    <span style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>/mo</span>
                  </div>
                </header>

                {opt.whats_included.length > 0 && (
                  <details style={{ marginTop: '0.55rem' }}>
                    <summary style={{
                      cursor: 'pointer',
                      fontSize: '0.7rem', fontWeight: 700,
                      letterSpacing: '0.1em', textTransform: 'uppercase',
                      color: 'var(--ink)',
                      listStyle: 'none',
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                    }}>
                      <span aria-hidden style={{ fontSize: '0.55rem', color: 'var(--red)' }}>▶</span>
                      What&rsquo;s included
                    </summary>
                    <ul style={{
                      margin: '0.4rem 0 0', padding: 0, listStyle: 'none',
                      display: 'grid', gap: '0.3rem',
                    }}>
                      {opt.whats_included.map((line, i) => (
                        <li key={i} style={{
                          fontSize: '0.83rem', color: 'var(--muted)',
                          display: 'flex', gap: '0.45rem', alignItems: 'baseline',
                          lineHeight: 1.45,
                        }}>
                          <span aria-hidden style={{ color: 'var(--red)', fontSize: '0.65rem' }}>✓</span>
                          {line}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                <div style={{ marginTop: '0.7rem' }}>
                  <button
                    type="button"
                    onClick={() => !isRequested && !isLoading && onRequest(opt.key)}
                    disabled={isRequested || isLoading}
                    className="btn approve"
                    style={{
                      padding: '0.45rem 0.9rem',
                      fontSize: '0.82rem',
                      opacity: isRequested ? 0.7 : 1,
                      cursor: isRequested ? 'default' : 'pointer',
                    }}
                  >
                    {isRequested ? 'Booked ✓' : isLoading ? 'Opening…' : 'Book a call'}
                  </button>
                </div>
              </article>
            )
          })}
        </div>

        <div style={{
          padding: '0.75rem 1.25rem',
          borderTop: '1px solid var(--border-soft)',
          fontSize: '0.78rem', color: 'var(--muted)',
        }}>
          Book a 15-min call and we&rsquo;ll turn it on same day.
        </div>
      </div>
    </div>
  )
}
