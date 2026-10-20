'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import CxOnboardSteps, { cxOnboardSteps } from './CxOnboardSteps'

type Props = {
  token: string
  brandName: string
  markSrc: string
  agreementTitle: string
  agreementVersion: string
  bodyFragment: string
  clientName: string
  hasBuildFee: boolean
  feeCents: number
}

const ERRORS: Record<string, string> = {
  'name required': 'Type your full legal name to sign.',
  expired: 'This onboarding link has expired. Ask your contact for a new one.',
  not_found: 'This onboarding link is not valid. Ask your contact for a new one.',
}

/**
 * The CXO onboarding sign step: same look as the CXO sign-in and password
 * screens (black / silver --cx-* tokens, Lora titles, Inter body, light and
 * dark). The agreement reads as one calm document with the signature at the
 * end. Phone-first (2026-10-20): Deel-style vertical step list, DocuSign
 * document header and sticky bottom Sign bar, Fresha signature card, Cleo
 * consent-above-button. Behaviour matches the VC SignStep: POST /api/onboard/[token]/sign,
 * then Whop (fee) or reload to the done state.
 */
export default function CxSignStep({
  token,
  brandName,
  markSrc,
  agreementTitle,
  agreementVersion,
  bodyFragment,
  clientName,
  hasBuildFee,
  feeCents,
}: Props) {
  const firstName = clientName.split(' ')[0] || clientName
  const [name, setName] = useState('')
  const [agreed, setAgreed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const signRef = useRef<HTMLElement>(null)
  const docRef = useRef<HTMLElement>(null)
  const [signInView, setSignInView] = useState(false)
  const [progress, setProgress] = useState(0)
  const [today, setToday] = useState('')

  // Reading progress (bar under the top bar) and whether the signature block
  // is on screen (hides the bottom Sign bar, moves the step list to Sign).
  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
    const onScroll = () => {
      const doc = docRef.current
      if (!doc) return
      const rect = doc.getBoundingClientRect()
      const total = rect.height - window.innerHeight * 0.6
      const read = Math.min(1, Math.max(0, -rect.top / Math.max(1, total)))
      setProgress(read)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    const el = signRef.current
    const io = el
      ? new IntersectionObserver(([entry]) => setSignInView(entry.isIntersecting), { rootMargin: '0px 0px -15% 0px' })
      : null
    if (el && io) io.observe(el)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      io?.disconnect()
    }
  }, [])

  const feeDollars = (feeCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const canFinish = agreed && name.trim().length >= 2
  const shortTitle = agreementTitle.replace(/^.*?—\s*/, '')

  const scrollToSign = useCallback(() => {
    signRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  function submit() {
    if (!canFinish || pending) return
    setError(null)
    start(async () => {
      try {
        const res = await fetch(`/api/onboard/${token}/sign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        })
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          error?: string
          requiresPayment?: boolean
          checkoutUrl?: string | null
        }
        if (!res.ok || data.ok === false) {
          const code = data.error ?? ''
          setError(ERRORS[code] ?? (res.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Something went wrong. Try again.'))
          return
        }
        if (data.requiresPayment && data.checkoutUrl) {
          window.location.href = data.checkoutUrl
        } else {
          window.location.reload()
        }
      } catch {
        setError('Could not reach the server. Check your connection and try again.')
      }
    })
  }

  return (
    <main className="cx-onboard">
      <header className="cx-onboard-bar">
        {/* Mark only, no visible words (owner 10-13); the alt text names it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="cx-onboard-bar-mark" src={markSrc} alt="Suite CXO" />
        <span className="cx-onboard-bar-title">{shortTitle}</span>
        <span className="cx-onboard-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${progress})` }} />
        </span>
      </header>

      <div className="cx-onboard-wrap">
        <section className="cx-onboard-intro">
          <p className="cx-onboard-eyebrow">Onboarding</p>
          <h1 className="cx-onboard-title">Welcome, {firstName}</h1>
          <p className="cx-onboard-sub">
            {hasBuildFee
              ? `Read and sign the agreement below, then pay the one-time setup fee of $${feeDollars}. Right after, we email you a link to set your password.`
              : 'Read and sign the agreement below. Right after, we email you a link to set your password.'}
          </p>
          <CxOnboardSteps steps={cxOnboardSteps({ hasBuildFee, feeDollars, current: signInView ? 'sign' : 'read' })} />
        </section>

        <article ref={docRef} className="cx-onboard-doc">
          <header className="cx-onboard-doc-head">
            <h2 className="cx-onboard-doc-title">{agreementTitle}</h2>
            <dl className="cx-onboard-meta">
              <div><dt>From</dt><dd>{brandName}</dd></div>
              <div><dt>Sent to</dt><dd>{clientName}</dd></div>
              <div><dt>Version</dt><dd className="cx-onboard-mono">{agreementVersion}</dd></div>
            </dl>
            <p className="cx-onboard-doc-note">
              This document is not legal advice. Consult qualified counsel for guidance specific to your business.
            </p>
          </header>

          <div className="cx-onboard-body" dangerouslySetInnerHTML={{ __html: bodyFragment }} />
        </article>

        <section ref={signRef} className="cx-onboard-sign" aria-labelledby="cx-onboard-sign-title">
          <p className="cx-onboard-eyebrow">Your signature</p>
          <h2 id="cx-onboard-sign-title" className="cx-onboard-sign-title">Sign the agreement</h2>

          <label className="cx-onboard-field">
            <span>Full legal name</span>
            <input
              className="cx-onboard-input"
              type="text"
              placeholder="Type your full legal name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
              autoComplete="name"
            />
          </label>

          <div className="cx-onboard-sigcard" aria-hidden="true">
            <div className="cx-onboard-sigline">
              {name.trim().length >= 2 ? (
                <span className="cx-onboard-signame">{name.trim()}</span>
              ) : (
                <span className="cx-onboard-sigph">Your signature appears here</span>
              )}
            </div>
            <div className="cx-onboard-sigfoot">
              <span>Signature</span>
              <span>{today ? `Signed ${today}` : ''}</span>
            </div>
          </div>

          <label className={`cx-onboard-check${agreed ? ' is-on' : ''}`}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={pending}
            />
            <span>
              I have read and fully understand the {agreementTitle}, and I agree to its terms on behalf
              of myself and the business I represent.
            </span>
          </label>

          <p className="cx-onboard-legal">
            Typing your full legal name and selecting <strong>Sign</strong> confirms you have read this
            agreement in full, and your typed name is a legally binding electronic signature under the
            E-SIGN Act (15 U.S.C. § 7001) and UETA.
          </p>

          {error ? <p className="cx-onboard-error" role="alert">{error}</p> : null}

          <button
            type="button"
            className="cx-onboard-submit"
            onClick={submit}
            disabled={!canFinish || pending}
          >
            {pending ? 'Signing…' : hasBuildFee ? `Sign and continue to payment ($${feeDollars})` : 'Sign and finish'}
          </button>

          <p className="cx-onboard-fine">
            Secured by {brandName} · E-SIGN Act compliant · A signed PDF copy is emailed to you.
          </p>
        </section>
      </div>

      {/* DocuSign-style bottom bar while reading; it hides once the signature
          block is on screen, so only one primary button shows at a time. */}
      <div className={`cx-onboard-dock${signInView ? ' is-hidden' : ''}`} aria-hidden={signInView}>
        <span className="cx-onboard-dock-label">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 3.5l3 3L7 16H4v-3z" /><path d="M11.5 5.5l3 3" /></svg>
          Needs your signature
        </span>
        <button type="button" className="cx-onboard-dock-btn" onClick={scrollToSign} tabIndex={signInView ? -1 : 0}>
          Sign
        </button>
      </div>
    </main>
  )
}
