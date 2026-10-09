'use client'

/**
 * Light / Dark / Auto segmented control for the executive rail foot.
 * Default is Light. The inline THEME_SCRIPT in app/layout.tsx applies the
 * saved choice before first paint and exposes window.__cxTheme; this control
 * only reads the current choice and calls it.
 */

import { useEffect, useState } from 'react'
import { THEME_KEY, type ThemePref } from '@/app/components/cxo/themeScript'

declare global {
  interface Window { __cxTheme?: (p: ThemePref) => void }
}

const OPTIONS: { value: ThemePref; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'auto', label: 'Auto' },
]

function apply(p: ThemePref) {
  if (typeof window === 'undefined') return
  if (window.__cxTheme) { window.__cxTheme(p); return }
  // Fallback if the head script did not run (it always should).
  try { localStorage.setItem(THEME_KEY, p) } catch { /* private mode */ }
  const d = document.documentElement
  const dark = p === 'dark' || (p === 'auto' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  d.setAttribute('data-theme-pref', p)
  d.setAttribute('data-theme', dark ? 'dark' : 'light')
}

export default function ThemeSwitch() {
  const [pref, setPref] = useState<ThemePref>('light')

  useEffect(() => {
    const cur = document.documentElement.getAttribute('data-theme-pref')
    if (cur === 'dark' || cur === 'auto' || cur === 'light') setPref(cur)
  }, [])

  return (
    <div className="cx-seg cx-theme-switch" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={pref === o.value}
          className={pref === o.value ? 'is-on' : undefined}
          onClick={() => { setPref(o.value); apply(o.value) }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
