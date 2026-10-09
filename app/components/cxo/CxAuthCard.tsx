import type { ReactNode } from 'react'
import { getBrand } from '@/lib/brand'

/**
 * The CXO sign-in card, shared by every auth screen (login look, owner
 * 10-09): one calm card on the plain ground, mark, serif title, muted sub.
 * Styles live in globals.css under `.cx-login` (black/silver --cx-* tokens,
 * light + dark). Used by /reset-password, /forgot-password, /set-password.
 */
export default function CxAuthCard({
  title,
  sub,
  children,
}: {
  title: string
  sub?: ReactNode
  children?: ReactNode
}) {
  const brand = getBrand('cxo')
  return (
    <main className="cx-login">
      <section className="cx-login-card" aria-labelledby="cx-auth-title">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cx-login-mark" src={brand.logo.markSrc} alt={brand.name} />
        <h1 id="cx-auth-title" className="cx-login-title">
          {title}
        </h1>
        {sub ? <p className="cx-login-sub">{sub}</p> : null}
        {children}
      </section>
    </main>
  )
}
