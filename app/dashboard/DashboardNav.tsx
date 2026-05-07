'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, useEffect, useRef } from 'react'
import type { UpgradeOption } from './dashboardTabs'

export type DashboardNavTab = {
  href: string
  label: string
  matchPrefixes?: string[]
  /** @deprecated kept for back-compat; new design always renders unlocked tabs. */
  unlocked?: boolean
  /** @deprecated unused now that locked features render via the Upgrade modal. */
  lockedHref?: string
}

// ── Nav tab visibility (per-browser, localStorage) ────────────────────────

const HIDDEN_KEY = 'vc:hidden_nav_tabs'

function loadHidden(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveHidden(s: Set<string>) {
  try {
    localStorage.setItem(HIDDEN_KEY, JSON.stringify([...s]))
  } catch { /* storage full / blocked */ }
}

// ── Component ─────────────────────────────────────────────────────────────

export default function DashboardNav({
  tabs,
  lockedAddons = [],
}: {
  tabs: DashboardNavTab[]
  lockedAddons?: UpgradeOption[]
}) {
  const pathname = usePathname() ?? '/dashboard'
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const popoverRef = useRef<HTMLDivElement>(null)

  // Load after mount to avoid SSR hydration mismatch
  useEffect(() => { setHidden(loadHidden()) }, [])

  // Click-outside closes the popover
  useEffect(() => {
    if (!customizeOpen) return
    function onMouseDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setCustomizeOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [customizeOpen])

  function toggleHide(href: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(href)) next.delete(href)
      else next.add(href)
      saveHidden(next)
      return next
    })
  }

  const visibleTabs = tabs.filter((t) => !hidden.has(t.href))
  const hiddenCount = hidden.size

  return (
    <nav className="dash-nav" aria-label="Dashboard sections">
      <div className="dash-nav-row">
        {visibleTabs.map((t) => {
          const matches = t.matchPrefixes ?? [t.href]
          const isActive = matches.some((p) =>
            p === '/dashboard' ? pathname === p : pathname === p || pathname.startsWith(p + '/'),
          )
          return (
            <Link
              key={t.href + t.label}
              href={t.href}
              className={['dash-tab', isActive ? 'dash-tab-active' : ''].filter(Boolean).join(' ')}
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

        {/* ── Customize pill ── */}
        <div ref={popoverRef} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setCustomizeOpen((o) => !o)}
            className="dash-tab"
            aria-label="Customize visible pages"
            style={{ opacity: customizeOpen ? 1 : 0.45, fontSize: 13, gap: 4, display: 'flex', alignItems: 'center' }}
          >
            <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>⊕</span>
            {hiddenCount > 0 && (
              <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--red,#ff2800)', color: '#fff', borderRadius: 999, padding: '0 5px', lineHeight: '17px' }}>
                {hiddenCount}
              </span>
            )}
          </button>

          {customizeOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                background: 'var(--paper, #fff)',
                border: '1px solid var(--border-soft)',
                borderRadius: 12,
                padding: '12px 14px',
                zIndex: 40,
                minWidth: 260,
                boxShadow: '0 12px 32px rgba(0,0,0,0.14)',
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 10 }}>
                Visible pages
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {tabs.map((t) => {
                  const on = !hidden.has(t.href)
                  return (
                    <button
                      key={t.href}
                      type="button"
                      onClick={() => toggleHide(t.href)}
                      style={{
                        border: '1.5px solid',
                        borderColor: on ? 'var(--red, #ff2800)' : 'var(--border-soft, #e5e7eb)',
                        background: on ? 'rgba(255,40,0,0.06)' : 'transparent',
                        color: on ? 'var(--red, #ff2800)' : '#9ca3af',
                        borderRadius: 999,
                        padding: '4px 11px',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        lineHeight: 1.5,
                        transition: 'border-color 0.1s, background 0.1s, color 0.1s',
                      }}
                    >
                      {t.label}
                    </button>
                  )
                })}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: '#9ca3af' }}>
                Tap a pill to show/hide. Saved per browser.
              </div>
            </div>
          )}
        </div>
      </div>

      {upgradeOpen && (
        <UpgradeModal options={lockedAddons} onClose={() => setUpgradeOpen(false)} />
      )}
    </nav>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// UpgradeModal — unchanged
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
