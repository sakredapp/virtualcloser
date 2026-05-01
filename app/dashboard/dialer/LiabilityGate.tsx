'use client'

// Blocking modal shown on first visit to any /dashboard/dialer/* page
// until the viewer member has signed the current liability agreement
// version. Wraps children — passes them through verbatim once signed.
//
// Server-side: parent page checks hasMemberSignedCurrent and only mounts
// this with `signed={false}` if they haven't. Client-side: on submit,
// POSTs to /api/me/liability/sign and reloads the page so any downstream
// data fetches re-run.

import { useState, useTransition } from 'react'

type Props = {
  agreementTitle: string
  agreementVersion: string
  agreementHtml: string
  workspaceLabel: string
  /** Optional default fill for the signature line. */
  defaultName?: string
}

export default function LiabilityGate({
  agreementTitle,
  agreementVersion,
  agreementHtml,
  workspaceLabel,
  defaultName,
}: Props) {
  const [name, setName] = useState(defaultName ?? '')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function submit() {
    if (!agreed || name.trim().length < 3) return
    setError(null)
    start(async () => {
      try {
        const res = await fetch('/api/me/liability/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signature_name: name.trim() }),
        })
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
        }
        if (!res.ok || body.ok === false) {
          setError(body.error ?? `HTTP ${res.status}`)
          return
        }
        // Reload to drop the modal + re-run the dialer page's loader.
        window.location.reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'sign failed')
      }
    })
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.55)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(800px, 100%)',
          maxHeight: '92vh',
          background: '#fff',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <header
          style={{
            padding: '14px 20px',
            borderBottom: '1px solid var(--border-soft)',
            background: '#fef9c3',
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#92400e', margin: 0 }}>
            Required before using the AI dialer
          </p>
          <h2 style={{ margin: '4px 0 0', fontSize: 17, color: '#0f172a' }}>{agreementTitle}</h2>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '2px 0 0' }}>
            Workspace: <strong>{workspaceLabel}</strong> · Version <code>{agreementVersion}</code>
          </p>
        </header>

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '14px 20px',
            background: '#fafafa',
            fontSize: 13,
            color: '#1f2937',
          }}
          // Agreement HTML is generated server-side from a static
          // constant (no user input) — safe to render directly.
          dangerouslySetInnerHTML={{ __html: agreementHtml }}
        />

        <footer
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border-soft)',
            background: '#fff',
            display: 'grid',
            gap: 10,
          }}
        >
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>
              I have read this agreement in full, understand it, and have authority to bind
              myself (and my organization, where applicable) to its terms.
            </span>
          </label>

          <label style={{ display: 'grid', gap: 4, fontSize: 12, color: '#525252' }}>
            <span>Type your full legal name as your signature</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Doe"
              style={{
                padding: '8px 10px',
                border: '1px solid #d4d4d4',
                borderRadius: 8,
                fontSize: 14,
                fontFamily: 'inherit',
              }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>
              A signed copy will be emailed to you and to platform admin, plus stored on your account.
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!agreed || name.trim().length < 3 || pending}
              style={{
                background: agreed && name.trim().length >= 3 ? '#0b1f5c' : '#9ca3af',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '10px 22px',
                fontWeight: 700,
                fontSize: 14,
                cursor: agreed && name.trim().length >= 3 ? 'pointer' : 'not-allowed',
              }}
            >
              {pending ? 'Signing…' : 'I agree and sign'}
            </button>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: '#b91c1c', margin: 0, fontWeight: 600 }}>
              {error}
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
