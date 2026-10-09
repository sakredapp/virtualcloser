'use client'

import { useEffect, useRef, useState } from 'react'
import './NoteTakerConnect.css'

/**
 * One "Connect" button for the Meetings page. It opens a compact dialog
 * (native <dialog>: Esc, click outside and the X all close it; it sits in the
 * top layer so nothing on the page moves):
 *   - Wispr Flow and Plaud, the two wired note-takers (both land notes through
 *     the recordings inbox webhook).
 *   - "Use something else?" — one select + Request for the note-takers that
 *     are not built yet. Request files a real integration request
 *     (addon_requests + team email).
 *   - "Other ways to send notes" (collapsed): forward by email (Request) and
 *     Zapier with this person's own inbound URL (/api/meetings/inbound/<token>),
 *     built from the host they are on.
 */

const OTHERS = [
  { key: 'fathom', name: 'Fathom' },
  { key: 'fireflies', name: 'Fireflies' },
  { key: 'otter', name: 'Otter' },
  { key: 'zoom', name: 'Zoom' },
  { key: 'meet', name: 'Google Meet' },
]

const SETUP_HREF = '/dashboard/integrations#recordings'

type SendState = 'sending' | 'sent' | 'error'

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
  const ref = useRef<HTMLDialogElement>(null)
  const [copied, setCopied] = useState(false)
  const [other, setOther] = useState(OTHERS[0].key)
  const [sent, setSent] = useState<Record<string, SendState>>({})

  useEffect(() => {
    const d = ref.current
    if (!d) return
    // Click on the backdrop (the dialog box itself, outside the panel) closes.
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close()
    }
    d.addEventListener('click', onClick)
    return () => d.removeEventListener('click', onClick)
  }, [])

  async function request(key: string, name: string) {
    if (demo) {
      setSent((s) => ({ ...s, [key]: 'sent' }))
      return
    }
    setSent((s) => ({ ...s, [key]: 'sending' }))
    try {
      const res = await fetch('/api/me/integration-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: `Meetings note-taker: ${name}` }),
      })
      setSent((s) => ({ ...s, [key]: res.ok ? 'sent' : 'error' }))
    } catch {
      setSent((s) => ({ ...s, [key]: 'error' }))
    }
  }

  function RequestButton({ k, name }: { k: string; name: string }) {
    const st = sent[k]
    if (st === 'sent') return <span className="cx-ntc-status">Requested</span>
    return (
      <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled={st === 'sending'} onClick={() => request(k, name)}>
        {st === 'error' ? 'Try again' : st === 'sending' ? 'Sending' : 'Request'}
      </button>
    )
  }

  const otherName = OTHERS.find((o) => o.key === other)?.name ?? other

  return (
    <div className={`cx-ntc${inHeader ? ' is-header' : ''}`}>
      <button type="button" className="cx-btn cx-btn-sm cx-ntc-open" onClick={() => ref.current?.showModal()}>
        {inboxReady ? 'Note-taker connected' : 'Connect'}
      </button>
      <dialog ref={ref} className="cx-ntc-dialog" aria-labelledby="cx-ntc-title">
        <div className="cx-ntc-panel">
          <div className="cx-ntc-top">
            <h2 id="cx-ntc-title">Connect a note-taker</h2>
            <button type="button" className="cx-ntc-x" aria-label="Close" onClick={() => ref.current?.close()}>
              <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>

          <ul className="cx-ntc-list">
            <li>
              <div>
                <span className="cx-ntc-name">Wispr Flow</span>
                <span className="cx-ntc-line">Meeting notes from every executive&rsquo;s computer.</span>
              </div>
              {inboxReady ? (
                <span className="cx-ntc-status is-ok">
                  <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M5 12.5l4.5 4.5L19 7.5" />
                  </svg>
                  Connected
                </span>
              ) : (
                <a className="cx-btn cx-btn-sm" href={SETUP_HREF}>Set up</a>
              )}
            </li>
            <li>
              <div>
                <span className="cx-ntc-name">Plaud</span>
                <span className="cx-ntc-line">The Plaud NOTE recorder, for calls and in-person meetings.</span>
              </div>
              <a className="cx-btn cx-btn-sm" href={SETUP_HREF}>Set up</a>
            </li>
            <li>
              <div>
                <span className="cx-ntc-name">Use something else?</span>
                <span className="cx-ntc-line">We build it and switch it on for you.</span>
              </div>
              <div className="cx-ntc-req">
                <select value={other} onChange={(e) => setOther(e.target.value)} aria-label="Note-taker to request">
                  {OTHERS.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
                </select>
                <RequestButton k={other} name={otherName} />
              </div>
            </li>
          </ul>

          <details className="cx-ntc-more">
            <summary>Other ways to send notes</summary>
            <div className="cx-ntc-more-body">
              <div className="cx-ntc-row">
                <div>
                  <span className="cx-ntc-name">Forward notes by email</span>
                  <span className="cx-ntc-line">Any note-taker that emails a summary lands on the matching meeting.</span>
                </div>
                <RequestButton k="email" name="Forward notes by email" />
              </div>
              <div className="cx-ntc-zap">
                <span className="cx-ntc-name">Use Zapier</span>
                <span className="cx-ntc-line">Works with any note-taker. Trigger: new meeting in your app &rarr; action: Webhooks POST to this URL.</span>
                {zapierUrl ? (
                  <div className="cx-ntc-url">
                    <code>{zapierUrl}</code>
                    <button
                      type="button"
                      className="cx-btn cx-btn-sm cx-btn-ghost"
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
            </div>
          </details>
        </div>
      </dialog>
    </div>
  )
}
