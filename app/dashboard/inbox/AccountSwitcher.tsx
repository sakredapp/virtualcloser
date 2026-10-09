'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export type SwitcherOption = { key: string; label: string }

/**
 * Inbox/calendar account switcher. Flips the `?account=` param between the
 * options the server allowed for THIS viewer (inbox: only their own
 * mailboxes, never an "All" or general "Shared" choice; owner 10-09).
 */
export default function AccountSwitcher({
  options,
  value,
  label = 'Inbox',
}: {
  options: SwitcherOption[]
  value: string
  label?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  function onChange(next: string) {
    const params = new URLSearchParams(sp.toString())
    params.set('account', next)
    const qs = params.toString()
    router.push(qs ? `${pathname}?${qs}` : pathname)
  }

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: '0.82rem' }}>
      <span className="meta" style={{ fontWeight: 600, margin: 0 }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: '0.85rem', padding: '0.35rem 0.5rem', borderRadius: 8 }}
      >
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
