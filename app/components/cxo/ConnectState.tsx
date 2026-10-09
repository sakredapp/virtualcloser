import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * The one empty state every executive page uses when its source is not
 * connected yet: an icon, one sentence, one red button. Nothing else.
 * `href` is a page link; `action` a form POST; `external` a plain <a>
 * (OAuth starts must not be prefetched).
 */
export type ConnectKind = 'calendar' | 'recordings' | 'book' | 'ai' | 'mail'

function Icon({ kind }: { kind: ConnectKind }) {
  const common = { width: 28, height: 28, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
  switch (kind) {
    case 'calendar':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="3" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      )
    case 'recordings':
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      )
    case 'book':
      return (
        <svg {...common}>
          <path d="M4 19V5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" />
          <path d="M4 19a2 2 0 0 0 2 2h13" />
          <path d="M9 8h6M9 12h4" />
        </svg>
      )
    case 'mail':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m3 8 9 6 9-6" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      )
  }
}

export default function ConnectState({
  kind,
  sentence,
  button,
  href,
  external,
  children,
}: {
  kind: ConnectKind
  sentence: ReactNode
  button: string
  href: string
  /** True for OAuth starts and other non-app URLs (no prefetch). */
  external?: boolean
  children?: ReactNode
}) {
  return (
    <section className="cx-connect" role="region" aria-label={button}>
      <span className="cx-connect-icon">
        <Icon kind={kind} />
      </span>
      <p className="cx-connect-line">{sentence}</p>
      {external ? (
        <a href={href} className="cx-btn">
          {button}
        </a>
      ) : (
        <Link href={href} className="cx-btn">
          {button}
        </Link>
      )}
      {children}
    </section>
  )
}
