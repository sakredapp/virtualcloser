'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import type { DashboardNavTab } from '@/app/dashboard/DashboardNav'
import type { UpgradeOption } from '@/app/dashboard/dashboardTabs'
import type { BrandKey } from '@/lib/brand'
import { UpgradeModal } from '@/app/dashboard/DashboardNav'

// Brand-aware logo + label. Kept inline (not imported from lib/brand.ts)
// because that module imports next/headers and can't be loaded into the
// client bundle. Mirrors the registry in AppTopbar — update both if a
// brand is added.
const BRAND_VC = {
  name: 'Virtual Closer',
  logo:
    'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/Virtual%20(1024%20x%201024%20px).png',
}
const BRAND_CXO = {
  name: 'CXO Suite',
  logo:
    'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/cxo%20logo/CXO%20Suite.png',
}
function brandFromHost(host: string): typeof BRAND_VC {
  const clean = host.split(':')[0].toLowerCase()
  if (clean.endsWith('suitecxo.com')) return BRAND_CXO
  return BRAND_VC
}

const PUBLIC_PATHS = ['/', '/offer', '/login', '/privacy', '/terms', '/demo', '/welcome', '/logout']

// Per-browser nav prefs (shared keys with the legacy pill nav so existing
// hide choices carry over).
const HIDDEN_KEY = 'vc:hidden_nav_tabs'
const COLLAPSED_KEY = 'vc:sidebar_collapsed'

/** Does the current path fall under a tab's route(s)? `/dashboard` matches
 *  exactly (it's the prefix of everything else); all others match the path
 *  itself or any sub-path. */
function tabMatches(t: DashboardNavTab, pathname: string): boolean {
  const matches = t.matchPrefixes ?? [t.href]
  return matches.some((p) =>
    p === '/dashboard' ? pathname === p : pathname === p || pathname.startsWith(p + '/'),
  )
}

