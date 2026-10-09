'use client'

/**
 * "Connect your AI": the VC ads-manager "Connect AI agent" pop-up, on CXO
 * tokens. One trigger (a rail row in the settings sub-nav, or a button on the
 * Integrations page) opens a small panel beside it: who is connected, then a
 * collapsible "Connect an AI" with Claude | ChatGPT | Other, one primary
 * "Create my link", the link shown once, and the steps.
 *
 * Talks to /api/me/mcp-token (GET keys, POST {label} -> token, DELETE {id}).
 * `demo` makes no network calls: the public demo shows the same panel with a
 * sample link that is clearly not a real key.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type KeyRow = { id: string; label: string; created_at: string; last_used_at: string | null }
type Assistant = 'claude' | 'chatgpt' | 'other'

const CONNECTOR_NAME = 'Suite CXO'
const FIRST_ASK = 'How is the business doing year to date?'
const NAMES: Record<Assistant, string> = { claude: 'Claude', chatgpt: 'ChatGPT', other: 'your AI' }
const PLAN: Record<Assistant, string> = {
  claude: 'Needs a Claude Pro, Max, Team or Enterprise plan.',
  chatgpt: 'Needs ChatGPT Plus, Pro, Business or Enterprise with Developer mode on.',
  other: 'Any assistant that takes a remote MCP server URL.',
}

function when(iso: string | null): string {
  if (!iso) return 'Never used'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Never used'
  return `Last used ${d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`
}

function Copy({ text, primary }: { text: string; primary?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={['cai-button', primary ? 'cai-primary' : ''].filter(Boolean).join(' ')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1600)
        } catch { /* clipboard blocked: the field is selectable */ }
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  )
}

function Chev() {
  return (
    <svg className="cai-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M6 3.5L10.5 8 6 12.5" />
    </svg>
  )
}

export function ConnectAiIcon() {
  return (
    <svg className="dash-rail-icon" viewBox="0 0 20 20" aria-hidden>
      <path d="M2.8 10h5.4" />
      <circle cx="13" cy="10" r="4.4" />
      <circle className="d" cx="13" cy="10" r="1.7" />
    </svg>
  )
}

function Steps({ who, mcpUrl }: { who: Assistant; mcpUrl: string }) {
  if (who === 'chatgpt') {
    return (
      <ol className="cai-steps">
        <li>In ChatGPT, open Settings, then Apps &amp; Connectors. Turn on Developer mode under Advanced.</li>
        <li>Click &ldquo;Create&rdquo;. Name it {CONNECTOR_NAME} and paste your link as the server URL.</li>
        <li>Authentication: &ldquo;No authentication&rdquo; (the key is in the link). Tick &ldquo;I understand&rdquo;, then Create.</li>
        <li>In a new chat, open &ldquo;+&rdquo;, then More, and turn on {CONNECTOR_NAME}. Then ask:</li>
      </ol>
    )
  }
  if (who === 'other') {
    return (
      <ol className="cai-steps">
        <li>Add a remote MCP server. Paste your link as its URL and choose no authentication.</li>
        <li>Claude Code: <code>claude mcp add --transport http suite-cxo {mcpUrl}?k=&lt;key&gt;</code></li>
        <li>Then ask:</li>
      </ol>
    )
  }
  return (
    <ol className="cai-steps">
      <li>In Claude, open Settings, then &ldquo;Connectors&rdquo; (under &ldquo;Customize&rdquo;).</li>
      <li>Click &ldquo;Add&rdquo; (top right), then &ldquo;Add custom connector&rdquo;.</li>
      <li>There are two boxes, &ldquo;Name&rdquo; and &ldquo;MCP server URL&rdquo;. Paste the name and your link from above. Leave the OAuth boxes empty.</li>
      <li>Click &ldquo;Continue&rdquo;. Then ask it:</li>
    </ol>
  )
}

