'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { label: 'Prospects', href: '/admin/prospects', exact: false },
  { label: 'Clients', href: '/admin/clients', exact: false },
  { label: 'Billing', href: '/admin/billing', exact: true },
  { label: 'Audit', href: '/admin/billing/audit', exact: false },
  { label: 'Stack', href: '/admin/stack', exact: false },
  { label: 'CFO', href: '/admin/cfo', exact: false },
]

export default function AdminNav() {
  const path = usePathname()
  if (path === '/admin/login') return null

  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: 'var(--paper)',
      borderBottom: '1px solid var(--border-soft)',
      boxShadow: '0 1px 2px rgba(15,15,15,0.03)',
      width: '100%',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        height: 56,
        padding: '0 1.5rem',
        gap: 0,
        width: '100%',
        overflowX: 'auto', overflowY: 'hidden',
        scrollbarWidth: 'none',
      }}>
        <Link href="/admin/prospects" style={{
          fontWeight: 900, fontSize: 12, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--red)',
          textDecoration: 'none', marginRight: 28, flexShrink: 0,
          whiteSpace: 'nowrap',
        }}>
          VC Admin
        </Link>
        <div style={{
          display: 'flex', alignItems: 'center',
          height: '100%', gap: 4, flexShrink: 0,
        }}>
          {NAV.map(({ label, href, exact }) => {
            const active = exact ? path === href : path.startsWith(href)
            return (
              <Link key={href} href={href} style={{
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                color: active ? 'var(--ink)' : 'var(--text-meta)',
                textDecoration: 'none',
                padding: '0 14px', height: '100%',
                display: 'flex', alignItems: 'center',
                borderBottom: active ? '2px solid var(--red)' : '2px solid transparent',
                marginBottom: -1,
                transition: 'color 120ms ease',
                flexShrink: 0, whiteSpace: 'nowrap',
              }}>
                {label}
              </Link>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