function loadHidden(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(HIDDEN_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

export default function DashboardShell({
  tabs,
  lockedAddons = [],
  brandKey,
  children,
}: {
  tabs: DashboardNavTab[]
  lockedAddons?: UpgradeOption[]
  /** Authoritative brand from the tenant. Falls back to host detection when
   *  absent (e.g. public surfaces). Fixes CXO tenants showing the VC logo when
   *  reached on a non-suitecxo host (admin "view portal" → *.virtualcloser.com). */
  brandKey?: BrandKey
  children: React.ReactNode
}) {
  const pathname = usePathname() ?? '/'
  const [host, setHost] = useState('')
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setHost(window.location.host) }, [])
  useEffect(() => { setHidden(loadHidden()) }, [])
  useEffect(() => {
    try { setCollapsed(localStorage.getItem(COLLAPSED_KEY) === '1') } catch { /* blocked */ }
  }, [])

  // Close the mobile drawer on navigation.
  useEffect(() => { setMobileOpen(false) }, [pathname])

  // Click-outside closes the customize popover.
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

  const isTenantHost =
    !!host &&
    !host.startsWith('www.') &&
    host !== 'virtualcloser.com' &&
    host !== 'suitecxo.com'

  // On public/admin/non-tenant surfaces the shell is inert — render the
  // page as-is (the marketing chrome / child auth handles those).
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/admin') || !isTenantHost) {
    return <>{children}</>
  }

  const apexHost = host ? host.split('.').slice(-2).join('.') : 'virtualcloser.com'
  const homepageUrl = `https://${apexHost}`
  // Tenant brand wins; host detection is only a fallback for surfaces that
  // don't pass it. This is what makes the CXO logo correct on every host.
  const brand =
    brandKey === 'cxo' ? BRAND_CXO : brandKey === 'virtualcloser' ? BRAND_VC : brandFromHost(host)

  function toggleCollapse() {
    setCollapsed((v) => {
      const next = !v
      try { localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0') } catch { /* blocked */ }
      return next
    })
  }

  function toggleHide(href: string) {
    setHidden((prev) => {
      const next = new Set(prev)
      if (next.has(href)) next.delete(href)
      else next.add(href)
      try { localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next])) } catch { /* blocked */ }
      return next
    })
  }

  const visibleTabs = tabs.filter((t) => !hidden.has(t.href))
  const hiddenCount = hidden.size

  return (
    <div className={['dash-shell', collapsed ? 'is-collapsed' : '', mobileOpen ? 'is-mobile-open' : ''].filter(Boolean).join(' ')}>
      {/* Mobile top bar — the only place a menu toggle lives now. */}
      <div className="dash-mobilebar">
        <button
          type="button"
          className="dash-mobilebar-btn"
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen(true)}
        >
          <span aria-hidden className="dash-burger"><span /><span /><span /></span>
        </button>
        <Link href="/dashboard" aria-label={`${brand.name} home`} className="dash-mobilebar-logo">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={brand.logo} alt={brand.name} />
        </Link>
      </div>

      {/* Scrim behind the mobile drawer. */}
      <div className="dash-scrim" onClick={() => setMobileOpen(false)} aria-hidden />

      <aside className="dash-sidebar" aria-label="Dashboard navigation">
        <div className="dash-sidebar-head">
          <Link href="/dashboard" aria-label={`${brand.name} home`} className="dash-sidebar-logo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={brand.logo} alt={brand.name} />
          </Link>
          <button
            type="button"
            className="dash-collapse-btn"
            onClick={toggleCollapse}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            <span aria-hidden>{collapsed ? '»' : '«'}</span>
          </button>
        </div>

        <nav className="dash-sidebar-nav" aria-label="Sections">
          {visibleTabs.map((t) => {
            const selfActive = tabMatches(t, pathname)
            const kids = t.children ?? []
            const childActive = kids.some((c) => tabMatches(c, pathname))
            const sectionActive = selfActive || childActive
            return (
              <div key={t.href + t.label} className="dash-side-group">
                <Link
                  href={t.href}
                  className={['dash-side-link', sectionActive ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
                  aria-current={selfActive ? 'page' : undefined}
                >
                  <span className="dash-side-label">{t.label}</span>
                </Link>
                {kids.length > 0 && sectionActive && (
                  <div className="dash-side-sub">
                    {kids.map((c) => {
                      const ca = tabMatches(c, pathname)
                      return (
                        <Link
                          key={c.href + c.label}
                          href={c.href}
                          className={['dash-side-sublink', ca ? 'dash-side-sublink-active' : ''].filter(Boolean).join(' ')}
                          aria-current={ca ? 'page' : undefined}
                        >
                          <span className="dash-side-label">{c.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}

          {lockedAddons.length > 0 && (
            <button
              type="button"
              onClick={() => setUpgradeOpen(true)}
              className="dash-side-link dash-side-upgrade"
              aria-haspopup="dialog"
            >
              <span className="dash-side-label">Upgrade</span>
            </button>
          )}
        </nav>

        <div className="dash-sidebar-foot">
          <div ref={popoverRef} style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setCustomizeOpen((o) => !o)}
              className="dash-side-link dash-side-muted"
              aria-label="Customize visible pages"
            >
              <span className="dash-side-label">
                Customize
                {hiddenCount > 0 && <span className="dash-side-badge">{hiddenCount}</span>}
              </span>
            </button>

            {customizeOpen && (
              <div className="dash-customize-pop">
                <div className="dash-customize-title">Visible pages</div>
                <div className="dash-customize-chips">
                  {tabs.map((t) => {
                    const on = !hidden.has(t.href)
                    return (
                      <button
                        key={t.href}
                        type="button"
                        onClick={() => toggleHide(t.href)}
                        className={['dash-chip', on ? 'is-on' : ''].filter(Boolean).join(' ')}
                      >
                        {t.label}
                      </button>
                    )
                  })}
                </div>
                <div className="dash-customize-hint">Tap a pill to show/hide. Saved per browser.</div>
              </div>
            )}
          </div>

          <a href={homepageUrl} className="dash-side-link dash-side-muted">
            <span className="dash-side-label">Homepage</span>
          </a>
          <Link href="/logout" prefetch={false} className="dash-side-link dash-side-muted">
            <span className="dash-side-label">Sign out</span>
          </Link>
        </div>
      </aside>

      <main className="dash-main">{children}</main>

      {upgradeOpen && <UpgradeModal options={lockedAddons} onClose={() => setUpgradeOpen(false)} />}
    </div>
  )
}