export default function ConnectAiPopover({
  variant = 'row',
  demo = false,
}: {
  /** `row`: a rail row (settings sub-nav). `button`: a page button. */
  variant?: 'row' | 'button'
  demo?: boolean
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null)
  const [origin, setOrigin] = useState('https://www.suitecxo.com')
  const [keys, setKeys] = useState<KeyRow[] | null>(demo ? [] : null)
  const [error, setError] = useState<string | null>(null)
  const [notReady, setNotReady] = useState(false)
  const [who, setWho] = useState<Assistant>('claude')
  const [connectOpen, setConnectOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [made, setMade] = useState<string | null>(null)
  const [rowOpen, setRowOpen] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  const mcpUrl = `${origin}/api/mcp`

  const load = useCallback(async () => {
    if (demo) return
    setError(null)
    try {
      const res = await fetch('/api/me/mcp-token', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; keys?: KeyRow[]; error?: string; not_ready?: boolean }
      if (data.not_ready) { setNotReady(true); setKeys([]); return }
      if (!res.ok || !data.ok) throw new Error(data.error || `status ${res.status}`)
      setKeys(data.keys ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'unknown error')
    }
  }, [demo])

  useEffect(() => { setOrigin(window.location.origin) }, [])
  useEffect(() => { if (open && keys === null) void load() }, [open, keys, load])
  useEffect(() => { if (keys && keys.length > 0 && !made) setConnectOpen(false) }, [keys, made])

  // Beside the trigger, bottom edges level (VC .cai placement).
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const r = trigger.current?.getBoundingClientRect()
      if (!r) return
      if (variant === 'row') setPos({ left: r.right + 12, bottom: Math.max(16, window.innerHeight - r.bottom) })
      else setPos({ left: Math.min(r.left, window.innerWidth - 376), bottom: Math.max(16, window.innerHeight - r.top + 8) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, variant])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panel.current?.contains(t) || trigger.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown) }
  }, [open])

  async function create() {
    setBusy(true)
    setError(null)
    try {
      if (demo) { setMade('demo-link-not-a-real-key'); return }
      const res = await fetch('/api/me/mcp-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ label: NAMES[who] === 'your AI' ? 'My AI' : NAMES[who] }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; error?: string; not_ready?: boolean }
      if (data.not_ready) { setNotReady(true); return }
      if (!res.ok || !data.ok || !data.token) throw new Error(data.error || 'Could not make a link.')
      setMade(data.token)
      void load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make a link.')
    } finally {
      setBusy(false)
    }
  }

  async function turnOff(id: string) {
    setBusy(true)
    try {
      if (!demo) {
        const res = await fetch('/api/me/mcp-token', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!res.ok || !data.ok) throw new Error(data.error || 'Could not turn it off.')
      }
      setConfirmId(null)
      setRowOpen(null)
      if (demo) setKeys((k) => (k ?? []).filter((x) => x.id !== id))
      else await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn it off.')
    } finally {
      setBusy(false)
    }
  }

  const live = keys ?? []
  const status = live.length === 0 ? 'Not connected' : `${live.length} connected · ${live.map((k) => k.label).join(', ')}`
  const link = made ? (demo ? `${mcpUrl}?k=…` : `${mcpUrl}?k=${made}`) : null

  const body = open && pos && typeof document !== 'undefined'
    ? createPortal(
      <>
        <div className="cai-scrim" onClick={() => setOpen(false)} aria-hidden />
        <div
          ref={panel}
          className="cai"
          role="dialog"
          aria-label="Connect your AI"
          style={{ ['--cai-left' as string]: `${pos.left}px`, ['--cai-bottom' as string]: `${pos.bottom}px` }}
        >
          <div className="cai-head cai-top">
            <span className="cai-status">{status}</span>
            <span
              className="cai-hint"
              tabIndex={0}
              title="Your own Claude or ChatGPT can read every number in this suite (premium, placement, agencies, agents, carriers, your calendar and meetings) and rearrange your dashboard when you ask. It cannot change the underlying numbers. Anyone holding a link can read them until you turn that connection off."
              aria-label="What it can see"
            >
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden><circle cx="8" cy="8" r="6.2" /><path d="M8 7.3v3.6" strokeLinecap="round" /><circle cx="8" cy="5" r="0.8" fill="currentColor" stroke="none" /></svg>
            </span>
            <button type="button" className="cai-x" aria-label="Close" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M4 4l8 8M12 4l-8 8" /></svg>
            </button>
          </div>

          <div className="cai-body">
            {error && (
              <div className="cai-sect" style={{ padding: 12, gap: 8 }}>
                <p className="cai-soft">Couldn&rsquo;t read the connections: {error}</p>
                <div><button type="button" className="cai-button" onClick={() => void load()}>Try again</button></div>
              </div>
            )}
            {!error && keys === null && <p className="cai-soft" style={{ padding: '6px 6px' }}>Loading</p>}
            {notReady && (
              <p className="cai-soft" style={{ padding: '6px 6px' }}>Connecting your AI is not switched on for this account yet.</p>
            )}

            {!notReady && keys !== null && (
              <>
                {live.length === 0 && !made && <p className="cai-soft" style={{ padding: '4px 6px' }}>No connections yet.</p>}
                {live.map((k) => (
                  <div key={k.id} className="cai-row">
                    <button
                      type="button"
                      className="cai-rowhead"
                      aria-expanded={rowOpen === k.id}
                      onClick={() => setRowOpen((v) => (v === k.id ? null : k.id))}
                    >
                      <Chev />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k.label}</span>
                      <span className="cai-pill">Live</span>
                    </button>
                    {rowOpen === k.id && (
                      <div className="cai-sectbody">
                        <p className="cai-soft">Live · {when(k.last_used_at)}</p>
                        {confirmId === k.id ? (
                          <div className="cai-linkrow">
                            <button type="button" className="cai-button cai-primary" disabled={busy} onClick={() => void turnOff(k.id)}>Yes, turn off</button>
                            <button type="button" className="cai-button" onClick={() => setConfirmId(null)}>Keep</button>
                          </div>
                        ) : (
                          <div><button type="button" className="cai-button" onClick={() => setConfirmId(k.id)}>Turn off</button></div>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                <div className="cai-sect">
                  <button type="button" className="cai-secthead" aria-expanded={connectOpen} onClick={() => setConnectOpen((v) => !v)}>
                    <Chev />
                    <span>{live.length > 0 ? 'Connect another AI' : 'Connect an AI'}</span>
                  </button>
                  <div className="cai-sectbody" hidden={!connectOpen}>
                    <p className="cai-soft">Let your own AI assistant read your numbers and arrange your dashboard.</p>
                    <div className="cai-seg" role="group" aria-label="Assistant">
                      {(['claude', 'chatgpt', 'other'] as const).map((a) => (
                        <button key={a} type="button" aria-pressed={who === a} onClick={() => setWho(a)} disabled={!!made}>
                          {a === 'claude' ? 'Claude' : a === 'chatgpt' ? 'ChatGPT' : 'Other'}
                        </button>
                      ))}
                    </div>
                    <p className="cai-soft">{PLAN[who]}</p>

                    {!made ? (
                      <button type="button" className="cai-button cai-go" disabled={busy} onClick={() => void create()}>
                        {busy ? 'Making your link' : `Create my link for ${NAMES[who] === 'your AI' ? 'my AI' : NAMES[who]}`}
                      </button>
                    ) : (
                      <div className="cai-made">
                        <p className="cai-label">{demo ? 'Sample link (demo)' : 'Copy your link now. It is shown once.'}</p>
                        <div>
                          <p className="cai-soft" style={{ marginBottom: 4 }}>Name</p>
                          <div className="cai-linkrow">
                            <input className="cai-link" readOnly value={CONNECTOR_NAME} onFocus={(e) => e.currentTarget.select()} />
                            <Copy text={CONNECTOR_NAME} />
                          </div>
                        </div>
                        <div>
                          <p className="cai-soft" style={{ marginBottom: 4 }}>MCP server URL</p>
                          <div className="cai-linkrow">
                            <input className="cai-link" readOnly value={link ?? ''} onFocus={(e) => e.currentTarget.select()} />
                            <Copy text={link ?? ''} primary />
                          </div>
                        </div>
                        <p className="cai-soft">Treat it like a password. It keeps working until you turn it off here.</p>
                        <Steps who={who} mcpUrl={mcpUrl} />
                        <div className="cai-prompt">
                          <span>{FIRST_ASK}</span>
                          <Copy text={FIRST_ASK} />
                        </div>
                        <div><button type="button" className="cai-button" onClick={() => { setMade(null); setConnectOpen(false) }}>Done</button></div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </>,
      document.body,
    )
    : null

  return (
    <>
      {variant === 'row' ? (
        <button
          ref={trigger}
          type="button"
          className={['dash-side-link', open ? 'dash-side-link-active' : ''].filter(Boolean).join(' ')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <ConnectAiIcon />
          <span className="dash-side-label">Connect your AI</span>
        </button>
      ) : (
        <button
          ref={trigger}
          type="button"
          className="cx-btn"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Connect your AI
        </button>
      )}
      {body}
    </>
  )
}
