import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TIER_INFO } from '@/lib/onboarding'
import { supabase } from '@/lib/supabase'
import { setSessionCookie } from '@/lib/client-auth'
import crypto from 'node:crypto'
import KickoffCallModal from './KickoffCallModal'

const KICKOFF_URL = 'https://cal.com/team/virtual-closer/kick-off-call'

export const dynamic = 'force-dynamic'

type TierKey = keyof typeof TIER_INFO

async function verifyWelcomeToken(token: string): Promise<string | null> {
  try {
    const decoded = Buffer.from(token, 'base64url').toString()
    const parts = decoded.split('.')
    if (parts.length !== 3) return null
    const [memberId, ts, sig] = parts
    const age = Date.now() - Number(ts)
    if (!Number.isFinite(age) || age < 0 || age > 1000 * 60 * 60 * 24) return null
    const secret = process.env.SESSION_SECRET ?? 'dev-secret'
    const expected = crypto.createHmac('sha256', secret).update(`${memberId}.${ts}`).digest('hex').slice(0, 32)
    if (sig !== expected) return null
    return memberId
  } catch {
    return null
  }
}

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ tier?: string; token?: string; session_id?: string; flow?: string }>
}) {
  const sp = await searchParams
  // True when the buyer arrives from Stripe Checkout (build-fee or sub).
  const fromCheckout = !!sp.session_id
  const buildFeePaid = sp.flow === 'build_fee'

  // Magic-link path: token from welcome email → sign in + redirect.
  if (sp.token) {
    const memberId = await verifyWelcomeToken(sp.token)
    if (memberId) {
      const { data: m } = await supabase
        .from('members')
        .select('id, rep_id')
        .eq('id', memberId)
        .maybeSingle()
      if (m) {
        const { data: rep } = await supabase.from('reps').select('slug').eq('id', m.rep_id).single()
        await setSessionCookie((rep as { slug: string }).slug, m.id as string).catch(() => {})
        redirect('/dashboard?welcome=1')
      }
    }
  }

  const tierParam = sp.tier
  const tier = (tierParam && tierParam in TIER_INFO ? tierParam : 'individual') as TierKey
  const info = TIER_INFO[tier]

  return (
    <main className="wrap">
      {fromCheckout && <KickoffCallModal buildFeePaid={buildFeePaid} />}
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
                  href={KICKOFF_URL}
                  className="btn approve"
                  style={{ textDecoration: 'none' }}
                  target="_blank"
                  rel="noopener noreferrer"
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
