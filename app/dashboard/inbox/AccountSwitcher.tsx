'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'

export type SwitcherOption = { key: string; label: string }

/**
 * Inbox/calendar account switcher. Flips the `?account=` param between every
 * connected Google account in the workspace (the shared/owner account + each
 * member who connected their own), preserving the rest of the query string.
 */
export default function AccountSwitcher({
  options,
  value,
  label = 'Inbox',
  allowAll = true,
  allLabel = 'All inboxes',
}: {
  options: SwitcherOption[]
  value: string
  label?: string
  /** Show an "all accounts" option (inbox). Calendars can't merge, so pass false. */
  allowAll?: boolean
  allLabel?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  function onChange(next: string) {
    const params = new URLSearchParams(sp.toString())
    if (next === 'all') params.delete('account')
    else params.set('account', next)
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
        {allowAll && <option value="all">{allLabel}</option>}
        {options.map((o) => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}
