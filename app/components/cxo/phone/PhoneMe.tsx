import Link from 'next/link'
import RailIcon, { type RailIconName } from '@/app/components/cxo/RailIcon'
import ThemeSwitch from '@/app/components/cxo/ThemeSwitch'
import type { PhoneVersion } from '@/lib/phoneVersions'
import { initialsOf } from './PhoneHome'

/**
 * The top of Me on a phone: who is signed in, then every settings page the
 * sidebar's settings menu lists on a wider screen (Integrations, Calendar
 * accounts, Adoption), Appearance and Sign out. The account sections
 * themselves (reminders, usage, co-admins, password) stay on the page below,
 * unchanged. Phone width only.
 */
export default function PhoneMe({ version, name, email, role, companyName, admin, assistant }: {
  version: PhoneVersion
  name: string | null
  email: string | null
  role: string | null
  companyName: string | null
  /** Owner or admin: also sees Adoption and people. */
  admin: boolean
  /** An exec's assistant: sees Working for, not the company pages. */
  assistant: boolean
}) {
  const company = version.wordmark ?? companyName ?? version.appName
  const rows: Array<{ href: string; icon: RailIconName; title: string; about: string }> = assistant
    ? [{ href: '/dashboard/assistant', icon: 'execs', title: 'Working for', about: 'The executives you assist' }]
    : [
        { href: '/dashboard/integrations', icon: 'integrations', title: 'Integrations', about: `Google, your notes and your own AI` },
        { href: '/dashboard/calendar#accounts', icon: 'calendar', title: 'Calendar accounts', about: 'Which calendars show up' },
        ...(admin ? [{ href: '/dashboard/settings/adoption', icon: 'performance' as const, title: 'Adoption', about: 'Who is using what' }] : []),
      ]
  const who = name || email || 'Account'
  return (
    <div className="cxph cxph-only cxph-me">
      <div className="cxph-prof">
        <span className="cxph-avatar ink" aria-hidden>{initialsOf(who)}</span>
        <span>
          <b>{who}</b>
          <small>{[role ? role.replace(/^\w/, (c) => c.toUpperCase()) : null, company].filter(Boolean).join(' at ')}</small>
          {email && name && <small>{email}</small>}
        </span>
      </div>

      <p className="cxph-sub">{assistant ? 'Your work' : 'Company'}</p>
      <div className="cxph-card cxph-set">
        {rows.map((r) => (
          <Link key={r.href} href={r.href} className="row">
            <span className="ic"><RailIcon name={r.icon} /></span>
            <span className="t"><b>{r.title}</b><small>{r.about}</small></span>
            <svg className="chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9.5 6 6 6-6 6" /></svg>
          </Link>
        ))}
      </div>

      <p className="cxph-sub">You</p>
      <div className="cxph-card cxph-set">
        <div className="row">
          <span className="t"><b>Appearance</b></span>
          <ThemeSwitch />
        </div>
        <Link href="/logout" prefetch={false} className="row">
          <span className="t"><b>Sign out</b></span>
        </Link>
      </div>

      <p className="cxph-me-more">Your account, reminders and password are below.</p>
    </div>
  )
}
