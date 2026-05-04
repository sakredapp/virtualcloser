'use client'

import { useState, useTransition } from 'react'

type Props = {
  agreementTitle: string
  agreementVersion: string
  agreementHtml: string
  workspaceLabel: string
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
        window.location.reload()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'sign failed')
      }
    })
  }

  const canSign = agreed && name.trim().length >= 3

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.7)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        style={{
          width: 'min(820px, 100%)',
          maxHeight: '94vh',
          background: '#fff',
          borderRadius: 14,
          boxShadow: '0 24px 80px rgba(0,0,0,0.35)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <header
          style={{
            padding: '16px 22px',
            borderBottom: '1px solid #e5e7eb',
            background: '#fef3c7',
            flexShrink: 0,
          }}
        >
          <p style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            color: '#78350f',
            margin: '0 0 3px',
          }}>
            Required before accessing your portal
          </p>
          <h2 style={{ margin: '0 0 3px', fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
            {agreementTitle}
          </h2>
          <p style={{ fontSize: 12, color: '#374151', margin: 0 }}>
            Workspace: <strong style={{ color: '#0f172a' }}>{workspaceLabel}</strong>
            &nbsp;·&nbsp;Version&nbsp;
            <code style={{ fontSize: 11, background: '#e5e7eb', padding: '1px 5px', borderRadius: 4, color: '#0f172a' }}>
              {agreementVersion}
            </code>
          </p>
        </header>

        {/* Scrollable agreement body */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '16px 22px',
            background: '#f9fafb',
            fontSize: 13,
            color: '#111827',
            lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: agreementHtml }}
        />

        {/* Signature footer */}
        <footer
          style={{
            padding: '16px 22px',
            borderTop: '2px solid #e5e7eb',
            background: '#fff',
            flexShrink: 0,
            display: 'grid',
            gap: 12,
          }}
        >
          {/* Read + acknowledge checkbox */}
          <label style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            fontSize: 13,
            color: '#111827',
            cursor: 'pointer',
          }}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              style={{ marginTop: 3, width: 16, height: 16, accentColor: '#0b1f5c', flexShrink: 0, cursor: 'pointer' }}
            />
            <span>
              I have read this agreement in full, understand it, and have the authority to bind
              myself (and my organization, where applicable) to its terms. I understand this is a legally
              binding electronic signature under the E-SIGN Act.
            </span>
          </label>

          {/* Signature line */}
          <div style={{ display: 'grid', gap: 5 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#111827', letterSpacing: '0.02em' }}>
              Type your full legal name as your electronic signature
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Smith"
              style={{
                padding: '10px 12px',
                border: `2px solid ${canSign ? '#0b1f5c' : '#d1d5db'}`,
                borderRadius: 8,
                fontSize: 16,
                fontFamily: 'Georgia, serif',
                color: '#0f172a',
                background: '#fff',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
            />
            <p style={{ margin: 0, fontSize: 11, color: '#4b5563' }}>
              Your typed name constitutes a binding electronic signature (E-SIGN Act, 15 U.S.C. § 7001).
              A signed copy will be emailed to you and archived on your account.
            </p>
          </div>

          {/* CTA row */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <p style={{ fontSize: 11, color: '#4b5563', margin: 0 }}>
              Workspace: <strong style={{ color: '#111827' }}>{workspaceLabel}</strong>
            </p>
            <button
              type="button"
              onClick={submit}
              disabled={!canSign || pending}
              style={{
                background: canSign ? '#0b1f5c' : '#9ca3af',
                color: '#fff',
                border: 'none',
                borderRadius: 8,
                padding: '11px 28px',
                fontWeight: 800,
                fontSize: 14,
                cursor: canSign ? 'pointer' : 'not-allowed',
                letterSpacing: '0.02em',
                transition: 'background 0.15s',
              }}
            >
              {pending ? 'Signing…' : 'I agree — sign electronically'}
            </button>
          </div>

          {error && (
            <p style={{ fontSize: 12, color: '#b91c1c', margin: 0, fontWeight: 700, background: '#fef2f2', padding: '8px 10px', borderRadius: 6 }}>
              Error: {error}
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}
