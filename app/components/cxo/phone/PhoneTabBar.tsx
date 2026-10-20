'use client'

/**
 * The phone tab bar: Home, Work, the assistant, Inbox, Me. Shown only at phone
 * width on an executive-suite shell (cxo-phone.css); wider screens never see
 * it. Every other page the person can open is listed under Work
 * (/dashboard/work) or Me (/dashboard/settings), so nothing becomes
 * unreachable when the sidebar drawer gives way to this bar.
 *
 * The orb in the middle opens the Ciao screen (/dashboard/ciao, owner
 * 2026-10-20): the way into the chats, folders and past answers on a phone.
 * On that screen it focuses the box instead. The "Ask Ciao" buttons around the
 * app still open the quick sheet (PhoneStarters / mira:focus).
 */
import Link from 'next/link'
import { useEffect, useState } from 'react'
import MessagesBadge from '@/app/components/cxo/MessagesBadge'
import { MiraOrb } from '@/app/components/mira/MiraOrb'
import PhoneStarters from './PhoneStarters'
import './cxo-phone.css'

export const PHONE_QUERY = '(max-width: 640px)'

const ME_PREFIXES = ['/dashboard/settings', '/dashboard/integrations', '/dashboard/billing', '/dashboard/assistant']
const under = (pathname: string, prefixes: string[]) => prefixes.some((p) => pathname === p || pathname.startsWith(p + '/'))

function Icon({ name }: { name: 'home' | 'work' | 'inbox' | 'calendar' | 'me' }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      {name === 'home' && <path {...common} d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />}
      {name === 'work' && (
        <>
          <rect {...common} x="4" y="4" width="16" height="16" rx="4" />
          <path {...common} d="m8.5 12.2 2.4 2.4 4.6-5" />
        </>
      )}
      {name === 'inbox' && (
        <>
          <path {...common} d="M4 13.5 6.2 6a1.5 1.5 0 0 1 1.4-1h8.8a1.5 1.5 0 0 1 1.4 1L20 13.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" />
          <path {...common} d="M4 13.5h4.5a3.5 3.5 0 0 0 7 0H20" />
        </>
      )}
      {name === 'calendar' && (
        <>
          <rect {...common} x="4" y="5.5" width="16" height="14.5" rx="3" />
          <path {...common} d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
        </>
      )}
      {name === 'me' && (
        <>
          <circle {...common} cx="12" cy="8.5" r="3.7" />
          <path {...common} d="M4.8 19.5c1-3.3 3.8-5 7.2-5s6.2 1.7 7.2 5" />
        </>
      )}
    </svg>
  )
}

/** A hash link (the public demo's pages) is a plain anchor so the page hears `hashchange`; anything else is a router link. */
export function Go({ href, children, ...rest }: { href: string; children: React.ReactNode; className?: string; 'aria-current'?: 'page' | undefined; 'aria-label'?: string; prefetch?: boolean }) {
  if (href.startsWith('#') || href.startsWith('?')) {
    const { prefetch: _p, ...a } = rest
    void _p
    return <a href={href} {...a}>{children}</a>
  }
  return <Link href={href} {...rest}>{children}</Link>
}

/** Unread teammate messages, asked for only at phone width (the sidebar's own badge covers wider screens). */
function PhoneMessagesBadge() {
  const [phone, setPhone] = useState(false)
  useEffect(() => setPhone(window.matchMedia(PHONE_QUERY).matches), [])
  return phone ? <MessagesBadge /> : null
}

/** How many approvals are waiting. Asked only at phone width, and only when the company has approvals on. */
function ApprovalsCount({ on }: { on: boolean }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!on || !window.matchMedia(PHONE_QUERY).matches) return
    let alive = true
    const check = async () => {
      if (document.visibilityState === 'hidden') return
      const r = await fetch('/api/approvals', { cache: 'no-store' }).catch(() => null)
      if (!alive || !r?.ok) return
      const j = (await r.json().catch(() => null)) as { pending?: Array<{ status: string }>; plaud?: unknown[] } | null
      setN((j?.pending ?? []).filter((p) => p.status === 'pending').length + (j?.plaud?.length ?? 0))
    }
    void check()
    const t = setInterval(check, 60_000)
    window.addEventListener('cxo:messages', check)
    return () => {
      alive = false
      clearInterval(t)
      window.removeEventListener('cxo:messages', check)
    }
  }, [on])
  if (n <= 0) return null
  return <span className="cxph-count" aria-label={`${n} waiting for an OK`}>{n > 9 ? '9+' : n}</span>
}

