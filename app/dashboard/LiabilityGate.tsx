'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import './liability-gate.css'

type Props = {
  agreementTitle: string
  agreementVersion: string
  agreementHtml: string
  workspaceLabel: string
  defaultName?: string
}

/**
 * Sign-before-entry gate over the dashboard. Phone first: a full-screen
 * sheet on a phone, a centred sheet on desktop. Patterns (Mobbin):
 * DocuSign (slim header, reading progress, sticky "Needs your signature"
 * bar), Fresha (name field over a signature preview card), Cleo (consent
 * sentence right above the final button). The agreement HTML, consent
 * wording, minimum name length and POST body are unchanged.
 */
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
  const [progress, setProgress] = useState(0)
  const [signInView, setSignInView] = useState(false)
  const [today, setToday] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const signRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setToday(new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))
    const scroller = scrollRef.current
    const sign = signRef.current
    if (!scroller || !sign) return
    const onScroll = () => {
      const max = scroller.scrollHeight - scroller.clientHeight
      setProgress(max > 0 ? Math.min(1, scroller.scrollTop / max) : 1)
    }
    onScroll()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const io = new IntersectionObserver(
      ([entry]) => setSignInView(entry.isIntersecting),
      { root: scroller, rootMargin: '0px 0px -15% 0px' },
    )
    io.observe(sign)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      io.disconnect()
    }
  }, [])

  function scrollToSign() {
    signRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 450)
  }

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
  const typed = name.trim()

  return (
    <div className="lg-root" role="dialog" aria-modal="true" aria-label={agreementTitle}>
      <div className="lg-sheet">
        <header className="lg-head">
          <p className="lg-eyebrow">Required before accessing your portal</p>
          <p className="lg-meta">
            Workspace: <strong>{workspaceLabel}</strong>
            <span aria-hidden="true"> · </span>
            Version <code>{agreementVersion}</code>
          </p>
          <div className="lg-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
        </header>

        <div className="lg-scroll" data-gate-scroll ref={scrollRef}>
          <div className="lg-doc" dangerouslySetInnerHTML={{ __html: agreementHtml }} />

          <section className="lg-sign" ref={signRef} aria-labelledby="lg-sign-title">
            <p className="lg-sign-eyebrow">Your signature</p>
            <h3 id="lg-sign-title" className="lg-sign-title">Sign the agreement</h3>

            <div className="lg-field">
              <label htmlFor="lg-name">Type your full legal name as your electronic signature</label>
              <input
                id="lg-name"
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jane Smith"
                autoComplete="name"
              />
            </div>

            <div className="lg-sigcard" aria-hidden="true">
              <div className="lg-sigline">
                {typed ? <span className="lg-signame">{typed}</span> : <span className="lg-sigph">Your signature appears here</span>}
              </div>
              <div className="lg-sigfoot">
                <span>Signature</span>
                <span>{today ? `Signed ${today}` : ''}</span>
              </div>
            </div>

            <label className={`lg-check${agreed ? ' is-on' : ''}`}>
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              <span>
                I have read this agreement in full, understand it, and have the authority to bind
                myself (and my organization, where applicable) to its terms. I understand this is a legally
                binding electronic signature under the E-SIGN Act.
              </span>
            </label>

            <p className="lg-legal">
              Your typed name constitutes a binding electronic signature (E-SIGN Act, 15 U.S.C. § 7001).
              A signed copy will be emailed to you and archived on your account.
            </p>

            {error && <p className="lg-error" role="alert">Error: {error}</p>}

            <button
              type="button"
              className="lg-submit"
              onClick={submit}
              disabled={!canSign || pending}
            >
              {pending ? 'Signing…' : 'I agree — sign electronically'}
            </button>

            <p className="lg-fine">
              Workspace: <strong>{workspaceLabel}</strong>
            </p>
          </section>
        </div>

        <div className={`lg-dock${signInView ? ' is-hidden' : ''}`}>
          <span className="lg-dock-label">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Needs your signature
          </span>
          <button type="button" className="lg-dock-btn" onClick={scrollToSign} tabIndex={signInView ? -1 : 0}>
            Sign
          </button>
        </div>
      </div>
    </div>
  )
}
