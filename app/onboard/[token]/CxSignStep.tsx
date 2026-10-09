'use client'

import { useCallback, useRef, useState, useTransition } from 'react'

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
 * end. Behaviour matches the VC SignStep: POST /api/onboard/[token]/sign,
 * then Stripe (fee) or reload to the done state.
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
        <div className="cx-onboard-bar-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cx-onboard-bar-mark" src={markSrc} alt="" />
          <span>{brandName}</span>
        </div>
        <span className="cx-onboard-bar-title">{shortTitle}</span>
        <button type="button" className="cx-onboard-jump" onClick={scrollToSign}>
          Go to signature ↓
        </button>
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
          <ol className="cx-onboard-steps" aria-label="Steps">
            <li><span>1</span>Read</li>
            <li><span>2</span>Sign</li>
            {hasBuildFee ? <li><span>3</span>Pay setup fee</li> : null}
            <li><span>{hasBuildFee ? 4 : 3}</span>Set your password</li>
          </ol>
        </section>

        <article className="cx-onboard-doc">
          <header className="cx-onboard-doc-head">
            <p className="cx-onboard-eyebrow">{brandName}</p>
            <h2 className="cx-onboard-doc-title">{agreementTitle}</h2>
            <p className="cx-onboard-doc-meta">
              Version <span className="cx-onboard-mono">{agreementVersion}</span> · This document is not
              legal advice. Consult qualified counsel for guidance specific to your business.
            </p>
          </header>

          <div className="cx-onboard-body" dangerouslySetInnerHTML={{ __html: bodyFragment }} />

          <section ref={signRef} className="cx-onboard-sign" aria-labelledby="cx-onboard-sign-title">
            <h2 id="cx-onboard-sign-title" className="cx-onboard-sign-title">Sign the agreement</h2>
            <p className="cx-onboard-legal">
              Typing your full legal name and selecting <strong>Sign</strong> confirms you have read this
              agreement in full, and your typed name is a legally binding electronic signature under the
              E-SIGN Act (15 U.S.C. § 7001) and UETA.
            </p>

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

            <div className="cx-onboard-sigpreview" aria-hidden="true">
              {name.trim().length >= 2 ? (
                <span className="cx-onboard-signame">{name.trim()}</span>
              ) : (
                <span className="cx-onboard-sigph">Your signature appears here</span>
              )}
            </div>

            <label className="cx-onboard-check">
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
        </article>
      </div>
    </main>
  )
}