export default function PhoneTabBar({ pathname, inboxHref, approvalsOn, assistantName, hasAssistant, demo }: {
  pathname: string
  /** The person's own Inbox tab (carries their mailbox), or null when they have none. */
  inboxHref: string | null
  /** The company has approvals switched on and this person can see them. */
  approvalsOn: boolean
  assistantName: string
  /** The assistant's bar is on this page (not for an exec's assistant). */
  hasAssistant: boolean
  /** The public demo: its own links, which tab is on, a fixed count, and no requests at all. */
  demo?: { on: 'home' | 'work' | 'inbox' | 'calendar' | 'me'; home: string; work: string; inbox?: string; calendar?: string; me: string; waiting: number }
}) {
  const me = demo ? demo.on === 'me' : under(pathname, ME_PREFIXES)
  const home = demo ? demo.on === 'home' : pathname === '/dashboard'
  const inbox = demo ? demo.on === 'inbox' : under(pathname, ['/dashboard/inbox'])
  const showInbox = demo ? !!demo.inbox : !!inboxHref
  const calendar = demo ? demo.on === 'calendar' : !inboxHref && under(pathname, ['/dashboard/calendar'])
  const ciao = !demo && under(pathname, ['/dashboard/ciao'])
  const work = demo ? demo.on === 'work' : !me && !home && !inbox && !calendar && !ciao
  const tab = (on: boolean) => (on ? 'cxph-tab is-on' : 'cxph-tab')
  return (
    <>
    {hasAssistant && <PhoneStarters assistantName={assistantName} />}
    <nav className="cxph-tabbar" aria-label="Tabs" data-slots={hasAssistant ? 5 : 4}>
      <Go href={demo?.home ?? '/dashboard'} className={tab(home)} aria-current={home ? 'page' : undefined}>
        <Icon name="home" />
        <span>Home</span>
        {!demo && <PhoneMessagesBadge />}
      </Go>
      <Go href={demo?.work ?? '/dashboard/work'} className={tab(work)} aria-current={(demo ? work : pathname === '/dashboard/work') ? 'page' : undefined}>
        <Icon name="work" />
        <span>Work</span>
        {demo ? (demo.waiting > 0 ? <span className="cxph-count" aria-label={`${demo.waiting} waiting for an OK`}>{demo.waiting}</span> : null) : <ApprovalsCount on={approvalsOn} />}
      </Go>
      {hasAssistant && (demo || ciao ? (
        <button type="button" className="cxph-orbbtn" aria-label={`Ask ${assistantName}`} aria-current={ciao ? 'page' : undefined} onClick={() => window.dispatchEvent(new CustomEvent('mira:focus'))}>
          <MiraOrb size={54} decorative />
        </button>
      ) : (
        <Link href="/dashboard/ciao" className="cxph-orbbtn" aria-label={`Ask ${assistantName}: your chats`}>
          <MiraOrb size={54} decorative />
        </Link>
      ))}
      {showInbox ? (
        <Go href={demo?.inbox ?? inboxHref ?? '/dashboard/inbox'} className={tab(inbox)} aria-current={inbox ? 'page' : undefined}>
          <Icon name="inbox" />
          <span>Inbox</span>
        </Go>
      ) : (
        // No inbox outside the Pinnacle edition (owner 2026-10-17): the slot is the calendar.
        <Go href={demo?.calendar ?? '/dashboard/calendar'} className={tab(calendar)} aria-current={calendar ? 'page' : undefined}>
          <Icon name="calendar" />
          <span>Calendar</span>
        </Go>
      )}
      <Go href={demo?.me ?? '/dashboard/settings'} className={tab(me)} aria-current={(demo ? me : pathname === '/dashboard/settings') ? 'page' : undefined}>
        <Icon name="me" />
        <span>Me</span>
      </Go>
    </nav>
    </>
  )
}
