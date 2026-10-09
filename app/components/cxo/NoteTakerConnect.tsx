'use client'

import { useState } from 'react'
import './NoteTakerConnect.css'

/**
 * One "Connect" button for the Meetings page. Opens the note-taker list:
 * Wispr Flow and Plaud are wired (both land notes through the recordings
 * inbox webhook); everything else is not built yet and says "Request",
 * which files a real integration request (addon_requests + team email).
 * "Use Zapier" shows the person's own inbound URL (/api/meetings/inbound/<token>).
 */

type Provider = {
  key: string
  name: string
  line: string
  /** Wired providers carry a setup href; the rest are Request. */
  href?: string
  external?: boolean
}

const PROVIDERS: Provider[] = [
  { key: 'wispr', name: 'Wispr Flow', line: 'Meeting notes from every executive’s computer.', href: '/dashboard/integrations#recordings' },
  { key: 'plaud', name: 'Plaud', line: 'The Plaud NOTE recorder, for calls and in-person meetings.', href: '/dashboard/integrations#recordings' },
  { key: 'fathom', name: 'Fathom', line: 'Zoom, Meet and Teams recorder.' },
  { key: 'fireflies', name: 'Fireflies', line: 'Joins calls and writes the notes.' },
  { key: 'otter', name: 'Otter', line: 'Live transcripts and summaries.' },
  { key: 'zoom', name: 'Zoom', line: 'Zoom’s own cloud recordings and summaries.' },
  { key: 'meet', name: 'Google Meet', line: 'Meet recordings and Gemini notes.' },
  { key: 'email', name: 'Forward notes by email', line: 'Your own address; any note-taker that emails a summary lands on the matching meeting.' },
]

export default function NoteTakerConnect({
  inboxReady = false,
  inHeader = false,
  demo = false,
  zapierUrl = null,
}: {
  inboxReady?: boolean
  inHeader?: boolean
  /** Demo: Request only flips the label, nothing is sent. */
  demo?: boolean
  /** This person's private inbound URL (Zapier or any webhook). */
  zapierUrl?: string | null
}) {
  const [copied, setCopied] = useState(false)
  const [sent, setSent] = useState<Record<string, 'sending' | 'sent' | 'error'>>({})

  async function request(p: Provider) {
    if (demo) {
      setSent((s) => ({ ...s, [p.key]: 'sent' }))
      return
    }
    setSent((s) => ({ ...s, [p.key]: 'sending' }))
    try {
      const res = await fetch('/api/me/integration-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: `Meetings note-taker: ${p.name}` }),
      })
      setSent((s) => ({ ...s, [p.key]: res.ok ? 'sent' : 'error' }))
    } catch {
      setSent((s) => ({ ...s, [p.key]: 'error' }))
    }
  }

  return (
    <details className="cx-mtg-connect cx-ntc">
      <summary className={`cx-btn cx-btn-sm${inHeader ? ' cx-btn-red-text' : ''}`}>Connect</summary>
      <div className="cx-mtg-connect-body cx-ntc-body">
        <p className="cx-ntc-head">Pick the note-taker your team uses. Every meeting then lands here and Mira reads it.</p>
        <ul className="cx-ntc-list">
          {PROVIDERS.map((p) => {
            const st = sent[p.key]
            return (
              <li key={p.key}>
                <span className="cx-ntc-name">{p.name}</span>
                <span className="cx-ntc-line">{p.line}</span>
                {p.href ? (
                  <a className="cx-ntc-act is-live" href={p.href}>
                    {p.key === 'wispr' && inboxReady ? 'Ready' : 'Set up'}
                  </a>
                ) : st === 'sent' ? (
                  <span className="cx-ntc-act is-done">Requested</span>
                ) : (
                  <button type="button" className="cx-ntc-act" disabled={st === 'sending'} onClick={() => request(p)}>
                    {st === 'error' ? 'Try again' : st === 'sending' ? 'Sending' : 'Request'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <div className="cx-ntc-zap">
          <span className="cx-ntc-name">Use Zapier</span>
          <span className="cx-ntc-line">Works with any note-taker. Trigger: new meeting in your app &rarr; action: Webhooks POST to this URL.</span>
          {zapierUrl ? (
            <div className="cx-ntc-url">
              <code>{zapierUrl}</code>
              <button
                type="button"
                className="cx-ntc-act is-live"
                onClick={() => {
                  navigator.clipboard?.writeText(zapierUrl).then(() => setCopied(true), () => setCopied(false))
                }}
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          ) : (
            <span className="cx-ntc-line">Your private URL shows here once you are signed in.</span>
          )}
          <span className="cx-ntc-line">Send title, started_at, attendees, summary, transcript (optional) and source. Each note lands on the matching calendar meeting.</span>
        </div>
        <p className="cx-mtg-connect-alt">Request tells our team; we build it and switch it on for you.</p>
      </div>
    </details>
  )
}
