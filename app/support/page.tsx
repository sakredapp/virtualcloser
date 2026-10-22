import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentBrand } from '@/lib/brand'
import { CXO_SITE_NAME, cxoPageMeta } from '@/lib/seo'

// dynamic because we read request headers to detect the brand
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const brand = await getCurrentBrand()
  if (brand.key !== 'cxo') return {}
  return cxoPageMeta('/support', 'Support', `How to get help with ${CXO_SITE_NAME}, sign in, or delete your account.`)
}

/**
 * Suite CXO support page (the App Store "Support URL"). Suite CXO only: other
 * brands get a 404. Same look as CxoPrivacy. It also opens inside the store
 * app, so no prices or buy links. Keep it to what the product does: no
 * texting, calling, sales tools, ads or customer email inbox.
 */
export default async function SupportPage() {
  const brand = await getCurrentBrand()
  if (brand.key !== 'cxo') notFound()
  const email = brand.supportEmail
  const mailto = `mailto:${email}`
  const n = brand.assistantName
  const name = brand.name
  return (
    <main className="wrap">
      <header className="hero">
        <h1>Support</h1>
        <p className="sub">How can we help?</p>
        <p className="nav">
          <Link href="/">← Home</Link>
          <span>·</span>
          <Link href="/privacy">Privacy Policy</Link>
          <span>·</span>
          <Link href="/terms">Terms of Service</Link>
        </p>
      </header>

      <section className="card">
        <div className="section-head"><h2>Email us</h2></div>
        <p className="meta">
          Write to <a href={mailto}>{email}</a>. We reply within one business day, Monday to Friday.
          Please send it from the email address on your {name} account, or include that address, so we
          can find your account.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>What {name} is</h2></div>
        <p className="meta">
          {n} by {name} is one company AI your team logs into, connected to your company&apos;s data.
          Each person only sees what their role allows, your data is never used to train AI, and every
          answer is checked.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Sign in</h2></div>
        <p className="meta">
          Your company sets up your account and sends you an invite. Sign in on the web at{' '}
          <Link href="/login">{brand.rootDomain}/login</Link> or in the {name} app with the same email
          and password. Forgot your password? Use{' '}
          <Link href="/forgot-password">reset your password</Link>.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }} id="delete-account">
        <div className="section-head"><h2>Delete your account</h2></div>
        <p className="meta">
          In the app, tap your picture at the top to open your account, then tap Delete account. On the
          web, go to Settings and use Delete account. Or email <a href={mailto}>{email}</a> from your
          account&apos;s email address and we will delete the account and its data. We email you when it
          is done.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Found a bug?</h2></div>
        <p className="meta">
          Email <a href={mailto}>{email}</a> with what you did, what you expected and what happened. A
          screenshot helps.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Privacy and terms</h2></div>
        <p className="meta">
          Read our <Link href="/privacy">Privacy Policy</Link> and{' '}
          <Link href="/terms">Terms of Service</Link>.
        </p>
      </section>

      <footer style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        Questions? <a href={mailto}>{email}</a>
        {' · '}
        <Link href="/privacy">Privacy</Link>
        {' · '}
        <Link href="/terms">Terms</Link>
        {' · '}
        © {name}
      </footer>
    </main>
  )
}
