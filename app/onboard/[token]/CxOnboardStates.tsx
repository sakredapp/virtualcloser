import CxAuthCard from '@/app/components/cxo/CxAuthCard'
import CxOnboardSteps, { cxOnboardSteps } from './CxOnboardSteps'

/**
 * CXO onboarding states other than signing (done, expired, pay). They use
 * the CXO sign-in card so the whole flow looks like the login and the
 * password screens.
 */

export function CxOnboardDone({ name, email, rootDomain }: { name: string; email: string | null; rootDomain: string }) {
  const firstName = name.split(' ')[0] || name
  return (
    <CxAuthCard
      title={`You're all set, ${firstName}`}
      sub="Your agreement is signed and recorded."
    >
      <span className="cx-login-check" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
      </span>
      <p className="cx-login-note">
        Check your email{email ? (
          <>
            {' '}at <strong>{email}</strong>
          </>
        ) : null}{' '}
        for a link to set your password. It usually arrives within a minute. Your signed copy of the agreement
        comes in a separate email.
      </p>
      <a className="cx-login-submit" href={`https://${rootDomain}/login`}>
        Go to sign in
      </a>
    </CxAuthCard>
  )
}

export function CxOnboardExpired() {
  return (
    <CxAuthCard title="Link expired" sub="This onboarding link is no longer active.">
      <p className="cx-login-note">Ask your contact for a new onboarding link.</p>
    </CxAuthCard>
  )
}

export function CxOnboardInvalid() {
  return (
    <CxAuthCard title="This link isn't valid" sub="We couldn't find this onboarding link.">
      <p className="cx-login-note">Check the link in your email, or ask your contact for a new onboarding link.</p>
    </CxAuthCard>
  )
}

export function CxOnboardPay({
  signatureName,
  feeDollars,
  checkoutUrl,
}: {
  signatureName: string
  feeDollars: string
  checkoutUrl: string
}) {
  const firstName = signatureName.split(' ')[0] || signatureName
  return (
    <CxAuthCard
      title="One last step"
      sub={`Thanks${firstName ? `, ${firstName}` : ''}. Your agreement is signed and recorded.`}
    >
      <CxOnboardSteps compact steps={cxOnboardSteps({ hasBuildFee: true, feeDollars, current: 'pay' })} />
      <p className="cx-login-fee">
        ${feeDollars}
        <small>one-time setup fee</small>
      </p>
      <p className="cx-login-note">Pay securely with Whop. Right after, we email you a link to set your password.</p>
      <a className="cx-login-submit" href={checkoutUrl}>
        Pay ${feeDollars}
      </a>
    </CxAuthCard>
  )
}
