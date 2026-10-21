'use client'

import { useState, useTransition } from 'react'
import AgreementBox from '@/app/components/cxo/AgreementBox'

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

  // Phone: a full-screen sheet; desktop: a centred card. The agreement is a
  // condensed box (preview, full-text sheet, PDF download) with the signature
  // block right under it; nothing waits on reading or scrolling.
  // Suite CXO --cx-* tokens with neutral fallbacks; no amber, no navy.
  return (
    <div className="cx-gate" role="dialog" aria-modal="true" aria-label={agreementTitle}>
      <div className="cx-gate-card">
        <header className="cx-gate-head">
          <p className="cx-gate-eyebrow">Required before accessing your portal</p>
          {/* Title and version are printed once, by the agreement itself. */}
          <p className="cx-gate-meta" data-version={agreementVersion}>
            Workspace: <strong>{workspaceLabel}</strong>
          </p>
        </header>

        <div className="cx-gate-scroll">
          <AgreementBox
            title={agreementTitle}
            version={agreementVersion}
            html={agreementHtml}
            entity={brandFromTitle(agreementTitle)}
            pdfMeta={[`Workspace: ${workspaceLabel}`]}
            bodyClassName="cx-gate-doc"
            testId="cx-gate-agreement"
          />

          <section className="cx-gate-sign" aria-label="Sign the agreement">
            <h3 className="cx-gate-sign-title">Sign the agreement</h3>

            <div className="cx-gate-field">
              <label htmlFor="cx-gate-name">Type your full legal name as your electronic signature</label>
              <input
                id="cx-gate-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Jane Smith"
                autoComplete="name"
              />
              <p>
                Your typed name constitutes a binding electronic signature (E-SIGN Act, 15 U.S.C. § 7001).
                A signed copy will be emailed to you and archived on your account.
              </p>
            </div>

            <div className={`cx-gate-sigline${name.trim().length >= 3 ? ' is-filled' : ''}`} aria-hidden="true">
              <b>×</b>
              {name.trim().length >= 3 ? <span className="cx-gate-signame">{name.trim()}</span> : <span className="cx-gate-sigph">Your signature appears here</span>}
            </div>

            <label className={`cx-gate-check${agreed ? ' is-on' : ''}`}>
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

            {error && <p className="cx-gate-error" role="alert">Error: {error}</p>}

            <button type="button" className="cx-gate-submit" onClick={submit} disabled={!canSign || pending}>
              {pending ? 'Signing…' : 'I agree — sign electronically'}
            </button>
            <p className="cx-gate-fine">
              Workspace: <strong>{workspaceLabel}</strong>
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}

// The PDF names who the agreement is with: the title's own prefix ("Suite CXO
// — ..." or an org's name on the Pinnacle edition), else Suite CXO.
function brandFromTitle(title: string): string {
  const head = title.split(' — ')[0]?.trim()
  return head && head !== title ? head : 'Suite CXO'
}
