import Link from 'next/link'

export const dynamic = 'force-static'

export default function PrivacyPage() {
  return (
    <main className="wrap">
      <header className="hero">
        <h1>Privacy Policy</h1>
        <p className="sub">Last updated: April 2026</p>
        <p className="nav">
          <Link href="/">← Home</Link>
          <span>·</span>
          <Link href="/terms">Terms of Service</Link>
        </p>
      </header>

      <section className="card">
        <div className="section-head"><h2>Who we are</h2></div>
        <p className="meta">
          Virtual Closer (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) provides an AI-powered sales
          assistant platform at virtualcloser.com. Our registered business contact is{' '}
          <a href="mailto:hello@virtualcloser.com">hello@virtualcloser.com</a>.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>What data we collect</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div>
            <p className="name">Account information</p>
            <p className="meta">Your name, email address, and company name when you sign up.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">CRM / pipeline data</p>
            <p className="meta">Lead names, email addresses, companies, notes, and deal statuses that you or your team enter into the platform.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Voice and text inputs</p>
            <p className="meta">Messages and voice notes you send via Telegram or the dashboard. These are processed by Anthropic Claude to generate outputs and are not used to train AI models.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Google Calendar data</p>
            <p className="meta">If you connect Google Calendar, we read and create calendar events on your behalf using OAuth 2.0. We store only the tokens needed to perform actions you request. We do not read past events beyond what is needed for the daily schedule briefing feature.</p>
          </div></li>
          <li className="row"><div>
            <p className="name">Usage data</p>
            <p className="meta">Standard server logs including IP addresses, browser type, and pages visited. We use this to keep the platform running reliably.</p>
          </div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>How we use your data</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">To deliver the service</p><p className="meta">Generating AI drafts, running daily pipeline scans, sending Telegram briefings, and creating calendar events.</p></div></li>
          <li className="row"><div><p className="name">To improve reliability</p><p className="meta">Diagnosing errors, monitoring uptime, and fixing bugs.</p></div></li>
          <li className="row"><div><p className="name">To communicate with you</p><p className="meta">Onboarding, billing, and support emails. We do not send marketing emails without your consent.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Who we share data with</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">Anthropic</p><p className="meta">Your inputs are sent to Anthropic's Claude API to generate AI responses. Anthropic's privacy policy applies to this processing.</p></div></li>
          <li className="row"><div><p className="name">Supabase</p><p className="meta">Our database provider. Data is stored in the EU (Frankfurt) region by default.</p></div></li>
          <li className="row"><div><p className="name">Vercel</p><p className="meta">Our hosting provider. Requests are processed on Vercel's global edge network.</p></div></li>
          <li className="row"><div><p className="name">Google</p><p className="meta">Only if you connect Google Calendar. Your OAuth tokens are stored securely and only used to perform actions you explicitly request.</p></div></li>
          <li className="row"><div><p className="name">No one else</p><p className="meta">We do not sell, rent, or broker your data to any third party for any purpose.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Data retention</h2></div>
        <p className="meta">
          Your data is retained for the duration of your subscription plus 90 days after cancellation,
          after which it is permanently deleted. You can request earlier deletion at any time by emailing{' '}
          <a href="mailto:hello@virtualcloser.com">hello@virtualcloser.com</a>.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Your rights</h2></div>
        <p className="meta">
          You have the right to access, correct, export, or delete your personal data at any time.
          You can disconnect Google Calendar from your dashboard at any time, which immediately revokes
          our access token. For any data requests, email{' '}
          <a href="mailto:hello@virtualcloser.com">hello@virtualcloser.com</a>.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Security</h2></div>
        <p className="meta">
          All data is encrypted in transit (TLS 1.2+) and at rest. OAuth tokens are stored encrypted
          in our database. We perform regular security reviews and follow OWASP best practices.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Changes to this policy</h2></div>
        <p className="meta">
          We may update this policy. Material changes will be communicated via email or a notice on
          the dashboard. Continued use after changes constitutes acceptance.
        </p>
      </section>

      <footer style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        Questions? <a href="mailto:hello@virtualcloser.com">hello@virtualcloser.com</a>
        {' · '}
        <Link href="/terms">Terms of Service</Link>
        {' · '}
        © Virtual Closer
      </footer>
    </main>
  )
}
