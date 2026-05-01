import Link from 'next/link'

type DialerModeKey = 'receptionist' | 'appointment_setter' | 'live_transfer' | 'workflows' | 'hours' | 'analytics'

const MODES: Array<{ key: DialerModeKey; label: string; href: string; bg: string; color: string }> = [
  { key: 'analytics', label: '📊 Analytics', href: '/dashboard/dialer/analytics', bg: '#e0e7ff', color: '#3730a3' },
  { key: 'hours', label: '⏱ Hours & shifts', href: '/dashboard/dialer/hours', bg: '#fef3c7', color: '#92400e' },
  { key: 'receptionist', label: 'Receptionist', href: '/dashboard/dialer/receptionist', bg: '#dcfce7', color: '#166534' },
  { key: 'appointment_setter', label: 'Appointment Setter', href: '/dashboard/dialer/appointment-setter', bg: '#dbeafe', color: '#1d4ed8' },
  { key: 'live_transfer', label: 'Live Transfer', href: '/dashboard/dialer/live-transfer', bg: '#fff7ed', color: '#c2410c' },
  { key: 'workflows', label: 'Workflows', href: '/dashboard/dialer/workflows', bg: '#f3e8ff', color: '#6b21a8' },
]

export default function ModePillNav({ active }: { active: DialerModeKey }) {
  return (
    <section style={{ margin: '0.8rem 24px 0' }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MODES.map((m) => {
          const isActive = m.key === active
          return (
            <Link
              key={m.key}
              href={m.href}
              style={{
                textDecoration: 'none',
                borderRadius: 999,
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 700,
                background: isActive ? m.bg : '#f3f4f6',
                color: isActive ? m.color : '#4b5563',
                border: isActive ? `1px solid ${m.color}` : '1px solid #e5e7eb',
              }}
            >
              {m.label}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
