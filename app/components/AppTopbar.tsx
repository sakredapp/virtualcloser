'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

// Brand-aware logo + label sources. Kept inline (not imported from
// lib/brand.ts) because that module imports next/headers and can't be
// loaded into the client bundle. Update both call sites here if the
// registry adds a brand.
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
    host !== 'virtualcloser.com' &&
    host !== 'suitecxo.com'

  // Don't render on public pages
  if (PUBLIC_PATHS.includes(pathname) || pathname.startsWith('/admin')) return null
  if (!isTenantHost) return null

  // From a tenant subdomain like acme.suitecxo.com, the apex is the last
  // two host parts. Falls back to the VC public root if host is empty.
  const apexHost = host ? host.split('.').slice(-2).join('.') : 'virtualcloser.com'
  const homepageUrl = `https://${apexHost}`
  const brand = brandFromHost(host)
  const isCxo = brand === BRAND_CXO

  const links = [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/dashboard/integrations', label: 'Integrations' },
    { href: '/dashboard/settings', label: 'Settings' },
    { href: homepageUrl, label: 'Homepage' },
    { href: '/logout', label: 'Sign out' },
  ]

  return (
    <div
      style={{
        position: 'relative',
        // Under CXO the topbar lives inside .cxo-shell (a bordered, rounded
        // ivory canvas). It must fill that canvas edge-to-edge — the shell
        // already supplies the outer frame + rounded corners — otherwise the
        // mocha body shows around a narrower, self-bordered bar. VC keeps the
        // standalone centered bar with its own top frame.
        ...(isCxo
          ? {
              width: '100%',
              borderBottom: '1.5px solid var(--ink)',
              borderRadius: 0,
            }
          : {
              width: 'min(1280px, 100%)',
              marginLeft: 'auto',
              marginRight: 'auto',
              border: '1.5px solid var(--ink)',
              borderBottom: 'none',
              borderRadius: '16px 16px 0 0',
            }),
        height: 120,
        background: 'var(--paper-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingLeft: '1.8rem',
        paddingRight: '1.4rem',
        boxSizing: 'border-box',
      }}
    >
      {/* Logo */}
      <Link href="/dashboard" aria-label={`${brand.name} home`} style={{ display: 'inline-flex', alignItems: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logo}
          alt={brand.name}
          style={{ display: 'block', height: 108, width: 'auto' }}
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
