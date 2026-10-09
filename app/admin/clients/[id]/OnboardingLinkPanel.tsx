import type { ReactNode } from 'react'

export type OnboardingLinkState = {
  /** On the tenant's own brand domain (lib/onboardingUrl). */
  url: string
  expiresAt: string
  expired: boolean
  signed: boolean
  paid: boolean
  feeCents: number
  loginLinkSent: boolean
}

/**
 * Admin "Onboarding link" card body: what the link does, the active link and
 * its progress. The generate/regenerate form is passed in as children.
 */
export default function OnboardingLinkPanel({
  brandName,
  link,
  children,
}: {
  brandName: string
  link: OnboardingLinkState | null
  children?: ReactNode
}) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })
  const yes = (v: boolean) => (v ? '✓' : '—')
  return (
    <>
      <div className="section-head">
        <h2>Onboarding link</h2>
      </div>
      <p className="meta" style={{ marginBottom: '0.7rem' }}>
        Send this one link to the client. They sign the {brandName} Operational &amp; Liability
        Agreement{link && link.feeCents > 0 ? ', pay the setup fee' : ''}, then automatically get a
        &ldquo;Your login is ready&rdquo; email to set their password. No password is ever emailed.
      </p>

      {link && !link.expired && (
        <div
          style={{
            marginBottom: '0.8rem',
            padding: '0.7rem 0.9rem',
            background: 'rgba(22,163,74,0.06)',
            border: '1px solid rgba(22,163,74,0.2)',
            borderRadius: 10,
          }}
        >
          <p className="name" style={{ marginBottom: 4 }}>Active link</p>
          <code data-testid="onboarding-url" style={{ fontSize: '0.82rem', wordBreak: 'break-all', color: 'var(--royal)' }}>
            {link.url}
          </code>
          <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--muted)' }}>
            <span>Expires: {fmt(link.expiresAt)}</span>
            <span>·</span>
            <span>Signed: {yes(link.signed)}</span>
            {link.feeCents > 0 && (
              <>
                <span>·</span>
                <span>Paid: {yes(link.paid)}</span>
              </>
            )}
            <span>·</span>
            <span>Login link sent: {yes(link.loginLinkSent)}</span>
          </div>
        </div>
      )}

      {link && link.expired && (
        <p className="meta" style={{ marginBottom: '0.7rem', color: '#fcb293' }}>
          Previous link expired ({fmt(link.expiresAt)}). Generate a new one below.
        </p>
      )}

      {children}
    </>
  )
}
