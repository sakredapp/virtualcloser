'use client'

import { useEffect, useState, useTransition } from 'react'
import AgreementBox from '@/app/components/cxo/AgreementBox'

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
 * dark). The agreement is a condensed box (preview, full-text sheet, PDF
 * download) with the signature right under it. Behaviour matches the VC SignStep: POST /api/onboard/[token]/sign,
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

  const feeDollars = (feeCents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
  const canFinish = agreed && name.trim().length >= 2
  const shortTitle = agreementTitle.replace(/^.*?—\s*/, '')

  // Date shown on the signature card: set after mount so server and browser
  // time zones cannot disagree during hydration.
  const [today, setToday] = useState('')
  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }))
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

  const steps = hasBuildFee
    ? ['Read', 'Sign', 'Pay setup fee', 'Set password']
    : ['Read', 'Sign', 'Set password']

  return (
    <main className="cx-onboard">
      <header className="cx-onboard-bar">
        <div className="cx-onboard-bar-brand">
          {/* Mark only, no visible words (owner 10-13); the alt text names it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="cx-onboard-bar-mark" src={markSrc} alt="Suite CXO" />
        </div>
        <span className="cx-onboard-bar-title">{shortTitle}</span>
        <span className="cx-onboard-bar-step">Step 1 of {steps.length}</span>
      </header>

      <div className="cx-onboard-wrap">
        <section className="cx-onboard-intro">
          {/* One segmented bar that never wraps (refs: DoorDash Dasher "3 of 4",
              Fresha consent form). Only the current step is filled, so the bar
              matches "Step 1 of N" in the header. */}
          <ol className="cx-onboard-progress" aria-label={`Steps: ${steps.join(', ')}`}>
            {steps.map((label, i) => (
              <li key={label} className={i === 0 ? 'is-now' : undefined} aria-current={i === 0 ? 'step' : undefined}>
                <i aria-hidden="true" />
                <span>{label}</span>
              </li>
            ))}
          </ol>
          <h1 className="cx-onboard-title">Welcome, {firstName}</h1>
          <p className="cx-onboard-sub">
            {hasBuildFee
              ? `Read and sign the agreement below, then pay the one-time setup fee of $${feeDollars}. Right after, we email you a link to set your password.`
              : 'Read and sign the agreement below. Right after, we email you a link to set your password.'}
          </p>
        </section>

        <article className="cx-onboard-doc">
          {/* The agreement as a condensed box (owner ask 10-20): title, version,
              a clipped preview, "Read full agreement" (bottom sheet on a
              phone) and "Download PDF". The sign block sits right under it;
              nothing waits on reading or scrolling. */}
          <AgreementBox
            title={agreementTitle}
            version={agreementVersion}
            meta={
              <p className="cx-onboard-doc-meta" data-version={agreementVersion}>
                This document is not legal advice. Consult qualified counsel for guidance specific to your business.
              </p>
            }
            html={bodyFragment}
            entity={brandName}
            bodyClassName="cx-onboard-body"
            testId="cx-onboard-agreement"
          />

          <section className="cx-onboard-sign" aria-labelledby="cx-onboard-sign-title">
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

            {/* Signature card (ref: Fresha "Add a signature"): the typed name
                drawn on a signing line, with the date it will carry. */}
            <div className={`cx-onboard-sigpreview${name.trim().length >= 2 ? ' is-filled' : ''}`} aria-hidden="true">
              <div className="cx-onboard-sigline">
                <b>×</b>
                {name.trim().length >= 2 ? (
                  <span className="cx-onboard-signame">{name.trim()}</span>
                ) : (
                  <span className="cx-onboard-sigph">Your signature appears here</span>
                )}
              </div>
              <div className="cx-onboard-sigmeta">
                <span>Signed electronically</span>
                <span>{today}</span>
              </div>
            </div>

            <p className="cx-onboard-legal">
              Typing your full legal name and selecting <strong>Sign</strong> confirms you have read this
              agreement in full, and your typed name is a legally binding electronic signature under the
              E-SIGN Act (15 U.S.C. § 7001) and UETA.
            </p>

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
