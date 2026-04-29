'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const OVAL_LOGO_SRC =
  'https://ndschjbuyjmxtzqyjgyi.supabase.co/storage/v1/object/public/logo%20filess/Virtual%20(1024%20x%201024%20px).png'

const PUBLIC_PATHS = ['/', '/offer', '/login', '/privacy', '/terms', '/demo', '/welcome', '/logout']

const BAR: React.CSSProperties = {
  display: 'block',
  width: 20,
  height: 2,
  borderRadius: 2,
  background: 'var(--ink)',
}

export default function AppTopbar() {
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)
  const [host, setHost] = useState('')

  useEffect(() => { setHost(window.location.host) }, [])

  const isTenantHost =
    !!host &&
    !host.startsWith('www.') &&
    host !== 'virtualcloser.com'

  // Don't render on public pages
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/admin')) return null
  if (!isTenantHost) return null

  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/dashboard/integrations', label: 'Integrations' },
    { href: '/dashboard/settings', label: 'Settings' },
    { href: '/logout', label: 'Sign out' },
  ]

  return (
    <div
      style={{
        position: 'relative',
        width: 'min(1280px, 100%)',
        marginLeft: 'auto',
        marginRight: 'auto',
        height: 84,
        background: 'var(--paper-2)',
        border: '1.5px solid var(--ink)',
        borderBottom: 'none',
        borderRadius: '16px 16px 0 0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '1.6rem',
        paddingRight: '1.2rem',
        boxSizing: 'border-box',
      }}
    >
      {/* Logo */}
      <Link href="/dashboard" aria-label="Virtual Closer home" style={{ display: 'inline-flex', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={OVAL_LOGO_SRC}
          alt="Virtual Closer"
          style={{ display: 'block', height: 72, width: 'auto' }}
        />
      </Link>

      {/* Hamburger */}
      <div style={{ position: 'relative' }}>
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
            boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
          }}
        >
          <span aria-hidden style={{ display: 'grid', gap: 4 }}>
            <span style={BAR} />
            <span style={BAR} />
            <span style={BAR} />
          </span>
        </button>

        {open && (
          <>
            <div
              onClick={() => setOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 48, background: 'transparent' }}
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
                zIndex: 51,
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
    </div>
  )
}
