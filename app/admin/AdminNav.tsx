'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { label: 'Prospects', href: '/admin/prospects' },
  { label: 'Clients', href: '/admin/clients' },
  { label: 'Billing', href: '/admin/billing' },
  { label: 'Audit', href: '/admin/billing/audit' },
  { label: 'Stack', href: '/admin/stack' },
  { label: 'CFO', href: '/admin/cfo' },
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
      padding: '0 1.2rem', height: 48, gap: 0,
    }}>
      <Link href="/admin/prospects" style={{
        fontWeight: 900, fontSize: 12, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: '#ff2800',
        textDecoration: 'none', marginRight: 24, flexShrink: 0,
      }}>
        VC Admin
      </Link>
      {NAV.map(({ label, href }) => {
        const active = path.startsWith(href)
        return (
          <Link key={href} href={href} style={{
            fontSize: 13, fontWeight: active ? 700 : 500,
            color: active ? '#fff' : 'rgba(255,255,255,0.45)',
            textDecoration: 'none',
            padding: '0 14px', height: '100%',
            display: 'flex', alignItems: 'center',
            borderBottom: active ? '2px solid #ff2800' : '2px solid transparent',
            transition: 'color 120ms ease',
          }}>
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
