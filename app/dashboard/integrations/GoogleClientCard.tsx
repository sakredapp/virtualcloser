'use client'
/**
 * "Use your own Google client" (owner 10-10): owner/admin form inside the
 * Google row on Integrations. Enter, test, remove. The secret is write-only.
 */
import { useState } from 'react'
import type { TenantGoogleClientView } from '@/lib/google/tenantClient'

type Check = { ok: boolean; code: string; message: string }

export default function GoogleClientCard({ initial, demo = false }: { initial: TenantGoogleClientView; demo?: boolean }) {
  const [view, setView] = useState(initial)
  const [clientId, setClientId] = useState('')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'clear' | null>(null)
  const [note, setNote] = useState<{ tone: 'ok' | 'err' | 'info'; text: string } | null>(null)

  async function call(method: 'PUT' | 'POST' | 'DELETE', body?: unknown): Promise<Response | null> {
    if (demo) { setNote({ tone: 'info', text: 'Not in the demo.' }); return null }
    return fetch('/api/google/client', { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  }

  async function save() {
    setBusy('save'); setNote(null)
    try {
      const res = await call('PUT', { clientId, clientSecret: secret })
      if (!res) return
      const j = (await res.json()) as TenantGoogleClientView & { error?: string }
      if (!res.ok) { setNote({ tone: 'err', text: j.error ?? 'Could not save.' }); return }
      setView(j); setClientId(''); setSecret('')
      setNote({ tone: 'ok', text: 'Saved. New Google connections and token refreshes now use your client. Click "Test connection" to check it.' })
    } finally { setBusy(null) }
  }
  async function test() {
    setBusy('test'); setNote(null)
    try {
      const res = await call('POST')
      if (!res) return
      const j = (await res.json()) as Check
      setNote({ tone: j.ok ? 'ok' : 'err', text: j.message })
    } finally { setBusy(null) }
  }
  async function clear() {
    if (!demo && !window.confirm('Remove your Google client? Existing connections keep working through the shared client until people reconnect.')) return
    setBusy('clear'); setNote(null)
    try {
      const res = await call('DELETE')
      if (!res) return
      const j = (await res.json()) as TenantGoogleClientView
      setView(j); setNote({ tone: 'ok', text: 'Removed. Back on the shared client.' })
    } finally { setBusy(null) }
  }

  return (
    <details className="cx-int-more" id="google-client">
      <summary>{view.own ? `Your own Google client · ${view.clientIdMasked}` : 'Use your own Google client'}</summary>
      <p className="cx-int-status" style={{ marginTop: 6 }}>
        {view.own
          ? 'Mira connects Google through a client in your own Google Workspace. Only your admin can change this.'
          : 'Optional. Create an OAuth client in your own Google Workspace (consent screen: Internal) and Mira will connect through it. Nothing changes until you save.'}
        {view.secretUnreadable && ' The saved secret can no longer be read; enter it again.'}
      </p>
      <form
        className="cx-int-form"
        onSubmit={(e) => { e.preventDefault(); void save() }}
        style={{ flexDirection: 'column', alignItems: 'stretch' }}
      >
        <input
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          placeholder={view.own ? `Client ID (saved: ${view.clientIdMasked}; leave blank to keep)` : 'Client ID · 123456789012-abc.apps.googleusercontent.com'}
          aria-label="Google client ID"
          autoComplete="off"
          spellCheck={false}
        />
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder={view.own ? 'Client secret (saved; leave blank to keep)' : 'Client secret · GOCSPX-…'}
          aria-label="Google client secret"
          autoComplete="new-password"
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="submit" className="cx-btn cx-btn-sm" disabled={busy !== null || (!clientId && !secret)}>{busy === 'save' ? 'Saving…' : 'Save'}</button>
          <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled={busy !== null || !view.own} onClick={() => void test()}>{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
          {view.own && <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled={busy !== null} onClick={() => void clear()}>{busy === 'clear' ? 'Removing…' : 'Remove'}</button>}
        </div>
      </form>
      {note && (
        <p className={note.tone === 'err' ? 'cx-pref-err' : 'cx-int-status'} role="status" style={{ marginTop: 6 }}>{note.text}</p>
      )}
      <details className="cx-int-more" style={{ marginTop: 10 }}>
        <summary>Set-up steps for your Google Workspace admin</summary>
        <ol>
          <li>In Google Cloud, make a project under your company&rsquo;s Workspace (or use an existing one). Turn on the <strong>Gmail API</strong> and the <strong>Google Calendar API</strong>.</li>
          <li>APIs &amp; Services → OAuth consent screen: user type <strong>Internal</strong>. Internal means only people in your Workspace can connect, and Google needs no app review.</li>
          <li>Add the scopes <code>gmail.send</code>, <code>calendar.events</code> and <code>calendar.readonly</code> (Mira also asks for Gmail read/modify, Sheets and Drive file access when a person connects; add those too if your admin restricts scopes).</li>
          <li>Credentials → Create credentials → OAuth client ID → Web application. Authorized redirect URI: <code>{view.redirectUri}</code></li>
          <li>Paste the client ID and secret above, save, then click <strong>Test connection</strong>. From then on each person&rsquo;s &ldquo;Connect Google&rdquo; runs through your client.</li>
        </ol>
      </details>
    </details>
  )
}
