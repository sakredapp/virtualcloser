import Link from 'next/link'
import { TIER_INFO } from '@/lib/onboarding'

export const dynamic = 'force-static'

type TierKey = keyof typeof TIER_INFO

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string }>
}) {
  const { tier: tierParam } = await searchParams
  const tier = (tierParam && tierParam in TIER_INFO ? tierParam : 'salesperson') as TierKey
  const info = TIER_INFO[tier]

  return (
    <main className="wrap">
      <header className="hero">
        <p className="eyebrow">Welcome to Virtual Closer</p>
        <h1>You&apos;re in. Here&apos;s what happens next.</h1>
        <p className="sub">
          You bought the <strong>{info.label}</strong> plan. Three things in the next 10 minutes —
          then we handle the rest of the build.
        </p>
      </header>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>Do these 3 things now</h2>
          <p>~10 min total</p>
        </div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row">
            <div>
              <p className="name">1. Book your kickoff call</p>
              <p className="meta">
                30-min discovery call so we can tune the AI to your voice, ICP, and objections.
              </p>
              <p className="subject" style={{ marginTop: '0.4rem' }}>
                <Link
                  href="https://cal.com/virtualcloser/kickoff"
                  className="btn approve"
                  style={{ textDecoration: 'none' }}
                >
                  Book kickoff call →
                </Link>
              </p>
            </div>
          </li>
          <li className="row">
            <div>
              <p className="name">2. Export your current leads as CSV</p>
              <p className="meta">
                From whatever you use today (HubSpot, Pipedrive, Google Sheet, Notion). Columns
                we need: <code>name, email, company, last_contact, notes</code>. Don&apos;t worry
                about format — we clean it up.
              </p>
            </div>
          </li>
          <li className="row">
            <div>
              <p className="name">3. Connect the Telegram bot</p>
              <p className="meta">
                Open Telegram, search <strong>@VirtualCloserBot</strong>, tap Start, and send{' '}
                <code>/link me</code>. Reply to our welcome email with the number the bot sends
                back. That&apos;s how you&apos;ll text and voice-note your CRM from anywhere.
              </p>
            </div>
          </li>
        </ul>
      </section>

      <section className="card" style={{ marginBottom: '0.8rem' }}>
        <div className="section-head">
          <h2>What we do next (you don&apos;t lift a finger)</h2>
        </div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          <li className="row"><div><p className="name">Build your branded sub-domain</p><p className="meta">yourname.virtualcloser.com — live within 24 hours of the kickoff call.</p></div></li>
          <li className="row"><div><p className="name">Import your leads</p><p className="meta">We take the CSV you send and drop it into your dashboard.</p></div></li>
          <li className="row"><div><p className="name">Tune the AI to your voice</p><p className="meta">Based on the kickoff call, we bake your ICP + objections into the playbook.</p></div></li>
          <li className="row"><div><p className="name">Send you a dashboard walkthrough</p><p className="meta">10-min Loom showing exactly how to approve drafts, voice brain-dump, and text the bot.</p></div></li>
          <li className="row"><div><p className="name">Go live</p><p className="meta">You start approving drafts day one. We stay on to tune.</p></div></li>
        </ul>
      </section>

      <section className="card">
        <div className="section-head">
          <h2>Questions?</h2>
        </div>
        <p className="meta">
          Reply to the email we just sent, or{' '}
          <Link href="mailto:hello@virtualcloser.com">hello@virtualcloser.com</Link>. We read every message.
        </p>
      </section>

      <footer style={{ color: 'var(--muted-inv)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        © Virtual Closer · An AI assistant that pays for itself.
      </footer>
    </main>
  )
}
