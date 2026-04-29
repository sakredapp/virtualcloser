'use client'

import { useState } from 'react'

export default function IntegrationRequestCard() {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function submit() {
    const description = text.trim()
    if (!description) return
    setStatus('sending')
    try {
      const res = await fetch('/api/me/integration-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description }),
      })
      setStatus(res.ok ? 'sent' : 'error')
    } catch {
      setStatus('error')
    }
  }

  return (
    <section className="card" style={{ marginTop: '0.8rem' }}>
      <div className="section-head">
        <h2>Request a custom integration</h2>
        <p>we build it for you</p>
      </div>
      <p className="meta" style={{ marginTop: '0.4rem' }}>
        Don&apos;t see what you need? Describe the tool or workflow — HubSpot, Salesforce,
        Slack, a custom webhook, anything — and we&apos;ll get back to you. High-request
        integrations get built into the platform.
      </p>
      {status === 'sent' ? (
        <p
          className="meta"
          style={{
            marginTop: '0.7rem',
            padding: '0.7rem 0.9rem',
            background: 'rgba(40,195,80,0.08)',
            border: '1px solid rgba(40,195,80,0.4)',
            borderRadius: 8,
            fontWeight: 600,
          }}
        >
          ✅ Request sent — we&apos;ll reach out shortly.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.7rem' }}>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="e.g. We use HubSpot and want new leads from Virtual Closer pushed there automatically…"
            style={{
              width: '100%',
              padding: '0.55rem 0.7rem',
              borderRadius: 8,
              border: '1px solid var(--ink)',
              background: 'var(--paper)',
              color: 'var(--ink)',
              fontFamily: 'inherit',
              fontSize: '0.9rem',
              resize: 'vertical',
            }}
          />
          {status === 'error' && (
            <p className="meta" style={{ color: 'var(--red-deep)', fontWeight: 600 }}>
              Something went wrong — try emailing team@virtualcloser.com directly.
            </p>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || status === 'sending'}
            className="btn approve"
            style={{ justifySelf: 'start' }}
          >
            {status === 'sending' ? 'Sending…' : 'Send request'}
          </button>
        </div>
      )}
    </section>
  )
}
