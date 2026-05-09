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
      background: '#111',
      borderBottom: '1px solid rgba(255,255,255,0.1)',
      display: 'flex', alignItems: 'center',
      padding: '0 1rem', height: 48,
      overflowX: 'auto', overflowY: 'hidden',
      flexWrap: 'nowrap', gap: 0,
      scrollbarWidth: 'none',
    }}>
      <Link href="/admin/prospects" style={{
        fontWeight: 900, fontSize: 12, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: '#ff2800',
        textDecoration: 'none', marginRight: 20, flexShrink: 0,
        whiteSpace: 'nowrap',
      }}>
        VC Admin
      </Link>
      {NAV.map(({ label, href, exact }) => {
        const active = exact ? path === href : path.startsWith(href)
        return (
          <Link key={href} href={href} style={{
            fontSize: 13, fontWeight: active ? 700 : 500,
            color: active ? '#fff' : 'rgba(255,255,255,0.45)',
            textDecoration: 'none',
            padding: '0 14px', height: '100%',
            display: 'flex', alignItems: 'center',
            borderBottom: active ? '2px solid #ff2800' : '2px solid transparent',
            transition: 'color 120ms ease',
            flexShrink: 0, whiteSpace: 'nowrap',
          }}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
