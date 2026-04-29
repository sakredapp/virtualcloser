'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Unified pill-tab nav for every /dashboard/* page. Mirrors the styling of
 * the public /demo dashboard frame so the real product looks like the
 * marketing screenshot — pills, ink-on-paper, red active state.
 *
 * Locked tabs (features the tenant hasn't purchased) render greyed out
 * with a small lock icon and link to /offer rather than the feature page.
 *
 * Styles live in app/globals.css under the `.dash-tab` block (moved out
 * of styled-jsx because the JSX-scoped styles weren't applying inside
 * the .wrap container in some routes).
 */
export type DashboardNavTab = {
  href: string
  label: string
  matchPrefixes?: string[]
  unlocked?: boolean
  lockedHref?: string
}

function LockIcon() {
  return (
    <svg
      className="dash-tab-lock"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="3" y="7" width="10" height="7" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 1 1 5 0v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
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
            <Link
              key={t.href + t.label}
              href={href}
              className={className}
              title={title}
              aria-current={isActive ? 'page' : undefined}
            >
              {!unlocked && <LockIcon />}
              {t.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
