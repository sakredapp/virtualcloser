import Link from 'next/link'
import type { BrandConfig } from '@/lib/brand'
import { CXO_LEGAL_EFFECTIVE_DATE } from '@/app/privacy/CxoPrivacy'

/**
 * Suite CXO Terms of Service. Virtual Closer keeps its own copy in page.tsx.
 * AI-drafted from what the product does (owner 2026-10-16), not lawyer-reviewed.
 * No prices or buy links here: this page also opens inside the store app.
 */
export function CxoTerms({ brand }: { brand: BrandConfig }) {
  const supportMailto = `mailto:${brand.supportEmail}`
  const n = brand.assistantName
  return (
    <main className="wrap">
      <header className="hero">
        <h1>Terms of Service</h1>
        <p className="sub">Effective {CXO_LEGAL_EFFECTIVE_DATE}</p>
        <p className="nav nav-links">
          <Link href="/">← Home</Link>
          <Link href="/privacy">Privacy Policy</Link>
        </p>
      </header>

      <section className="card">
        <div className="section-head"><h2>Agreement</h2></div>
        <p className="meta">
          By accessing or using {brand.name} (&quot;the Service&quot;), you agree to these Terms. If you
          do not agree, do not use the Service. These Terms apply to every company that subscribes and
          to every person who signs in. If your company signed the {brand.name} Operational &amp;
          Liability Agreement in the app, that agreement controls where it differs from these Terms.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>The Service</h2></div>
        <p className="meta">
          {brand.name} is an operations dashboard for a company&apos;s executives and employees. It
          includes a morning brief, to-do lists, team messages, meeting notes, company numbers and an AI
          assistant named {n} that can read the accounts you connect (such as Google Calendar,
          QuickBooks and meeting-note tools), answer questions and draft work for you. {n} does not
          read your email; Gmail is connected only on an edition set up by agreement with your company.
          Each company has its own address at yourcompany.{brand.rootDomain}. What each person can see
          depends on the role their company gives them. Features change over time.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Your account</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">Your company controls its workspace</p><p className="meta">Your company decides who gets an account and which role each person has. You are responsible for all activity under your account and for keeping your sign-in secure.</p></div></li>
          <li className="row"><div><p className="name">Accounts you connect</p><p className="meta">Only connect calendar, finance or other accounts you are allowed to connect. You can disconnect them at any time.</p></div></li>
          <li className="row"><div><p className="name">Accurate information</p><p className="meta">Keep your account and billing information accurate and up to date.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Acceptable use</h2></div>
        <p className="meta" style={{ marginBottom: '0.6rem' }}>You agree not to:</p>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="meta">Use the Service to send spam or unsolicited bulk messages, or anything that breaks CAN-SPAM, GDPR or other anti-spam laws.</p></div></li>
          <li className="row"><div><p className="meta">Attempt to reverse-engineer, scrape, or extract the underlying AI prompts or system architecture.</p></div></li>
          <li className="row"><div><p className="meta">Store or process data in the Service in violation of any law or anyone else&apos;s rights.</p></div></li>
          <li className="row"><div><p className="meta">Resell or sublicense access to the Service without written permission.</p></div></li>
          <li className="row"><div><p className="meta">Try to get around security controls, or reach another company&apos;s or another person&apos;s data.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Billing and cancellation</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">Subscriptions</p><p className="meta">Subscriptions are billed monthly in advance, at the price agreed when your company signed up.</p></div></li>
          <li className="row"><div><p className="name">Cancellation</p><p className="meta">You may cancel at any time. Cancellation takes effect at the end of the current billing period. No refunds are issued for partial months.</p></div></li>
          <li className="row"><div><p className="name">Non-payment</p><p className="meta">We may suspend or end accounts with overdue balances after reasonable notice.</p></div></li>
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>AI-generated content</h2></div>
        <p className="meta">
          {n} uses AI to write briefs, summaries, answers, to-dos and email drafts. AI can be wrong.
          You are responsible for reviewing anything {n} produces before you rely on it or send it,
          and for the business decisions you make. {brand.name} makes no warranty that AI output is
          accurate, complete or right for your situation.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Google and other connected accounts</h2></div>
        <p className="meta">
          When you connect a Google account, you allow {brand.name} to use the Google data you approve
          on the consent screen to run the features you use. You can revoke access at any time from
          the app or at{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            Google Account Permissions
          </a>. {brand.name}&apos;s use of information received from Google APIs follows the Google API
          Services User Data Policy, including the Limited Use requirements. Other connected services
          (such as QuickBooks) are also governed by their own terms.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Intellectual property</h2></div>
        <p className="meta">
          Your company keeps ownership of all data it brings into the Service. {brand.name} keeps
          ownership of the platform, the AI system, prompts and infrastructure. We grant you a limited,
          non-transferable license to use the Service for your internal business purposes.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Limitation of liability</h2></div>
        <p className="meta">
          To the fullest extent permitted by law, {brand.name} is not liable for any indirect,
          incidental, special, or consequential damages arising from your use of the Service,
          including lost revenue or data loss. Our total liability to you for any claim is limited to
          the fees you paid in the 3 months before the claim.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Termination</h2></div>
        <p className="meta">
          We may suspend or end your access if you breach these Terms, without notice for serious
          breaches. After termination, your company&apos;s data is kept for 90 days and then permanently
          deleted, unless you ask us to delete it sooner.
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
          We may update these Terms. We will notify you by email or a notice in the app at least 14
          days before material changes take effect. Continued use after that date means you accept
          the change.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Contact</h2></div>
        <p className="meta">
          For any questions about these Terms, contact us at{' '}
          <a href={supportMailto}>{brand.supportEmail}</a>.
        </p>
      </section>

      <footer style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        <Link href="/privacy">Privacy Policy</Link>
        {' · '}
        <a href={supportMailto}>{brand.supportEmail}</a>
        {' · '}
        © {brand.name}
      </footer>
    </main>
  )
}
