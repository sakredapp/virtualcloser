'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Unified pill-tab nav for every /dashboard/* page. Mirrors the styling of
 * the public /demo dashboard frame so the real product looks like the
 * marketing screenshot — pills, ink-on-paper, red active state.
 *
 * Locked tabs (features the tenant hasn't purchased) render greyed out
 * with a 🔒 and link to /offer rather than the feature page. This replaces
 * the old "AI Dialer / Roleplay / Pipeline" feature-card row that was
 * showing up even when the tenant didn't have those add-ons.
 */
export type DashboardNavTab = {
  /** Route this tab links to when unlocked. */
  href: string
  /** Visible label. */
  label: string
  /** Routes that should mark this tab as active (defaults to [href]). */
  matchPrefixes?: string[]
  /** Set false to render in the locked state. Defaults to true. */
  unlocked?: boolean
  /** Optional secondary line, only used for locked tabs to show "Upgrade". */
  lockedHref?: string
}

export default function DashboardNav({ tabs }: { tabs: DashboardNavTab[] }) {
  const pathname = usePathname() ?? '/dashboard'

  return (
    <nav className="dash-nav" aria-label="Dashboard sections">
      <div className="dash-nav-row">
        {tabs.map((t) => {
          const unlocked = t.unlocked !== false
          const matches = t.matchPrefixes ?? [t.href]
          const isActive = matches.some((p) =>
            p === '/dashboard' ? pathname === p : pathname === p || pathname.startsWith(p + '/'),
          )
          const className = [
            'dash-tab',
            isActive ? 'dash-tab-active' : '',
            unlocked ? '' : 'dash-tab-locked',
          ]
            .filter(Boolean)
            .join(' ')
          const href = unlocked ? t.href : t.lockedHref ?? '/offer'
          const title = unlocked ? undefined : `${t.label} — not on your plan. Click to add it.`
          return (
            <Link key={t.href + t.label} href={href} className={className} title={title} aria-current={isActive ? 'page' : undefined}>
              {!unlocked && <span aria-hidden style={{ marginRight: 6 }}>🔒</span>}
              {t.label}
            </Link>
          )
        })}
      </div>

      <style jsx>{`
        .dash-nav {
          margin: 0.4rem 0 1rem;
        }
        .dash-nav-row {
          display: flex;
          flex-wrap: wrap;
          gap: 0.4rem;
        }
        .dash-tab {
          display: inline-flex;
          align-items: center;
          padding: 8px 16px;
          border-radius: 999px;
          border: 1.5px solid var(--ink-soft, #e3ddd0);
          background: var(--paper, #fff);
          color: var(--ink, #0f0f0f);
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.02em;
          text-decoration: none;
          white-space: nowrap;
          line-height: 1.2;
          transition: background 120ms ease, border-color 120ms ease,
            color 120ms ease, box-shadow 120ms ease, transform 120ms ease;
        }
        .dash-tab:hover {
          border-color: var(--red, #ff2800);
          color: var(--red, #ff2800);
          background: rgba(255, 40, 0, 0.04);
        }
        .dash-tab-active,
        .dash-tab-active:hover {
          background: linear-gradient(180deg, var(--red, #ff2800) 0%, var(--red-deep, #c21a00) 100%);
          color: #fff;
          border-color: var(--red-deep, #c21a00);
          box-shadow: 0 4px 14px rgba(255, 40, 0, 0.32),
            inset 0 1px 0 rgba(255, 255, 255, 0.18);
          transform: translateY(-1px);
        }
        .dash-tab-locked {
          background: rgba(255, 255, 255, 0.7);
          color: var(--muted, #5a5a5a);
          border-color: var(--ink-soft, #e3ddd0);
          opacity: 0.78;
        }
        .dash-tab-locked:hover {
          color: var(--ink, #0f0f0f);
          border-color: var(--ink, #0f0f0f);
          background: var(--paper, #fff);
          opacity: 1;
        }
        @media (max-width: 520px) {
          .dash-nav-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
          }
          .dash-tab {
            font-size: 11px;
            padding: 7px 8px;
            text-align: center;
            white-space: normal;
            line-height: 1.2;
            justify-content: center;
          }
        }
      `}</style>
    </nav>
  )
}
