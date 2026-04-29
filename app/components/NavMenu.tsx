'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Tenant-aware top-right nav menu. Hidden on the public marketing pages
 * (home, /offer, /login, /privacy, /terms, /demo, /welcome) where there
 * is no tenant context yet.
 */
const PUBLIC_PATHS = ['/', '/offer', '/login', '/privacy', '/terms', '/demo', '/welcome', '/logout']

export default function NavMenu() {
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState('')

  useEffect(() => {
    setHost(window.location.host)
  }, [])

  // Hide on public marketing pages and on the apex/www host.
  const isTenantHost =
    !!host &&
    !host.startsWith('www.') &&
    !host.startsWith('virtualcloser.com') &&
    host !== 'virtualcloser.com'

  const onPublicPath = PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/admin')
  if (onPublicPath || !isTenantHost) return null

  // Top-right tray: account-level destinations only. Day-to-day surfaces
  // (Pipeline, Roleplay, Calendar, etc.) live in the dashboard pill nav so
  // we don't ship two competing navigation systems.
  const links: Array<{ href: string; label: string }> = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/dashboard/integrations', label: 'Integrations' },
    { href: '/dashboard/settings', label: 'Settings' },
    { href: '/logout', label: 'Sign out' },
  ]

  return (
    <div
      style={{
        position: 'absolute',
        top: 26,
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
              minWidth: 200,
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
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                style={{
                  display: 'block',
                  padding: '0.6rem 0.8rem',
                  borderRadius: 8,
                  color: 'var(--ink)',
                  textDecoration: 'none',
                  fontSize: '0.92rem',
                  fontWeight: 600,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--paper-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {l.label}
              </Link>
            ))}
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
