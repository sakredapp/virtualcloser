/**
 * Line icons for the executive rail — the ads-manager MenuIcon style ported
 * whole: 19px, stroke 1.2, currentColor, round caps, one filled dot (`.d`)
 * as the single accent in each mark. Styled by `.dash-rail-icon` in
 * globals.css (cxo scope).
 */
export type RailIconName =
  | 'overview'
  | 'revenue'
  | 'today'
  | 'boards'
  | 'performance'
  | 'reports'
  | 'calendar'
  | 'meetings'
  | 'execs'
  | 'partners'
  | 'plan'
  | 'employees'
  | 'integrations'
  | 'settings'
  | 'profile'
  | 'back'
  | 'menu'
  | 'close'

export default function RailIcon({ name }: { name: RailIconName }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true" className="dash-rail-icon">
      {name === 'overview' && (
        <>
          <rect x="3" y="3" width="6" height="6" rx="1.6" />
          <rect x="11" y="3" width="6" height="6" rx="1.6" />
          <rect x="3" y="11" width="6" height="6" rx="1.6" />
          <circle className="d" cx="14" cy="14" r="2.4" />
        </>
      )}
      {name === 'revenue' && (
        <>
          <rect x="2.8" y="5" width="14.4" height="10" rx="2.4" />
          <circle cx="10" cy="10" r="2.3" />
          <path d="M5.4 7.6v.01M14.6 12.4v.01" />
          <circle className="d" cx="14.6" cy="7.6" r="1.2" />
        </>
      )}
      {name === 'today' && (
        <>
          <path d="M4 5.6l1.5 1.5L8 4.6M4 11.6l1.5 1.5L8 10.6" />
          <path d="M10.6 6h6M10.6 12h6M4.2 16.4h4" />
          <circle className="d" cx="14.6" cy="16.4" r="1.4" />
        </>
      )}
      {name === 'boards' && (
        <>
          <rect x="3" y="3" width="14" height="14" rx="2.6" />
          <path d="M8 3v14M12.6 3v14" />
          <path d="M4.8 6.4h1.4M9.6 6.4h1.4M9.6 9.4h1.4" />
          <circle className="d" cx="14.8" cy="6.6" r="1.2" />
        </>
      )}
      {name === 'performance' && (
        <>
          <path d="M3 15.5l4.3-5 3.4 2.6L16.8 5" />
          <path d="M13.2 5h3.6v3.6" />
          <circle className="d" cx="7.3" cy="10.5" r="1.4" />
        </>
      )}
      {name === 'reports' && (
        <>
          <path d="M5.5 3h6.2l3.8 3.8V17H5.5z" />
          <path d="M11.5 3v4h4" />
          <path d="M8 10.5h4.5M8 13.5h3" />
          <circle className="d" cx="14.2" cy="14.4" r="1.3" />
        </>
      )}
      {name === 'calendar' && (
        <>
          <rect x="3" y="4" width="14" height="13" rx="3" />
          <path d="M3 8.2h14M7 2.6v2.6M13 2.6v2.6" />
          <circle className="d" cx="12.8" cy="12.6" r="1.5" />
        </>
      )}
      {name === 'meetings' && (
        <>
          <rect x="7.4" y="2.8" width="5.2" height="8.6" rx="2.6" />
          <path d="M4.6 9.4a5.4 5.4 0 0 0 10.8 0M10 14.8v2.4M7.4 17.2h5.2" />
          <circle className="d" cx="15.6" cy="4.6" r="1.3" />
        </>
      )}
      {name === 'execs' && (
        <>
          <circle cx="10" cy="6.4" r="2.8" />
          <path d="M4 17c.8-3.4 3.1-5.2 6-5.2s5.2 1.8 6 5.2" />
          <path d="M10 11.8l-1 2.2 1 1.4 1-1.4z" />
        </>
      )}
      {name === 'partners' && (
        <>
          <circle className="d" cx="7.2" cy="6.6" r="2.4" />
          <circle cx="13.6" cy="7.4" r="2" />
          <path d="M2.8 16.4c.7-3 2.6-4.6 5.2-4.6 1.4 0 2.6.5 3.5 1.4" />
          <path d="M11 16.4c.5-2.3 1.9-3.6 3.9-3.6 1.3 0 2.3.5 3 1.5" />
        </>
      )}
      {name === 'plan' && (
        <>
          <circle cx="10" cy="10" r="7" />
          <circle cx="10" cy="10" r="3.8" />
          <path d="M10 3v2M17 10h-2" />
          <circle className="d" cx="10" cy="10" r="1.3" />
        </>
      )}
      {name === 'employees' && (
        <>
          <rect x="7.2" y="2.8" width="5.6" height="4.4" rx="1.4" />
          <rect x="2.8" y="12.8" width="5.6" height="4.4" rx="1.4" />
          <path d="M10 7.2v2.8M5.6 12.8V10h8.8v2.8" />
          <circle className="d" cx="14.4" cy="15" r="2" />
        </>
      )}
      {name === 'integrations' && (
        <>
          <path d="M7 3.2v3.6M13 3.2v3.6" />
          <path d="M4.6 6.8h10.8v2.4a5.4 5.4 0 0 1-10.8 0z" />
          <path d="M10 14.6v2.6" />
          <circle className="d" cx="10" cy="10.4" r="1.4" />
        </>
      )}
      {name === 'settings' && (
        <>
          <path d="M3 6.5h7.5M15.5 6.5H17M3 13.5h1.5M9.5 13.5H17" />
          <circle className="d" cx="13" cy="6.5" r="2.1" />
          <circle className="d" cx="7" cy="13.5" r="2.1" />
        </>
      )}
      {name === 'profile' && (
        <>
          <circle cx="10" cy="7.2" r="3.2" />
          <path d="M3.8 16.6c1.1-3 3.4-4.4 6.2-4.4s5.1 1.4 6.2 4.4" />
          <circle className="d" cx="10" cy="7.2" r="1.1" />
        </>
      )}
      {name === 'back' && <path d="M16 10H4.5M9 5.2L4.2 10 9 14.8" />}
      {name === 'menu' && <path d="M3.5 6.5h13M3.5 10h13M3.5 13.5h13" />}
      {name === 'close' && <path d="M5 5l10 10M15 5L5 15" />}
    </svg>
  )
}

/** Which mark a rail route gets. Unknown routes get no icon. */
export function railIconFor(href: string): RailIconName | null {
  if (href === '/dashboard') return 'today'
  if (href.startsWith('/dashboard/revenue')) return 'revenue'
  if (href.startsWith('/dashboard/boards')) return 'boards'
  if (href.startsWith('/dashboard/pinnacle')) return 'performance'
  if (href.startsWith('/dashboard/analytics')) return 'reports'
  if (href.startsWith('/dashboard/calendar')) return 'calendar'
  if (href.startsWith('/dashboard/meetings') || href.startsWith('/dashboard/recordings')) return 'meetings'
  if (href.startsWith('/dashboard/execs')) return 'execs'
  if (href.startsWith('/dashboard/partners')) return 'partners'
  if (href.startsWith('/dashboard/plan')) return 'plan'
  if (href.startsWith('/dashboard/employees')) return 'employees'
  if (href.startsWith('/dashboard/integrations')) return 'integrations'
  if (href.startsWith('/dashboard/settings') || href.startsWith('/dashboard/billing')) return 'settings'
  return null
}
