'use client'

import { useState } from 'react'
import '../cxo-alerts.css'

type Prefs = { inApp: boolean; email: boolean }

/** Settings › Due-date reminders. In-app on and email off unless the member changes them. */
export default function DueReminderPrefs({ initial }: { initial: Prefs }) {
  const [prefs, setPrefs] = useState<Prefs>(initial)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function set(patch: Partial<Prefs>) {
    const before = prefs
    setPrefs({ ...prefs, ...patch })
    setBusy(true)
    setErr(null)
    try {
      const r = await fetch('/api/me/due-reminders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) })
      const j = (await r.json().catch(() => ({}))) as { prefs?: Prefs; error?: string }
      if (!r.ok || !j.prefs) throw new Error(j.error || 'Could not save that.')
      setPrefs(j.prefs)
    } catch (e) {
      setPrefs(before)
      setErr(e instanceof Error ? e.message : 'Could not save that.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card cx-alerts-card" id="due-reminders" style={{ marginTop: '0.8rem' }}>
      <div className="section-head">
        <h2>Due-date reminders</h2>
        <p>for board cards you are on</p>
      </div>
      <p className="meta" style={{ margin: '0 0 0.7rem' }}>
        We remind you 7, 3 and 1 days before a card is due, on the day, and once if it goes overdue.
      </p>
      <div className="cx-pref-rows">
        <label className="cx-pref">
          <span>
            <strong>In the app</strong>
            <small>Shows in Messages on Today, with a link to the card.</small>
          </span>
          <input type="checkbox" role="switch" className="cx-switch" checked={prefs.inApp} disabled={busy} onChange={(e) => void set({ inApp: e.target.checked })} />
        </label>
        <label className="cx-pref">
          <span>
            <strong>Morning email</strong>
            <small>One &ldquo;Due soon&rdquo; email a day, only when something is due.</small>
          </span>
          <input type="checkbox" role="switch" className="cx-switch" checked={prefs.email} disabled={busy} onChange={(e) => void set({ email: e.target.checked })} />
        </label>
      </div>
      {err && <p className="cx-pref-err">{err}</p>}
    </section>
  )
}
