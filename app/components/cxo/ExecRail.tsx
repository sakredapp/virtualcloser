'use client'

/**
 * The executive rail's settings flip and foot (owner 10-09), shared by the
 * signed-in shell and the public demo so both are the same thing.
 *
 * - RailSettingsNav: replaces the main nav in place. "Back" on top, then
 *   Profile, Integrations, Connect your AI (pop-up), Calendar accounts.
 * - RailFoot: a Settings row and a profile row (initials + name). The
 *   profile row opens a small menu with the name and Sign out. No links,
 *   no "Powered by".
 */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import RailIcon, { type RailIconName } from '@/app/components/cxo/RailIcon'
import ConnectAiPopover from '@/app/components/cxo/ConnectAiPopover'

export type RailSettingsItem = {
  key: string
  label: string
  icon: RailIconName
  href?: string
  onClick?: () => void
  active?: boolean
}

function Row({ item, className }: { item: RailSettingsItem; className?: string }) {
  const cls = ['dash-side-link', item.active ? 'dash-side-link-active' : '', className ?? ''].filter(Boolean).join(' ')
  const inner = (
    <>
      <RailIcon name={item.icon} />
      <span className="dash-side-label">{item.label}</span>
    </>
  )
  if (item.onClick && !item.href) {
    return <button type="button" className={cls} onClick={item.onClick}>{inner}</button>
  }
  return (
    <Link href={item.href ?? '#'} className={cls} aria-current={item.active ? 'page' : undefined} onClick={item.onClick}>
      {inner}
    </Link>
  )
}

export function RailSettingsNav({
  onBack,
  items,
  demo = false,
}: {
  onBack: () => void
  /** Profile, Integrations, then (after the Connect your AI row) Calendar accounts. */
  items: RailSettingsItem[]
  demo?: boolean
}) {
  // Connect your AI sits third: Profile, Integrations, Connect your AI, Calendar accounts.
  const before = items.slice(0, 2)
  const after = items.slice(2)
  return (
    <nav className="dash-sidebar-nav" aria-label="Settings">
      <button type="button" className="dash-side-link dash-rail-back" onClick={onBack}>
        <RailIcon name="back" />
        <span className="dash-side-label">Back</span>
      </button>
      <p className="dash-rail-group">Settings</p>
      {before.map((it) => <Row key={it.key} item={it} />)}
      <ConnectAiPopover variant="row" demo={demo} />
      {after.map((it) => <Row key={it.key} item={it} />)}
    </nav>
  )
}

function initials(name: string): string {
  const clean = name.includes('@') ? name.split('@')[0].replace(/[._-]+/g, ' ') : name
  const words = clean.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

export function RailFoot({
  settingsOn,
  onSettings,
  who,
  role = 'Executive',
  signOutHref = '/logout',
  onSignOut,
}: {
  settingsOn: boolean
  onSettings: () => void
  who: string
  role?: string
  signOutHref?: string
  /** Demo: no real sign-out. */
  onSignOut?: () => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <div className="dash-sidebar-foot dash-rail-foot">
      <button
        type="button"
        className={['dash-side-link', settingsOn ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
        aria-pressed={settingsOn}
        onClick={onSettings}
      >
        <RailIcon name="settings" />
        <span className="dash-side-label">Settings</span>
      </button>
      <div ref={wrap} className="dash-rail-profile-wrap">
        <button
          type="button"
          className="dash-side-link dash-rail-profile"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label={`${who}, account menu`}
          title={who}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="dash-rail-avatar" aria-hidden>{initials(who)}</span>
          <span className="dash-side-label">{who}</span>
        </button>
        {open && (
          <div className="dash-rail-menu" role="menu">
            <p className="dash-rail-menu-name">{who}</p>
            <p className="dash-rail-menu-role">{role}</p>
            {onSignOut ? (
              <button type="button" role="menuitem" className="dash-rail-signout" onClick={() => { setOpen(false); onSignOut() }}>Sign out</button>
            ) : (
              <a role="menuitem" href={signOutHref} className="dash-rail-signout">Sign out</a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
