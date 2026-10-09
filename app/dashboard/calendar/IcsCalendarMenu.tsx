'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import s from './calendar.module.css'
import '../cxo-alerts.css'

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/calendar/ics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = (await r.json().catch(() => ({}))) as { error?: string }
  if (!r.ok) throw new Error(j.error || 'That did not go through.')
  return j
}

/**
 * Apple / iCloud or any calendar link (ICS). The member pastes a webcal:// or
 * https://…ics link; we check it, read it and show its events next to Google.
 */
export function IcsAddForm() {
  const router = useRouter()
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setBusy(true)
    setErr(null)
    try {
      await post({ op: 'add', url: url.trim(), label: label.trim() || null })
      setUrl('')
      setLabel('')
      const d = (e.target as HTMLElement).closest('details')
      if (d) d.open = false
      router.refresh()
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'That did not go through.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="cx-ics-form" onSubmit={submit}>
      <h3>Apple / iCloud or any calendar link (ICS)</h3>
      <ol>
        <li>On your iPhone, open the Calendar app and tap Calendars.</li>
        <li>Tap the ⓘ next to the calendar.</li>
        <li>Turn on Public Calendar, tap Share Link, then Copy.</li>
        <li>Paste the link here. It starts with webcal://</li>
      </ol>
      <input type="url" inputMode="url" required placeholder="webcal://p01-caldav.icloud.com/…" value={url} onChange={(e) => setUrl(e.target.value)} aria-label="Calendar link" />
      <input type="text" placeholder="Name (optional), e.g. Family" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} aria-label="Calendar name" />
      {err && <p className="cx-ics-err">{err}</p>}
      <div>
        <button type="submit" className={s.btn} disabled={busy || !url.trim()}>
          {busy ? 'Checking the link…' : 'Add calendar'}
        </button>
      </div>
    </form>
  )
}

export function IcsRemoveButton({ id, label }: { id: string; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className={s.menuLink}
      disabled={busy}
      onClick={async () => {
        if (!window.confirm(`Remove ${label} from your calendar?`)) return
        setBusy(true)
        try {
          await post({ op: 'remove', id })
          router.refresh()
        } catch {
          setBusy(false)
        }
      }}
    >
      {busy ? 'Removing…' : 'Remove this calendar'}
    </button>
  )
}
