'use client'

/**
 * Sign out, as its own row on Me. A tap asks first, on the page (no browser
 * dialog): the row opens into "Sign out of …?" with Cancel and Sign out.
 * Sign out is then the same /logout link it always was.
 */
import { useState } from 'react'

export default function PhoneSignOut({ href, company, demo = false }: { href: string; company: string; /** The public demo: there is no account, so confirming only closes the question. */ demo?: boolean }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return (
      <button type="button" className="row out" onClick={() => setAsking(true)} aria-expanded={false}>
        <span className="ic" aria-hidden>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3.5H5.5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2H8" /><path d="M12.5 6.5 16 10l-3.5 3.5M16 10H7.5" /></svg>
        </span>
        <span className="t"><b>Sign out</b></span>
      </button>
    )
  }
  return (
    <div className="cxph-confirm" role="group" aria-label="Sign out">
      <b>Sign out of {company}?</b>
      <small>{demo ? 'This is the demo, so there is no account to sign out of.' : 'You will need your email and password to come back in.'}</small>
      <div className="cxph-acts">
        <button type="button" className="cxph-btn ghost grow" onClick={() => setAsking(false)} autoFocus>Cancel</button>
        {demo ? (
          <button type="button" className="cxph-btn grow" onClick={() => setAsking(false)}>Sign out</button>
        ) : (
          // A plain link, not a router link: /logout must never be prefetched.
          <a href={href} className="cxph-btn grow">Sign out</a>
        )}
      </div>
    </div>
  )
}
