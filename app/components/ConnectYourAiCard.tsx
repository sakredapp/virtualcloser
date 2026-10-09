'use client'

/**
 * "Connect your AI" — the Integrations-page card for the Suite CXO MCP server.
 *
 * An executive makes a key, pastes one link into their own Claude or ChatGPT,
 * and their assistant can read every number in the suite and rearrange the
 * dashboard. The key is shown ONCE (only its hash is stored) and is held in
 * state here so an accidental re-render does not lose it.
 *
 * Mount: `<ConnectYourAiCard />` anywhere inside the app shell's `.wrap`.
 * Talks to /api/me/mcp-token (keys) — the server is /api/mcp.
 */

import { useCallback, useEffect, useState } from 'react'

type KeyRow = { id: string; label: string; created_at: string; last_used_at: string | null }

type Made = { token: string; key: KeyRow }

const CONNECTOR_NAME = 'Suite CXO'
const FIRST_ASK = 'How is the business doing year to date?'

function when(iso: string | null): string {
  if (!iso) return 'never used'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'never used'
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className="btn"
      style={{ minHeight: '1.9rem', padding: '0.3rem 0.75rem', fontSize: '0.75rem', flexShrink: 0 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        } catch {
          /* clipboard blocked: the text is selectable on screen */
        }
      }}
    >
      {done ? 'Copied' : label}
    </button>
  )
}

function Mono({ children }: { children: string }) {
  return (
    <code
      style={{
        display: 'block',
        flex: 1,
        minWidth: 0,
        padding: '0.5rem 0.65rem',
        borderRadius: 8,
        border: '1px solid rgba(15,15,15,0.12)',
        background: 'var(--paper-2, rgba(15,15,15,0.03))',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.8rem',
        lineHeight: 1.45,
        wordBreak: 'break-all',
        userSelect: 'all',
      }}
    >
      {children}
    </code>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: '0.4rem' }}>{children}</div>
}

