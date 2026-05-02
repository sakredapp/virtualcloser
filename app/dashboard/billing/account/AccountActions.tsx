'use client'

import { useState, useTransition } from 'react'

export function ManagePortalButton() {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  function open() {
    setErr(null)
    start(async () => {
      try {
        const r = await fetch('/api/billing/portal', { method: 'POST' })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.reason ?? `${r.status}`)
        window.location.href = j.url
      } catch (e) {
        setErr((e as Error).message)
      }
    })
  }
  return (
    <>
      <button
        onClick={open}
        disabled={pending}
        style={{
          padding: '8px 14px',
          background: 'var(--red)',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontWeight: 700,
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >Manage subscription / card</button>
      {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err}</span>}
    </>
  )
}

export function OverflowToggle({ current }: { current: boolean }) {
  const [pending, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  function toggle() {
    if (!confirm(current
      ? 'Turn OFF overflow billing? Dialer will hard-stop when weekly hours run out.'
      : 'Turn ON overflow billing? Dialer keeps going past quota; overage charged at end of week.')) return
    setErr(null)
    start(async () => {
      try {
        const r = await fetch('/api/billing/overflow', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled: !current }),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.reason ?? `${r.status}`)
        location.reload()
      } catch (e) {
        setErr((e as Error).message)
      }
    })
  }
  return (
    <>
      <button
        onClick={toggle}
        disabled={pending}
        style={{
          padding: '8px 14px',
          background: 'var(--paper-2)',
          color: 'var(--ink)',
          border: '1px solid var(--ink-soft)',
          borderRadius: 8,
          fontWeight: 600,
          cursor: pending ? 'wait' : 'pointer',
          opacity: pending ? 0.7 : 1,
        }}
      >{current ? 'Turn off overflow' : 'Turn on overflow'}</button>
      {err && <span style={{ color: 'var(--red)', fontSize: 12 }}>{err}</span>}
    </>
  )
}

export function RequestChangeForm() {
  const [kind, setKind] = useState('add_hours')
  const [notes, setNotes] = useState('')
  const [hours, setHours] = useState('')
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  function submit() {
    setMsg(null)
    start(async () => {
      try {
        const r = await fetch('/api/billing/change-request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, notes, hours: hours ? Number(hours) : null }),
        })
        const j = await r.json()
        if (!r.ok || !j.ok) throw new Error(j.reason ?? `${r.status}`)
        setMsg('✓ Sent. Owner will get an email.')
        setNotes(''); setHours('')
      } catch (e) {
        setMsg(`✗ ${(e as Error).message}`)
      }
    })
  }
  return (
    <div style={{ display: 'grid', gap: 8, maxWidth: 520 }}>
      <select value={kind} onChange={(e) => setKind(e.target.value)} style={input}>
        <option value="add_hours">Add hours</option>
        <option value="remove_hours">Reduce hours</option>
        <option value="toggle_overflow">Toggle overflow</option>
        <option value="add_addon">Add add-on (CRM / dialer / roleplay)</option>
        <option value="remove_addon">Remove add-on</option>
        <option value="cancel">Cancel subscription</option>
        <option value="other">Other</option>
      </select>
      {(kind === 'add_hours' || kind === 'remove_hours') && (
        <input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="hours/week" type="number" style={input} />
      )}
      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes for the owner" rows={3} style={input} />
      <button onClick={submit} disabled={pending} style={{
        padding: '8px 14px', background: 'var(--red)', color: '#fff', border: 'none',
        borderRadius: 8, fontWeight: 700, cursor: pending ? 'wait' : 'pointer', opacity: pending ? 0.7 : 1, justifySelf: 'start',
      }}>Submit request</button>
      {msg && <p style={{ fontSize: 12, color: msg.startsWith('✓') ? '#065f46' : 'var(--red)', margin: 0 }}>{msg}</p>}
    </div>
  )
}

const input: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--ink-soft)',
  borderRadius: 6,
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 13,
}
