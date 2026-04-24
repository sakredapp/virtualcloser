import Link from 'next/link'

export const dynamic = 'force-static'

export default function TermsPage() {
  return (
    <main className="wrap">
      <header className="hero">
        <h1>Terms of Service</h1>
        <p className="sub">Last updated: April 2026</p>
        <p className="nav">
          <Link href="/">← Home</Link>
          <span>·</span>
          <Link href="/privacy">Privacy Policy</Link>
        </p>
      </header>

      <section className="card">
        <div className="section-head"><h2>Agreement</h2></div>
        <p className="meta">
          By accessing or using Virtual Closer (&quot;the Service&quot;), you agree to be bound by
          these Terms. If you do not agree, do not use the Service. These Terms apply to all clients,
          users, and anyone who accesses the platform.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>The Service</h2></div>
        <p className="meta">
          Virtual Closer provides an AI-assisted sales pipeline management platform, including a
          dashboard, Telegram bot integration, AI-generated follow-up drafts, Google Calendar sync,
          and daily briefings. Features available depend on your subscription tier.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Your account</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">You are responsible for your account</p><p className="meta">Keep your credentials secure. You are responsible for all activity under your account.</p></div></li>
          <li className="row"><div><p className="name">One account per subscription</p><p className="meta">Your subscription covers the number of seats specified in your tier. Team Builder and Executive tiers may add additional users as described at virtualcloser.com/offer.</p></div></li>
          <li className="row"><div><p className="name">Accurate information</p><p className="meta">You agree to provide accurate account and billing information and to keep it up to date.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Acceptable use</h2></div>
        <p className="meta" style={{ marginBottom: '0.6rem' }}>You agree not to:</p>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="meta">Use the Service to send spam, unsolicited bulk messages, or anything that violates CAN-SPAM, GDPR, or applicable anti-spam laws.</p></div></li>
          <li className="row"><div><p className="meta">Attempt to reverse-engineer, scrape, or extract the underlying AI prompts or system architecture.</p></div></li>
          <li className="row"><div><p className="meta">Use the Service to store or process data in violation of any applicable law or the rights of third parties.</p></div></li>
          <li className="row"><div><p className="meta">Resell or sublicense access to the Service without written permission.</p></div></li>
          <li className="row"><div><p className="meta">Attempt to circumvent security controls or access another user's account or data.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Billing and cancellation</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">Monthly subscriptions</p><p className="meta">Subscriptions are billed monthly in advance. The one-time build fee is charged separately at the start of the engagement.</p></div></li>
          <li className="row"><div><p className="name">Cancellation</p><p className="meta">You may cancel at any time. Cancellation takes effect at the end of the current billing period. No refunds are issued for partial months.</p></div></li>
          <li className="row"><div><p className="name">Non-payment</p><p className="meta">We reserve the right to suspend or terminate accounts with overdue balances after reasonable notice.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>AI-generated content</h2></div>
        <p className="meta">
          The Service uses AI to generate email drafts, summaries, and recommendations.
          You are solely responsible for reviewing, editing, and approving any AI-generated content
          before use. Virtual Closer makes no warranty that AI outputs are accurate, complete,
          or appropriate for your specific situation. Always review before sending.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Google Calendar integration</h2></div>
        <p className="meta">
          When you connect Google Calendar, you grant Virtual Closer permission to read and create
          calendar events on your behalf. You can revoke this permission at any time from your
          dashboard or directly via{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            Google Account Permissions
          </a>. Virtual Closer&apos;s use of Google Calendar data is governed by Google&apos;s API Services
          User Data Policy, including the Limited Use requirements.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Intellectual property</h2></div>
        <p className="meta">
          You retain ownership of all data you bring into the Service (your leads, notes, pipeline
          data). Virtual Closer retains ownership of the platform, AI system, prompts, and
          infrastructure. We grant you a limited, non-transferable license to use the Service for
          your internal business purposes.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Limitation of liability</h2></div>
        <p className="meta">
          To the fullest extent permitted by law, Virtual Closer is not liable for any indirect,
          incidental, special, or consequential damages arising from your use of the Service,
          including lost revenue, lost deals, or data loss. Our total liability to you for any
          claim is limited to the fees you paid in the 3 months preceding the claim.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Termination</h2></div>
        <p className="meta">
          We may suspend or terminate your access if you breach these Terms, with or without notice
          for material breaches. Upon termination, your data will be retained for 90 days and then
          permanently deleted, unless you request earlier deletion.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Governing law</h2></div>
        <p className="meta">
          These Terms are governed by the laws of the State of Florida, United States, without
          regard to conflict of law principles. Any disputes shall be resolved in the courts of
          Florida.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Changes to these Terms</h2></div>
        <p className="meta">
          We may update these Terms. We will notify you by email or dashboard notice at least 14
          days before material changes take effect. Continued use after that date constitutes
          acceptance.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Contact</h2></div>
        <p className="meta">
          For any questions about these Terms, contact us at{' '}
          <a href="mailto:hello@virtualcloser.com">hello@virtualcloser.com</a>.
        </p>
      </section>

      <footer style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        <Link href="/privacy">Privacy Policy</Link>
        {' · '}
        <a href="mailto:hello@virtualcloser.com">hello@virtualcloser.com</a>
        {' · '}
        © Virtual Closer
      </footer>
    </main>
  )
}