export default function ConnectYourAiCard() {
  const [origin, setOrigin] = useState('')
  const [keys, setKeys] = useState<KeyRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [notReady, setNotReady] = useState(false)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<Made | null>(null)
  const [explain, setExplain] = useState(false)
  const [assistant, setAssistant] = useState<'claude' | 'chatgpt' | 'other'>('claude')
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const mcpUrl = `${origin || 'https://www.suitecxo.com'}/api/mcp`

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/me/mcp-token', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; keys?: KeyRow[]; error?: string; not_ready?: boolean }
      if (data.not_ready) {
        setNotReady(true)
        setKeys([])
        return
      }
      if (!res.ok || !data.ok) throw new Error(data.error || `Could not load keys (${res.status}).`)
      setKeys(data.keys ?? [])
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load keys.')
    }
  }, [])

  useEffect(() => {
    setOrigin(window.location.origin)
    void load()
  }, [load])

  async function create() {
    setBusy(true)
    setLoadError(null)
    try {
      const res = await fetch('/api/me/mcp-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: label.trim() || undefined }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; key?: KeyRow; error?: string; not_ready?: boolean }
      if (data.not_ready) {
        setNotReady(true)
        return
      }
      if (!res.ok || !data.ok || !data.token || !data.key) throw new Error(data.error || 'Could not create a key.')
      setMade({ token: data.token, key: data.key })
      setLabel('')
      await load()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not create a key.')
    } finally {
      setBusy(false)
    }
  }

  async function revoke(id: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/me/mcp-token', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not revoke that key.')
      if (made?.key.id === id) setMade(null)
      setConfirmId(null)
      await load()
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not revoke that key.')
    } finally {
      setBusy(false)
    }
  }

  const link = made ? `${mcpUrl}?k=${made.token}` : null

  return (
    <div className="card" data-testid="connect-your-ai">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Connect your AI</h3>
          <p className="meta" style={{ margin: '0.35rem 0 0', lineHeight: 1.5 }}>
            Connect your own Claude or ChatGPT. It sees every number in this suite, answers in plain English, and rearranges
            the dashboard when you ask.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setExplain((v) => !v)}
          aria-expanded={explain}
          aria-label="What can it see and do?"
          title="What can it see and do?"
          style={{
            width: 26, height: 26, borderRadius: 999, border: '1px solid rgba(15,15,15,0.2)', background: 'var(--paper)',
            color: 'var(--ink)', cursor: 'pointer', fontSize: '0.9rem', lineHeight: 1, flexShrink: 0,
          }}
        >
          ⓘ
        </button>
      </div>

      {explain && (
        <p className="meta" style={{ margin: '0.6rem 0 0', lineHeight: 1.5, padding: '0.6rem 0.75rem', borderRadius: 8, background: 'var(--paper-2, rgba(15,15,15,0.03))' }}>
          Your assistant can read issued premium, placement, product mix, carriers, agencies, producers, states, the books of
          business and your calendar, for any period. It can also change the dashboard: which tiles show and in what order, the
          default timeframe, pinned KPIs and breakdowns, and a headline note. It cannot see anything outside this account and
          cannot change the underlying numbers. Anyone holding a link can do the same until you revoke that key.
        </p>
      )}

      <div style={{ marginTop: '0.9rem' }}>
        <p className="label">MCP server URL</p>
        <Row>
          <Mono>{mcpUrl}</Mono>
          <CopyButton text={mcpUrl} />
        </Row>
      </div>

      {notReady && (
        <p className="meta" role="status" style={{ marginTop: '0.8rem', lineHeight: 1.5 }}>
          Keys are not switched on for this account yet. Your administrator needs to finish the database setup; ask them to run
          the MCP keys migration.
        </p>
      )}

      {!notReady && (
        <div style={{ marginTop: '0.9rem' }}>
          <p className="label">Create a key</p>
          <Row>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Name it, e.g. Spencer's Claude"
              maxLength={60}
              style={{
                flex: 1, minWidth: 0, padding: '0.5rem 0.65rem', borderRadius: 8,
                border: '1px solid rgba(15,15,15,0.18)', background: 'var(--paper)', color: 'var(--ink)', fontSize: '0.875rem',
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !busy) void create() }}
            />
            <button type="button" className="btn approve" disabled={busy} onClick={() => void create()} style={{ flexShrink: 0 }}>
              {busy ? 'Working' : 'Create key'}
            </button>
          </Row>
        </div>
      )}

      {made && link && (
        <div
          style={{ marginTop: '0.9rem', padding: '0.8rem 0.9rem', borderRadius: 10, border: '1px solid var(--red, #FF2800)', background: 'var(--paper)' }}
          data-testid="connect-your-ai-made"
        >
          <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>
            Your key for &ldquo;{made.key.label}&rdquo; — shown once. Copy it now.
          </p>
          <p className="label" style={{ marginTop: '0.6rem' }}>Connection link (URL with the key inside — this is what Claude and ChatGPT need)</p>
          <Row>
            <Mono>{link}</Mono>
            <CopyButton text={link} label="Copy link" />
          </Row>
          <p className="label" style={{ marginTop: '0.6rem' }}>Key on its own (for tools that take a bearer token, e.g. Claude Code)</p>
          <Row>
            <Mono>{made.token}</Mono>
            <CopyButton text={made.token} label="Copy key" />
          </Row>

          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.9rem', flexWrap: 'wrap' }}>
            {([['claude', 'Claude'], ['chatgpt', 'ChatGPT'], ['other', 'Other / Claude Code']] as const).map(([id, name]) => (
              <button
                key={id}
                type="button"
                className="btn"
                aria-pressed={assistant === id}
                onClick={() => setAssistant(id)}
                style={{
                  minHeight: '1.9rem', padding: '0.3rem 0.8rem', fontSize: '0.78rem',
                  background: assistant === id ? 'var(--ink)' : undefined, color: assistant === id ? 'var(--paper)' : undefined,
                }}
              >
                {name}
              </button>
            ))}
          </div>

          <ol className="meta" style={{ margin: '0.6rem 0 0', paddingLeft: '1.2rem', lineHeight: 1.55 }}>
            {assistant === 'claude' && (
              <>
                <li>In Claude, open Settings, then &ldquo;Connectors&rdquo; (under &ldquo;Customize&rdquo;).</li>
                <li>Click &ldquo;Add&rdquo; (top right), then &ldquo;Add custom connector&rdquo;.</li>
                <li>Name: <strong>{CONNECTOR_NAME}</strong>. MCP server URL: paste the <strong>connection link</strong> above. Leave the OAuth boxes empty.</li>
                <li>Click &ldquo;Continue&rdquo;. Optional: set read-only tools to &ldquo;Always allow&rdquo; so it does not ask each time.</li>
                <li>Then ask: <em>{FIRST_ASK}</em></li>
              </>
            )}
            {assistant === 'chatgpt' && (
              <>
                <li>In ChatGPT, open Settings → Apps &amp; Connectors (Developer mode must be on under Advanced), then &ldquo;Create&rdquo; / &ldquo;Add MCP server&rdquo;.</li>
                <li>Name: <strong>{CONNECTOR_NAME}</strong>. Server URL: paste the <strong>connection link</strong> above.</li>
                <li>Authentication: choose &ldquo;No authentication&rdquo; (the key is in the link). Tick &ldquo;I understand&rdquo;.</li>
                <li>Create it, then start a chat, open &ldquo;+&rdquo; → More → turn on {CONNECTOR_NAME}.</li>
                <li>Then ask: <em>{FIRST_ASK}</em></li>
              </>
            )}
            {assistant === 'other' && (
              <>
                <li>Any assistant that takes a remote MCP server URL: paste the connection link and choose no authentication.</li>
                <li>
                  Claude Code: <code>claude mcp add --transport http suite-cxo {mcpUrl} --header &quot;Authorization: Bearer &lt;key&gt;&quot;</code>
                </li>
                <li>Then ask: <em>{FIRST_ASK}</em></li>
              </>
            )}
          </ol>
          <Row>
            <button type="button" className="btn" style={{ minHeight: '1.9rem', padding: '0.3rem 0.75rem', fontSize: '0.75rem' }} onClick={() => setMade(null)}>
              I&rsquo;ve saved it
            </button>
          </Row>
        </div>
      )}

      {loadError && (
        <p className="meta" role="alert" style={{ marginTop: '0.8rem', color: 'var(--red, #FF2800)' }}>
          {loadError}{' '}
          <button type="button" className="btn" style={{ minHeight: '1.6rem', padding: '0.2rem 0.6rem', fontSize: '0.72rem', marginLeft: '0.4rem' }} onClick={() => void load()}>
            Try again
          </button>
        </p>
      )}

      {!notReady && (
        <div style={{ marginTop: '1rem' }}>
          <p className="label">Your keys</p>
          {keys === null && !loadError && <p className="meta" style={{ margin: '0.3rem 0 0' }}>Loading…</p>}
          {keys && keys.length === 0 && <p className="meta" style={{ margin: '0.3rem 0 0' }}>No keys yet. Create one above.</p>}
          {keys && keys.length > 0 && (
            <ul style={{ listStyle: 'none', margin: '0.3rem 0 0', padding: 0 }}>
              {keys.map((k) => (
                <li
                  key={k.id}
                  style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', padding: '0.5rem 0', borderTop: '1px solid rgba(15,15,15,0.08)', flexWrap: 'wrap' }}
                >
                  <span style={{ flex: 1, minWidth: 160 }}>
                    <strong style={{ fontSize: '0.875rem' }}>{k.label}</strong>
                    <span className="meta" style={{ display: 'block', fontSize: '0.78rem' }}>
                      Created {when(k.created_at)} · {k.last_used_at ? `last used ${when(k.last_used_at)}` : 'never used'}
                    </span>
                  </span>
                  {confirmId === k.id ? (
                    <span style={{ display: 'flex', gap: '0.4rem' }}>
                      <button type="button" className="btn approve" disabled={busy} style={{ minHeight: '1.8rem', padding: '0.25rem 0.7rem', fontSize: '0.74rem' }} onClick={() => void revoke(k.id)}>
                        Revoke now
                      </button>
                      <button type="button" className="btn" style={{ minHeight: '1.8rem', padding: '0.25rem 0.7rem', fontSize: '0.74rem' }} onClick={() => setConfirmId(null)}>
                        Keep
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="btn" style={{ minHeight: '1.8rem', padding: '0.25rem 0.7rem', fontSize: '0.74rem' }} onClick={() => setConfirmId(k.id)}>
                      Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
