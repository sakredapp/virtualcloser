'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Top-right hamburger menu for the *public marketing* surface (home, /offer,
 * /demo, /privacy, /terms, /welcome). Mirrors the dashboard NavMenu styling
 * so the affordance is identical wherever you are. Collapses the action
 * buttons (book a kickoff call / see the live demo / ask a question) into
 * one menu so the hero stays clean on mobile.
 *
 * Hidden on tenant subdomains (the dashboard NavMenu takes over there) and
 * on /admin (admin has its own surface).
 */
const PUBLIC_PATHS = ['/', '/offer', '/demo', '/privacy', '/terms', '/welcome', '/login']

const CAL_BOOKING_URL =
  process.env.NEXT_PUBLIC_CAL_BOOKING_URL ?? 'https://cal.com/virtualcloser/30min'
const CONTACT_EMAIL = 'hello@virtualcloser.com'

export default function PublicActionsMenu() {
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState('')

  useEffect(() => {
    setHost(window.location.host)
  }, [])

  // Show only on the apex/www host (the public marketing surface). Tenant
  // subdomains get NavMenu instead.
  const isApex =
    !host || host.startsWith('www.') || host === 'virtualcloser.com' || host.startsWith('virtualcloser.com')

  const onPublicPath =
    PUBLIC_PATHS.includes(pathname) ||
    pathname.startsWith('/demo') ||
    pathname.startsWith('/offer')
  if (!onPublicPath || !isApex) return null
  if (pathname.startsWith('/admin')) return null

  const links: Array<{ href: string; label: string; external?: boolean }> = [
    { href: CAL_BOOKING_URL, label: 'Book a kickoff call', external: true },
    { href: '/offer', label: 'Offer & demo' },
    { href: '/login', label: 'Client portal' },
    { href: `mailto:${CONTACT_EMAIL}?subject=Questions`, label: 'Ask a question', external: true },
  ]

  return (
    <div
      style={{
        position: 'absolute',
        top: 28,
        right: 18,
        zIndex: 6,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open menu"
        aria-expanded={open}
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          border: '1px solid var(--ink)',
          background: 'var(--paper)',
          color: 'var(--ink)',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
        }}
      >
        <span aria-hidden style={{ display: 'grid', gap: 4 }}>
          <span style={barStyle} />
          <span style={barStyle} />
          <span style={barStyle} />
        </span>
      </button>

      {open && (
        <>
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 5,
              background: 'transparent',
            }}
          />
          <nav
            style={{
              position: 'absolute',
              top: 52,
              right: 0,
              minWidth: 220,
              background: 'var(--paper)',
              border: '1px solid var(--ink)',
              borderRadius: 12,
              boxShadow: '0 14px 32px rgba(0,0,0,0.22)',
              padding: '0.4rem',
              zIndex: 7,
              display: 'grid',
              gap: 2,
            }}
          >
            {links.map((l) =>
              l.external ? (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  style={itemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--paper-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {l.label}
                </a>
              ) : (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  style={itemStyle}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--paper-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  {l.label}
                </Link>
              ),
            )}
          </nav>
        </>
      )}
    </div>
  )
}

const barStyle: React.CSSProperties = {
  display: 'block',
  width: 18,
  height: 2,
  background: 'var(--ink)',
  borderRadius: 2,
}

const itemStyle: React.CSSProperties = {
  display: 'block',
  padding: '0.6rem 0.8rem',
  borderRadius: 8,
  color: 'var(--ink)',
  textDecoration: 'none',
  fontSize: '0.92rem',
  fontWeight: 600,
}
