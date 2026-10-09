/**
 * Executive suite Integrations (owner 10-09): one "Connect your AI" button,
 * then the few real connections: Google (calendar + Gmail) and Wispr Flow.
 * The logo sits in a small expandable. No explainer walls.
 */

import PageHeader from '@/app/components/PageHeader'
import CopyField from '@/app/components/CopyField'
import ConnectAiPopover from '@/app/components/cxo/ConnectAiPopover'

type GoogleAccount = { accountId: string; email: string | null; label: string }

function Plus() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  )
}

export default function CxoIntegrations({
  googleAccounts,
  inboxUrl,
  makeInbox,
  logoUrl,
  saveLogo,
  demo = false,
}: {
  googleAccounts: GoogleAccount[]
  /** Meeting-notes inbox webhook (Wispr Flow / Plaud bridge); '' until made. */
  inboxUrl: string
  makeInbox: () => Promise<void>
  logoUrl: string | null
  saveLogo: (fd: FormData) => Promise<void>
  /** The public demo: same rows, nothing leaves the page. */
  demo?: boolean
}) {
  const ret = '%2Fdashboard%2Fintegrations'
  return (
    <main className="wrap">
      <PageHeader eyebrow="Settings" title="Integrations" subtitle="What Mira reads from." />

      <section className="cx-int">
        <div className="cx-int-row">
          <div className="cx-int-main">
            <p className="cx-int-name">Your AI</p>
            <p className="cx-int-status">Your own Claude or ChatGPT reads every number here and arranges your dashboard.</p>
          </div>
          <ConnectAiPopover variant="button" demo={demo} />
        </div>

        <div className="cx-int-row" id="google">
          <div className="cx-int-main">
            <p className="cx-int-name">Google Calendar and Gmail</p>
            {googleAccounts.length === 0 ? (
              <p className="cx-int-status">Not connected</p>
            ) : (
              <ul className="cx-int-list">
                {googleAccounts.map((a) => (
                  <li key={a.accountId}>
                    <span className="cx-int-dot" aria-hidden />
                    <span className="cx-int-who">{a.email ?? a.label}</span>
                    {demo ? (
                      <button type="button" className="cx-int-quiet">Disconnect</button>
                    ) : (
                      <form action="/api/google/disconnect" method="POST">
                        <input type="hidden" name="account" value={a.accountId} />
                        <input type="hidden" name="return" value="/dashboard/integrations" />
                        <button type="submit" className="cx-int-quiet">Disconnect</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {googleAccounts.length === 0 ? (
            <a href={demo ? '#integrations' : `/api/google/oauth/start?return=${ret}`} className="cx-btn cx-btn-sm">Connect Google</a>
          ) : (
            <a href={demo ? '#integrations' : `/api/google/oauth/start?add=1&return=${ret}`} className="cx-btn cx-btn-sm cx-btn-red-text"><Plus /> Add another</a>
          )}
        </div>

        <div className="cx-int-row" id="recordings">
          <div className="cx-int-main">
            <p className="cx-int-name">Wispr Flow</p>
            <p className="cx-int-status">{inboxUrl ? 'Meeting inbox ready' : 'Not set up'}</p>
            <details className="cx-int-more">
              <summary>How to connect</summary>
              <ol>
                <li>Install Wispr Flow on every executive&rsquo;s computer (<a href="https://wisprflow.ai" target="_blank" rel="noreferrer">wisprflow.ai</a>) and turn on meeting notes.</li>
                <li>Send each note to the inbox link below. Every meeting then lands on Meetings and Mira reads it.</li>
              </ol>
              {inboxUrl ? (
                <CopyField value={inboxUrl} label="Meeting inbox link" style={{ width: '100%', marginTop: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--cx-line-strong)', font: '12px/1.3 ui-monospace, Menlo, monospace' }} />
              ) : null}
            </details>
          </div>
          {!inboxUrl && (
            <form action={makeInbox}>
              <button type="submit" className="cx-btn cx-btn-sm">Make inbox link</button>
            </form>
          )}
        </div>

        <div className="cx-int-row" id="logo">
          <div className="cx-int-main">
            <p className="cx-int-name">Your logo</p>
            <p className="cx-int-status">{logoUrl ? 'Shown at the top of the menu' : 'Company name shown'}</p>
            <details className="cx-int-more">
              <summary>{logoUrl ? 'Change' : 'Add a logo'}</summary>
              <form action={saveLogo} className="cx-int-form">
                <input type="url" name="logo_url" defaultValue={logoUrl ?? ''} placeholder="https://…/logo.png" pattern="https://.*" aria-label="Logo link (https)" />
                <button type="submit" className="cx-btn cx-btn-sm">Save</button>
                {logoUrl && <button type="submit" name="clear" value="1" className="cx-btn cx-btn-sm cx-btn-ghost">Remove</button>}
              </form>
            </details>
          </div>
          {logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="cx-int-logo" />
          )}
        </div>
      </section>
    </main>
  )
}
