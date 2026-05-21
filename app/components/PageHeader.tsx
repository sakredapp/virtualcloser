import type { ReactNode } from 'react'

/**
 * Canonical page header — the red (brand) hero banner shown at the top of
 * every dashboard page. Renders the shared `.hero` / `.eyebrow` / `h1` /
 * `.sub` chrome from globals.css so every page's header is identical instead
 * of each one hand-rolling an inline-styled <h1>.
 *
 * `actions` renders inside `.nav` (the row under the subtitle) for links or
 * buttons. Pass `children` to append extra content inside the banner.
 */
export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  children,
}: {
  eyebrow?: string
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className="hero">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {subtitle && <p className="sub">{subtitle}</p>}
      {actions && <p className="nav">{actions}</p>}
      {children}
    </header>
  )
}
