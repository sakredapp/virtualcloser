/**
 * Executive suite Integrations (owner 10-09): one "Connect your AI" button,
 * then the few real connections: Google (calendar, plus Gmail on the Pinnacle
 * edition only, owner 2026-10-17) and Wispr Flow.
 * The logo sits in a small expandable. No explainer walls.
 */

import PageHeader from '@/app/components/PageHeader'
import CopyField from '@/app/components/CopyField'
import ConnectAiPopover from '@/app/components/cxo/ConnectAiPopover'
import GoogleClientCard from './GoogleClientCard'
import type { TenantGoogleClientView } from '@/lib/google/tenantClient'
import { ASSISTANT_NAME as DEFAULT_ASSISTANT_NAME } from '@/lib/assistantName'

type GoogleAccount = { accountId: string; email: string | null; label: string; canDisconnect?: boolean; needsReconnect?: boolean }
/** QuickBooks row: exec team only (absent for everyone else). */
export type QboIntegration = {
  configured: boolean
  connected: boolean
  needsReconnect: boolean
  companyName: string | null
  lastSyncAt: string | null
  canDisconnect: boolean
}
/** Slack row: Ciao in Slack (lib/slack). Absent on the demo. */
export type SlackIntegration = {
  /** SLACK_CLIENT_ID / SECRET / SIGNING_SECRET all set. */
  configured: boolean
  teamName: string | null
  connected: boolean
  /** Owners and admins add and remove it. */
  canManage: boolean
}

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
  qbo = null,
  googleClient = null,
  inbox = false,
  slack = null,
  assistantName,
}: {
  googleAccounts: GoogleAccount[]
  /** Meeting-notes inbox webhook (Wispr Flow / Plaud bridge); '' until made. */
  inboxUrl: string
  makeInbox: () => Promise<void>
  logoUrl: string | null
  saveLogo: (fd: FormData) => Promise<void>
  /** The public demo: same rows, nothing leaves the page. */
  demo?: boolean
  qbo?: QboIntegration | null
  /** Owner/admin only: the company's own Google OAuth client (lib/google/tenantClient). */
  googleClient?: TenantGoogleClientView | null
  /** The Pinnacle edition reads email; every other Suite CXO company does not. */
  inbox?: boolean
  slack?: SlackIntegration | null
  /** What this viewer calls the assistant (lib/assistantNameServer); the default on the demo. */
  assistantName?: string
}) {
  const ASSISTANT_NAME = assistantName || DEFAULT_ASSISTANT_NAME
  const ret = '%2Fdashboard%2Fintegrations'
  return (
    <main className="wrap">
      <PageHeader eyebrow="Settings" title="Integrations" subtitle={inbox ? `The accounts ${ASSISTANT_NAME} reads: calendar, email and meeting notes.` : `The accounts ${ASSISTANT_NAME} reads: calendar and meeting notes.`} />

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
            <p className="cx-int-name">{inbox ? 'Google Calendar and Gmail' : 'Google Calendar'}</p>
            {googleAccounts.length === 0 ? (
              <p className="cx-int-status">Not connected</p>
            ) : (
              <ul className="cx-int-list">
                {googleAccounts.map((a) => (
                  <li key={a.accountId}>
                    <span className={a.needsReconnect ? 'cx-int-dot cx-int-dot-off' : 'cx-int-dot'} aria-hidden />
                    <span className="cx-int-who">{a.email ?? a.label}</span>
                    {/* Per person: Connected, or Needs reconnect when Google stopped honouring it (lib/google/tokenHealth). */}
                    <span className={a.needsReconnect ? 'cx-int-status cx-int-status-alert' : 'cx-int-status'}>
                      {a.needsReconnect ? 'Needs reconnect' : 'Connected'}
                    </span>
                    {a.needsReconnect && a.canDisconnect !== false && !demo && (
                      <a href={`/api/google/oauth/start?add=1&return=${ret}`} className="cx-int-quiet cx-int-strong">Reconnect</a>
                    )}
                    {demo ? (
                      <button type="button" className="cx-int-quiet">Disconnect</button>
                    ) : a.canDisconnect === false ? (
                      <span className="cx-int-status">Only its owner can disconnect it</span>
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
            {googleClient && <GoogleClientCard initial={googleClient} demo={demo} inbox={inbox} />}
          </div>
          {googleAccounts.length === 0 ? (
            <a href={demo ? '#integrations' : `/api/google/oauth/start?return=${ret}`} className="cx-btn cx-btn-sm">Connect Google</a>
          ) : (
            <a href={demo ? '#integrations' : `/api/google/oauth/start?add=1&return=${ret}`} className="cx-btn cx-btn-sm cx-btn-red-text"><Plus /> Add another</a>
          )}
        </div>

        {slack && (
          <div className="cx-int-row" id="slack">
            <div className="cx-int-main">
              <p className="cx-int-name">Slack</p>
              {!slack.configured ? (
                <p className="cx-int-status">Slack is being set up. Soon your team can ask {ASSISTANT_NAME} in a DM or with an @mention.</p>
              ) : slack.connected ? (
                <ul className="cx-int-list">
                  <li>
                    <span className="cx-int-dot" aria-hidden />
                    <span className="cx-int-who">Connected to {slack.teamName ?? 'your workspace'}</span>
                    {slack.canManage ? (
                      <form action="/api/slack/disconnect" method="POST">
                        <button type="submit" className="cx-int-quiet">Disconnect</button>
                      </form>
                    ) : (
                      <span className="cx-int-status">An owner or admin can disconnect it</span>
                    )}
                  </li>
                </ul>
              ) : (
                <p className="cx-int-status">Not connected. Your team asks {ASSISTANT_NAME} in a DM or with an @mention. Anything that sends or changes something waits for their yes in the app.</p>
              )}
            </div>
            {!slack.configured ? (
              <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled aria-disabled="true">Slack is being set up</button>
            ) : !slack.connected && slack.canManage ? (
              <a href="/api/slack/oauth/start" className="cx-btn cx-btn-sm">Add to Slack</a>
            ) : null}
          </div>
        )}

        {qbo && (
          <div className="cx-int-row" id="quickbooks">
            <div className="cx-int-main">
              <p className="cx-int-name">QuickBooks</p>
              {!qbo.configured ? (
                <p className="cx-int-status">Read only: actual revenue, expenses and margin on Revenue and Sales Plan.</p>
              ) : qbo.connected || qbo.needsReconnect ? (
                <ul className="cx-int-list">
                  <li>
                    <span className="cx-int-dot" aria-hidden />
                    <span className="cx-int-who">
                      {qbo.companyName ?? 'Connected'}
                      {qbo.needsReconnect ? ' · access ended, reconnect' : ' · read only'}
                    </span>
                    {qbo.canDisconnect ? (
                      <form action="/api/integrations/quickbooks/disconnect" method="POST">
                        <input type="hidden" name="return" value="/dashboard/integrations" />
                        <button type="submit" className="cx-int-quiet">Disconnect</button>
                      </form>
                    ) : (
                      <span className="cx-int-status">Only the workspace owner can disconnect it</span>
                    )}
                  </li>
                </ul>
              ) : (
                <p className="cx-int-status">Not connected. Read only: nothing is ever changed in your books.</p>
              )}
            </div>
            {!qbo.configured ? (
              <button type="button" className="cx-btn cx-btn-sm cx-btn-ghost" disabled aria-disabled="true">QuickBooks isn&rsquo;t set up yet</button>
            ) : !qbo.connected ? (
              <a href={`/api/integrations/quickbooks/start?return=${ret}`} className="cx-btn cx-btn-sm">{qbo.needsReconnect ? 'Reconnect QuickBooks' : 'Connect QuickBooks'}</a>
            ) : null}
          </div>
        )}

        <div className="cx-int-row" id="recordings">
          <div className="cx-int-main">
            <p className="cx-int-name">Wispr Flow</p>
            <p className="cx-int-status">{inboxUrl ? 'Meeting inbox ready' : 'Not set up'}</p>
            <details className="cx-int-more">
              <summary>How to connect</summary>
              <ol>
                <li>Install Wispr Flow on every executive&rsquo;s computer (<a href="https://wisprflow.ai" target="_blank" rel="noreferrer">wisprflow.ai</a>) and turn on meeting notes.</li>
                <li>Send each note to the inbox link below. Every meeting then lands on Meetings and {ASSISTANT_NAME} reads it.</li>
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
