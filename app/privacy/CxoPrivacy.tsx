import Link from 'next/link'
import type { BrandConfig } from '@/lib/brand'

/** Effective date shown on the Suite CXO privacy policy and terms. */
export const CXO_LEGAL_EFFECTIVE_DATE = 'October 16, 2026'

/**
 * Suite CXO Privacy Policy. Virtual Closer keeps its own copy in page.tsx.
 *
 * AI-drafted from what the code does (owner 2026-10-16), not lawyer-reviewed.
 * Every processor and data type below was checked against the code: keep this
 * page in step when an integration or AI provider is added or removed
 * (lib/aiProvider.ts, lib/google.ts GOOGLE_SCOPE, lib/qbo, lib/mcp, lib/email.ts).
 * No prices or buy links here: this page also opens inside the store app.
 */
export function CxoPrivacy({ brand }: { brand: BrandConfig }) {
  const supportMailto = `mailto:${brand.supportEmail}`
  const n = brand.assistantName
  const name = brand.name
  const item = (title: string, body: React.ReactNode) => (
    <li className="row"><div><p className="name">{title}</p><p className="meta">{body}</p></div></li>
  )
  return (
    <main className="wrap">
      <header className="hero">
        <h1>Privacy Policy</h1>
        <p className="sub">Effective {CXO_LEGAL_EFFECTIVE_DATE}</p>
        <p className="nav">
          <Link href="/">← Home</Link>
          <span>·</span>
          <Link href="/terms">Terms of Service</Link>
        </p>
      </header>

      <section className="card">
        <div className="section-head"><h2>Who we are</h2></div>
        <p className="meta">
          {name} (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) is an operations dashboard for a
          company&apos;s executives and employees, with an AI assistant named {n}. It runs at{' '}
          {brand.rootDomain}, where each customer company gets its own address
          (yourcompany.{brand.rootDomain}), and in our phone app. This policy explains what we collect,
          why, who we share it with and the choices you have. Questions:{' '}
          <a href={supportMailto}>{brand.supportEmail}</a>.
        </p>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
          We provide {name} to businesses. The company that signs up decides who gets an account and
          what each role can see, and the work data in its workspace belongs to that company. We
          process it on the company&apos;s behalf to run the service.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>What we collect</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          {item('Account information', 'Your name, work email, role, time zone and a password, which we store only as a one-way hash. Sign-in and account events (for example a login or an invite) are logged, and these logs can include IP address and browser type.')}
          {item('Requests to get started', 'If you fill in the request form on our website: your name, email, company, role and any note you add.')}
          {item('Work you put into the app', 'To-dos, boards, notes, brain dumps, team messages, partner records, your revenue plan, and employee records your company adds (such as quotas, time off, reviews, compensation tiers and payroll or commission entries).')}
          {item('Files you upload', 'Spreadsheets, PDFs and Word files you upload (for example an employee list or a revenue plan) are read so their contents can be filled into the app. We keep the extracted information, not the file.')}
          {item('Conversations with ' + n, `What you ask ${n} and what ${n} answers, plus the briefs, summaries, drafts and suggestions it writes for you.`)}
          {item('Usage information', 'Which pages of the app each person opens each day, how often they sign in and how many questions they ask. Your company’s admins can see this to understand how the team uses the app. We also log errors so we can fix them.')}
          {item('Phone app', 'If you use our phone app and allow notifications, we store the device’s notification token and platform. Face ID or fingerprint unlock, if you turn it on, stays on your device; we never receive it.')}
          {item('Billing', 'If you pay by card in the app, our payment processor handles the card. We keep only the card brand and last four digits.')}
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Accounts you connect</h2></div>
        <p className="meta" style={{ marginBottom: '0.6rem' }}>
          Nothing is connected unless you or your company connect it, and you can disconnect at any time.
        </p>
        <ul className="list" style={{ maxHeight: 'none' }}>
          {item('Google calendar and email', <>When you connect a Google account you approve access on Google&apos;s consent screen: read and create calendar events and check free and busy times; use Google Sheets; and Google Drive files the app creates or you open with it. We read your calendar to build your day, prepare for meetings and book times you ask for. {n} books a meeting only when you ask it to. {n} does not read your email: Gmail access is asked for only on an edition set up by agreement with your company to include an email inbox. On that edition the consent screen also asks to read, label and send Gmail; we copy your email threads and messages (including their text) into our database so {n} can sort them, find what needs a reply and draft answers, and {n} sends an email only when you ask it to.</>)}
          {item('QuickBooks', 'Execs can connect QuickBooks. We read reports only, such as profit and loss, expenses, revenue by customer and class, and the employee and time-activity lists, to show the company’s numbers. We never change anything in QuickBooks. Disconnecting deletes the QuickBooks data we copied.')}
          {item('Meeting notes', <>If you connect a note-taker such as Plaud or Wispr Flow (usually through your own Zapier account), the meeting notes and transcripts you send us are stored so {n} can turn them into to-dos, briefs and follow-ups. {name} does not join or record your meetings and does not receive audio.</>)}
          {item('Calendar feeds', 'Calendar links (ICS) you add are fetched by our servers to show those events.')}
          {item('Your own AI app', <>You can create a personal key that lets an AI app you use (for example Claude or ChatGPT) ask {name} about your company and, when you confirm, take actions such as drafting a message or booking a meeting. What that AI app receives is handled under its own provider&apos;s terms. You can revoke a key at any time in Integrations.</>)}
          {item('Other company systems', 'If your company asks us to connect another system (for example a spreadsheet or database it already uses), we read the records it shares with us to show them in the app.')}
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>How we use it</h2></div>
        <ul className="list" style={{ maxHeight: 'none' }}>
          {item('To run the service', `Showing your dashboard, building your morning brief and to-do list, preparing meeting briefs, sending reminders and alerts, and answering what you ask ${n}. On an edition that includes the email inbox, also sorting your inbox.`)}
          {item(`To improve ${n} for your company`, `We look at how your team uses ${n} (for example questions it could not answer, and suggestions people accept or dismiss) to improve its instructions for your company. This does not train an AI model.`)}
          {item('To keep it working and secure', 'Diagnosing errors, preventing abuse and keeping each company’s data separate.')}
          {item('To support you', 'Our team can open your workspace to set it up and to troubleshoot problems you report.')}
          {item('To contact you', 'Sign-in links, invites, alerts and service emails. We do not send marketing email without your consent.')}
        </ul>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>AI processing</h2></div>
        <p className="meta">
          {n}&apos;s answers and the briefs, summaries and drafts it writes are produced by AI models we
          reach through OpenRouter. Every request is sent with data collection turned off and zero data
          retention required, so only model hosts that do not store your data or use it for training
          are used. We send only what a task needs, and pay columns in uploaded employee spreadsheets are
          removed before AI reads them. Your company&apos;s data is never used to train an AI model.
        </p>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
          When {n} searches the web for you, the search words are sent to our search provider, Tavily.
          If you speak to {n} instead of typing, your browser&apos;s built-in speech recognition turns
          your voice into text; depending on your browser, that may be handled by its maker (such as
          Google or Apple). We receive only the text.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Google user data</h2></div>
        <p className="meta">
          {name}&apos;s use and transfer of information received from Google APIs adheres to the{' '}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
            Google API Services User Data Policy
          </a>, including the Limited Use requirements. We use Google data only to provide the features
          you use in {name}. We do not sell it, use it for advertising, or use it to develop, improve or
          train AI models, and people at {name} do not read it except with your permission, for security,
          or to comply with the law.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Who we share it with</h2></div>
        <p className="meta" style={{ marginBottom: '0.6rem' }}>
          We do not sell, rent or broker your data. We share it only with the service providers that run{' '}
          {name}, each for its part of the work:
        </p>
        <ul className="list" style={{ maxHeight: 'none' }}>
          {item('Supabase', 'Our database, where your account and workspace data is stored.')}
          {item('Vercel', 'Hosts the website and app.')}
          {item('Hetzner', 'Hosts our servers that run background work, such as preparing briefs, sending alerts and, on an edition that includes the email inbox, syncing email.')}
          {item('OpenRouter', 'Routes AI requests to model hosts with data collection off and zero data retention.')}
          {item('Tavily', `Web search, when ${n} looks something up for you.`)}
          {item('Resend', 'Sends our emails, such as sign-in links, invites and alerts.')}
          {item('Google and Intuit', 'Only when you connect Google or QuickBooks, to read and act on those accounts as described above.')}
          {item('Apple and Google push services', 'Deliver phone app notifications, if you allow them.')}
          {item('Our payment processor', 'Processes card payments, if you pay by card.')}
        </ul>
        <p className="meta" style={{ marginTop: '0.6rem' }}>
          Inside your company, people see what their role allows: a person&apos;s calendar (and inbox, where included) is seen only by them
          and any assistant they let work in their account, and finance data is for execs. We may also disclose information when the law requires it, to
          protect our rights or users&apos; safety, or as part of a merger or sale of the business, in which
          case this policy continues to apply.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Cookies and storage</h2></div>
        <p className="meta">
          We use a sign-in cookie to keep you logged in (for up to 30 days) and, for executive assistants,
          a cookie that remembers which executive they are working for. Your browser also stores small
          settings such as light or dark mode. We do not use advertising or third-party analytics cookies.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>How long we keep it</h2></div>
        <p className="meta">
          We keep your company&apos;s data while it subscribes. After cancellation we keep it for 90 days
          and then permanently delete it, unless you ask us to delete it sooner. Error logs are kept for 30 days. When a person is removed from
          a workspace, their Google connections, calendar feeds and AI-app keys are removed. Disconnecting
          QuickBooks deletes the QuickBooks data we copied.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Your choices and rights</h2></div>
        <p className="meta">
          You can ask to see, correct, get a copy of, or delete your personal information by emailing{' '}
          <a href={supportMailto}>{brand.supportEmail}</a>, or ask for account deletion from Settings in the
          app. Because your company controls its workspace, we may need to check with your company before
          changing its records. You can disconnect Google, QuickBooks and other connections in the app at
          any time; to remove {name}&apos;s Google access completely, also remove it at{' '}
          <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">
            Google Account Permissions
          </a>. Depending on where you live, you may have further rights under laws such as the CCPA or
          GDPR; we will honor them.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Security</h2></div>
        <p className="meta">
          Data is encrypted in transit (TLS) and at rest. Google and QuickBooks access tokens are
          additionally encrypted in our database, AI-app keys are stored only as a one-way hash, and
          passwords are hashed. Each company&apos;s data is kept separate, and each person gets only what
          their role allows. No system is perfectly secure, so if we learn of a breach that affects your
          data, we will tell you as the law requires.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Where data is processed</h2></div>
        <p className="meta">
          We are based in the United States. Our providers may process data in the United States and
          other countries where they operate.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Children</h2></div>
        <p className="meta">
          {name} is a business tool and is not meant for anyone under 16. We do not knowingly collect
          their information.
        </p>
      </section>

      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head"><h2>Changes to this policy</h2></div>
        <p className="meta">
          We may update this policy. We will tell you about material changes by email or a notice in the
          app before they take effect, and the date at the top will change.
        </p>
      </section>

      <footer style={{ color: 'var(--muted)', textAlign: 'center', marginTop: '1.2rem', fontSize: '0.85rem' }}>
        Questions? <a href={supportMailto}>{brand.supportEmail}</a>
        {' · '}
        <Link href="/terms">Terms of Service</Link>
        {' · '}
        © {name}
      </footer>
    </main>
  )
}
