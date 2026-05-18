'use client'

import { useState, useTransition } from 'react'

type Contact = {
  id: string
  display_name: string
  aliases: string[]
  email: string | null
  phone: string | null
  role: string | null
  source: string | null
  created_at: string
}

export default function ContactsClient({ initialContacts }: { initialContacts: Contact[] }) {
  const [contacts, setContacts] = useState<Contact[]>(initialContacts)
  const [filter, setFilter] = useState('')
  const [seedMsg, setSeedMsg] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = filter
    ? contacts.filter((c) => {
        const q = filter.toLowerCase()
        return (
          c.display_name.toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          c.aliases.some((a) => a.toLowerCase().includes(q))
        )
      })
    : contacts

  async function refresh() {
    const res = await fetch('/api/plaud/contacts')
    if (!res.ok) return
    const json = (await res.json()) as { contacts: Contact[] }
    setContacts(json.contacts.map((c) => ({ ...c, aliases: c.aliases ?? [] })))
  }

  function runSeed() {
    setSeedMsg('Seeding…')
    startTransition(async () => {
      const res = await fetch('/api/plaud/contacts/seed', { method: 'POST' })
      const json = (await res.json()) as {
        inserted?: number
        scanned?: number
        sources?: { email: number; calendar: number; leads: number }
        error?: string
      }
      if (!res.ok || json.error) {
        setSeedMsg(`Seed failed: ${json.error ?? 'unknown'}`)
        return
      }
      setSeedMsg(
        `Imported ${json.inserted ?? 0} new contacts (${json.scanned ?? 0} scanned · email:${json.sources?.email ?? 0} · calendar:${json.sources?.calendar ?? 0} · leads:${json.sources?.leads ?? 0})`,
      )
      await refresh()
    })
  }

  async function remove(id: string) {
    if (!confirm('Remove this contact?')) return
    const res = await fetch(`/api/plaud/contacts?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (res.ok) setContacts((cs) => cs.filter((c) => c.id !== id))
  }

  return (
    <div style={{ display: 'grid', gap: '0.8rem', marginTop: '0.8rem' }}>
      <section className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search by name, email, alias…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            style={{ flex: 1, minWidth: 220, padding: '0.45rem 0.6rem' }}
          />
          <button className="btn" onClick={runSeed} disabled={isPending}>
            {isPending ? 'Importing…' : 'Import from email + calendar + leads'}
          </button>
        </div>
        {seedMsg && <p className="meta" style={{ margin: 0 }}>{seedMsg}</p>}
        <NewContactForm onCreated={refresh} />
      </section>

      <section style={{ display: 'grid', gap: '0.4rem' }}>
        {filtered.length === 0 && (
          <p className="empty">No contacts yet. Use Import or add one above.</p>
        )}
        {filtered.map((c) => (
          <ContactRow key={c.id} contact={c} onRemoved={() => remove(c.id)} onSaved={refresh} />
        ))}
      </section>
    </div>
  )
}

function NewContactForm({ onCreated }: { onCreated: () => void | Promise<void> }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    const res = await fetch('/api/plaud/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        display_name: name.trim(),
        email: email.trim() || null,
        role: role.trim() || null,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      setErr(json.error ?? 'failed')
      return
    }
    setName('')
    setEmail('')
    setRole('')
    await onCreated()
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <input type="text" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} required style={{ flex: '1 1 140px', padding: '0.4rem 0.55rem' }} />
      <input type="email" placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: '1 1 180px', padding: '0.4rem 0.55rem' }} />
      <input type="text" placeholder="Role (optional)" value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: '1 1 120px', padding: '0.4rem 0.55rem' }} />
      <button className="btn approve" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
      {err && <p className="meta" style={{ color: 'var(--red)', margin: 0, flexBasis: '100%' }}>{err}</p>}
    </form>
  )
}

function ContactRow({ contact, onRemoved, onSaved }: { contact: Contact; onRemoved: () => void; onSaved: () => void | Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(contact.display_name)
  const [aliases, setAliases] = useState(contact.aliases.join(', '))
  const [email, setEmail] = useState(contact.email ?? '')
  const [role, setRole] = useState(contact.role ?? '')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    const res = await fetch('/api/plaud/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: contact.id,
        display_name: name.trim(),
        aliases: aliases.split(',').map((s) => s.trim()).filter(Boolean),
        email: email.trim() || null,
        role: role.trim() || null,
      }),
    })
    setBusy(false)
    if (res.ok) {
      setEditing(false)
      await onSaved()
    }
  }

  return (
    <div className="card" style={{ padding: '0.6rem 0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      {editing ? (
        <div style={{ flex: 1, display: 'grid', gap: '0.4rem', gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
          <input type="text" value={aliases} onChange={(e) => setAliases(e.target.value)} placeholder="Aliases (comma-separated)" />
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input type="text" value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" />
        </div>
      ) : (
        <div style={{ flex: 1, display: 'grid', gap: '0.15rem' }}>
          <p className="name" style={{ margin: 0 }}>{contact.display_name}{contact.role ? ` · ${contact.role}` : ''}</p>
          <p className="meta" style={{ margin: 0, fontSize: '0.78rem' }}>
            {contact.email ?? '(no email)'}
            {contact.aliases.length > 0 && ` · aka ${contact.aliases.join(', ')}`}
            {contact.source && ` · ${contact.source}`}
          </p>
        </div>
      )}
      <div style={{ display: 'flex', gap: '0.35rem' }}>
        {editing ? (
          <>
            <button className="btn approve" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
            <button className="btn" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="btn" onClick={() => setEditing(true)}>Edit</button>
            <button className="btn" onClick={onRemoved}>Remove</button>
          </>
        )}
      </div>
    </div>
  )
}
