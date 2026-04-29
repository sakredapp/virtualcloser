import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { randomBytes } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { getCurrentMember, getCurrentTenant, isGatewayHost, requireTenant } from '@/lib/tenant'
import DashboardNav from '../DashboardNav'
import { buildDashboardTabs } from '../dashboardTabs'
import IntegrationRequestCard from './IntegrationRequestCard'
import { IntegrationAccordion, LockedIntegrationCard } from './IntegrationAccordion'
import { getActiveAddonKeys } from '@/lib/entitlements'
import {
  ensureSheetHeaders,
  getSheetMeta,
  getTokensForRep,
  parseSheetId,
  type SheetCrmConfig,
} from '@/lib/google'

export const dynamic = 'force-dynamic'

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.7rem',
  borderRadius: 8,
  border: '1px solid rgba(15,15,15,0.18)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: '0.9rem',
}

function genKey(): string {
  return randomBytes(18).toString('base64url')
}

export default async function IntegrationsPage() {
  const h = await headers()
  const host = h.get('x-tenant-host') ?? h.get('host') ?? ''
  if (isGatewayHost(host)) redirect('/login')

  const tenant = await getCurrentTenant()
  if (!tenant) redirect('/login')
  const viewerMember = await getCurrentMember()
  const navTabs = await buildDashboardTabs(tenant.id, viewerMember)

  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const zapierKey = typeof integrations.zapier_key === 'string' ? integrations.zapier_key : ''
  const outboundHook =
    typeof integrations.zapier_outbound_url === 'string'
      ? integrations.zapier_outbound_url
      : ''
  const sheetCfg = (integrations.google_sheet ?? null) as SheetCrmConfig | null
  const googleTokens = await getTokensForRep(tenant.id)
  const googleConnected = Boolean(googleTokens)
  let sheetTitle: string | null = null
  let sheetTabs: string[] = []
  if (googleConnected && sheetCfg?.spreadsheet_id) {
    const meta = await getSheetMeta(tenant.id, sheetCfg.spreadsheet_id)
    sheetTitle = meta?.title ?? null
    sheetTabs = meta?.tabs ?? []
  }

  const proto = host.includes('localhost') ? 'http' : 'https'
  const inboundUrl = zapierKey
    ? `${proto}://${host}/api/integrations/zapier?key=${zapierKey}`
    : ''

  async function generateKey() {
    'use server'
    const t = await requireTenant()
    const next = { ...(t.integrations ?? {}), zapier_key: genKey() }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  async function rotateKey() {
    'use server'
    const t = await requireTenant()
    const next = { ...(t.integrations ?? {}), zapier_key: genKey() }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  async function saveOutbound(formData: FormData) {
    'use server'
    const t = await requireTenant()
    const url = String(formData.get('zapier_outbound_url') ?? '').trim()
    const next = { ...(t.integrations ?? {}), zapier_outbound_url: url || null }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  async function saveSheet(formData: FormData) {
    'use server'
    const t = await requireTenant()
    const raw = String(formData.get('sheet_url') ?? '').trim()
    const tab = String(formData.get('tab_name') ?? '').trim() || 'Sheet1'
    const keyHeader = String(formData.get('key_header') ?? '').trim() || 'email'
    if (!raw) {
      const next = { ...(t.integrations ?? {}) }
      delete (next as Record<string, unknown>).google_sheet
      await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
      revalidatePath('/dashboard/integrations')
      return
    }
    const id = parseSheetId(raw)
    if (!id) return
    const cfg: SheetCrmConfig = {
      spreadsheet_id: id,
      tab_name: tab,
      header_row: 1,
      key_header: keyHeader,
    }
    const next = { ...(t.integrations ?? {}), google_sheet: cfg }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    // Best-effort: if the sheet is empty, seed our standard headers so the
    // rep doesn't have to set columns up by hand.
    await ensureSheetHeaders(t.id, cfg).catch(() => false)
    revalidatePath('/dashboard/integrations')
  }

  async function disconnectSheet() {
    'use server'
    const t = await requireTenant()
    const next = { ...(t.integrations ?? {}) }
    delete (next as Record<string, unknown>).google_sheet
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <h1>Integrations</h1>
          <p className="sub">
            Connect any CRM or tool through Zapier. You wire it up, your data flows in —
            we don&apos;t lock you into one CRM.
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* ── Google Sheets CRM (works on every tier) ─────────────── */}
      <section className="card" style={{ marginTop: '0.8rem' }}>
        <div className="section-head">
          <h2>Google Sheets CRM</h2>
          <p>
            {!googleConnected
              ? 'Google not connected'
              : sheetCfg
                ? 'linked'
                : 'not linked'}
          </p>
        </div>
        <p className="meta" style={{ marginTop: '0.4rem' }}>
          Already running your CRM in a Google Sheet? Link it here and Virtual
          Closer will <strong>read and update rows by contact name or email</strong>{' '}
          — automatically. Every &ldquo;new prospect Dana at Acme&rdquo;,
          &ldquo;Dana&rsquo;s hot&rdquo;, or &ldquo;just got off with Dana&rdquo;
          you tell Telegram is mirrored straight into your sheet.
        </p>

        {!googleConnected ? (
          <p className="meta" style={{ marginTop: '0.6rem' }}>
            👉 Connect your Google account on the{' '}
            <Link href="/dashboard">dashboard</Link> first (same connection that
            powers Calendar — we just add the Sheets permission).
          </p>
        ) : (
          <>
            <p
              className="meta"
              style={{
                marginTop: '0.7rem',
                padding: '0.7rem 0.8rem',
                background: 'var(--paper-2)',
                border: '1px dashed var(--ink)',
                borderRadius: 8,
              }}
            >
              <strong>Bring your own sheet — or link an empty one.</strong> If
              the sheet is blank, we&apos;ll auto-write the standard CRM
              headers for you: <code>name</code>, <code>email</code>,{' '}
              <code>company</code>, <code>phone</code>, <code>status</code>,{' '}
              <code>notes</code>, <code>source</code>, <code>last_contact</code>,{' '}
              <code>created_at</code>, <code>updated_at</code>. Already have
              your own columns? We auto-match common variations (&ldquo;Full
              Name&rdquo;, &ldquo;Email Address&rdquo;, &ldquo;Organization&rdquo;,
              &ldquo;Stage&rdquo;, &ldquo;Last Contacted&rdquo;…). Pick one
              column as the unique key (usually <code>email</code>) so we
              update the right row instead of duplicating.
            </p>

            <form
              action={saveSheet}
              style={{ display: 'grid', gap: '0.6rem', marginTop: '0.9rem' }}
            >
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span className="meta">
                  <strong>Sheet URL</strong> — paste from the address bar in
                  Google Sheets
                </span>
                <input
                  name="sheet_url"
                  defaultValue={
                    sheetCfg
                      ? `https://docs.google.com/spreadsheets/d/${sheetCfg.spreadsheet_id}/edit`
                      : ''
                  }
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                  style={INPUT_STYLE}
                />
              </label>
              <div
                style={{
                  display: 'grid',
                  gap: '0.6rem',
                  gridTemplateColumns: '1fr 1fr',
                }}
              >
                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span className="meta">
                    <strong>Tab name</strong>
                  </span>
                  <input
                    name="tab_name"
                    defaultValue={sheetCfg?.tab_name ?? 'Sheet1'}
                    placeholder="Sheet1"
                    style={INPUT_STYLE}
                  />
                </label>
                <label style={{ display: 'grid', gap: '0.35rem' }}>
                  <span className="meta">
                    <strong>Unique-key column</strong>
                  </span>
                  <input
                    name="key_header"
                    defaultValue={sheetCfg?.key_header ?? 'email'}
                    placeholder="email"
                    style={INPUT_STYLE}
                  />
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button type="submit" className="btn approve">
                  {sheetCfg ? 'Update sheet link' : 'Link this sheet'}
                </button>
                {sheetCfg && (
                  <button
                    formAction={disconnectSheet}
                    className="btn dismiss"
                    type="submit"
                  >
                    Unlink sheet
                  </button>
                )}
              </div>
            </form>

            {sheetCfg && (
              <div style={{ marginTop: '0.9rem' }}>
                <p className="meta">
                  ✅ Linked to{' '}
                  <strong>{sheetTitle || sheetCfg.spreadsheet_id}</strong>
                  {sheetTabs.length > 0 && (
                    <>
                      {' '}
                      · tabs:{' '}
                      {sheetTabs.map((t, i) => (
                        <code key={t} style={{ marginRight: 6 }}>
                          {t}
                          {i < sheetTabs.length - 1 ? ',' : ''}
                        </code>
                      ))}
                    </>
                  )}
                </p>
                <p className="meta" style={{ marginTop: '0.3rem' }}>
                  <a
                    href={`https://docs.google.com/spreadsheets/d/${sheetCfg.spreadsheet_id}/edit`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontWeight: 600 }}
                  >
                    Open sheet →
                  </a>
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <>
          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head">
              <h2>Quick start — connect your CRM in 5 minutes</h2>
              <p>via Zapier</p>
            </div>
            <p className="meta" style={{ marginTop: '0.4rem' }}>
              Zapier is the bridge. Your CRM (or anything that has data) → Zapier →
              Virtual Closer. You only ever build the Zap once per source. Don&apos;t have
              a Zapier account?{' '}
              <a
                href="https://zapier.com/sign-up"
                target="_blank"
                rel="noreferrer"
                style={{ fontWeight: 600 }}
              >
                Create one free →
              </a>
            </p>

            {!zapierKey ? (
              <form action={generateKey} style={{ marginTop: '0.9rem' }}>
                <button type="submit" className="btn approve">
                  Step 1 — Generate my webhook URL
                </button>
              </form>
            ) : (
              <>
                <label style={{ display: 'grid', gap: '0.35rem', marginTop: '0.9rem' }}>
                  <span className="meta">
                    <strong>Your personal webhook URL</strong> — treat it like a password.
                    Anyone with this URL can push leads into your account.
                  </span>
                  <input readOnly value={inboundUrl} style={INPUT_STYLE} />
                </label>

                <ol
                  style={{
                    paddingLeft: '1.2rem',
                    display: 'grid',
                    gap: '0.7rem',
                    margin: '1rem 0 0',
                  }}
                >
                  <li>
                    <p className="name" style={{ margin: 0 }}>Open Zapier and start a new Zap</p>
                    <p className="meta" style={{ margin: '0.15rem 0 0' }}>
                      <a
                        href="https://zapier.com/app/zap-editor/create"
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontWeight: 600 }}
                      >
                        Open the Zap editor →
                      </a>
                    </p>
                  </li>
                  <li>
                    <p className="name" style={{ margin: 0 }}>Pick your trigger (where leads come from)</p>
                    <p className="meta" style={{ margin: '0.15rem 0 0' }}>
                      Search for your tool and pick an event like &ldquo;New contact&rdquo; or &ldquo;New row&rdquo;:
                    </p>
                    <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.2rem' }}>
                      <li><a href="https://zapier.com/apps/hubspot/integrations" target="_blank" rel="noreferrer">HubSpot →</a></li>
                      <li><a href="https://zapier.com/apps/pipedrive/integrations" target="_blank" rel="noreferrer">Pipedrive →</a></li>
                      <li><a href="https://zapier.com/apps/salesforce/integrations" target="_blank" rel="noreferrer">Salesforce →</a></li>
                      <li><a href="https://zapier.com/apps/google-sheets/integrations" target="_blank" rel="noreferrer">Google Sheets →</a></li>
                      <li><a href="https://zapier.com/apps/typeform/integrations" target="_blank" rel="noreferrer">Typeform →</a></li>
                      <li><a href="https://zapier.com/apps/calendly/integrations" target="_blank" rel="noreferrer">Calendly →</a></li>
                      <li><a href="https://zapier.com/apps/facebook-lead-ads/integrations" target="_blank" rel="noreferrer">Facebook Lead Ads →</a></li>
                    </ul>
                  </li>
                  <li>
                    <p className="name" style={{ margin: 0 }}>Add the action: Webhooks by Zapier → POST</p>
                    <p className="meta" style={{ margin: '0.15rem 0 0' }}>
                      <a
                        href="https://zapier.com/apps/webhook/integrations"
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontWeight: 600 }}
                      >
                        Webhooks by Zapier →
                      </a>{' '}
                      · Choose <strong>POST</strong> as the event.
                    </p>
                  </li>
                  <li>
                    <p className="name" style={{ margin: 0 }}>Paste the URL above into the &ldquo;URL&rdquo; field</p>
                    <p className="meta" style={{ margin: '0.15rem 0 0' }}>
                      Set <strong>Payload Type</strong> to <code>JSON</code>. Leave the rest as default.
                    </p>
                  </li>
                  <li>
                    <p className="name" style={{ margin: 0 }}>Map your fields → ours</p>
                    <p className="meta" style={{ margin: '0.15rem 0 0' }}>
                      In the &ldquo;Data&rdquo; section, add these keys (left side) and pick the matching field from your CRM (right side):
                    </p>
                    <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.2rem' }}>
                      <li><code>name</code> — full name (required if no email)</li>
                      <li><code>email</code> — email address (required if no name)</li>
                      <li><code>company</code> — company / organization</li>
                      <li><code>notes</code> — any context: deal stage, source detail, last message…</li>
                      <li><code>status</code> — optional: <code>hot</code>, <code>warm</code>, <code>cold</code>, or <code>dormant</code></li>
                      <li><code>source</code> — optional: where they came from (e.g. <code>hubspot</code>)</li>
                      <li><code>external_id</code> — optional: their ID in your CRM (used to de-dupe)</li>
                    </ul>
                  </li>
                  <li>
                    <p className="name" style={{ margin: 0 }}>Test &amp; turn it on</p>
                    <p className="meta" style={{ margin: '0.15rem 0 0' }}>
                      Click &ldquo;Test&rdquo; in Zapier. You should get a{' '}
                      <code>{`{ "ok": true, "action": "created" }`}</code> response. Refresh your dashboard — the test lead is there. Flip the Zap on.
                    </p>
                  </li>
                </ol>

                <p
                  className="meta"
                  style={{
                    marginTop: '1rem',
                    padding: '0.7rem 0.8rem',
                    background: 'var(--paper-2)',
                    border: '1px dashed var(--ink)',
                    borderRadius: 8,
                  }}
                >
                  <strong>De-dupe is automatic.</strong> If we already have a lead with the
                  same email (or <code>external_id</code>) for you, we&apos;ll update it
                  instead of creating a duplicate. Re-running your Zap is safe.
                </p>

                <details className="collapse" style={{ marginTop: '0.7rem' }}>
                  <summary>Test it yourself from a terminal</summary>
                  <pre
                    style={{
                      marginTop: '0.5rem',
                      padding: '0.7rem 0.8rem',
                      background: 'var(--paper-2)',
                      border: '1px solid var(--ink)',
                      borderRadius: 8,
                      fontSize: '0.8rem',
                      overflowX: 'auto',
                      color: 'var(--ink)',
                    }}
                  >
{`curl -X POST '${inboundUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Test Lead","email":"test@example.com","company":"Acme","notes":"From Zapier"}'`}
                  </pre>
                </details>

                <details className="collapse" style={{ marginTop: '0.5rem' }}>
                  <summary>Stuck? Common fixes</summary>
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem', display: 'grid', gap: '0.3rem' }}>
                    <li><strong>401 invalid key</strong> — you copied the URL without the <code>?key=...</code> at the end. Copy the full URL above.</li>
                    <li><strong>400 name or email required</strong> — at least one of <code>name</code> or <code>email</code> must be mapped. Both is best.</li>
                    <li><strong>403</strong> — your webhook key may be invalid or expired. Rotate the key above and update the URL in your Zap.</li>
                    <li><strong>Lead never appears</strong> — refresh the dashboard. If still missing, check Zapier&apos;s task history for the response body.</li>
                  </ul>
                </details>

                <form action={rotateKey} style={{ marginTop: '0.9rem' }}>
                  <button type="submit" className="btn dismiss">
                    Rotate key (invalidates the old URL)
                  </button>
                </form>
              </>
            )}
          </section>

          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head">
              <h2>Outbound — send events back to Zapier</h2>
              <p>optional</p>
            </div>
            <p className="meta" style={{ marginTop: '0.4rem' }}>
              Want Virtual Closer to <em>push</em> events out (e.g. lead flipped hot, email
              sent, call logged) so you can fan them out to Slack, your CRM, a spreadsheet,
              whatever?
            </p>
            <ol
              style={{
                paddingLeft: '1.2rem',
                display: 'grid',
                gap: '0.4rem',
                margin: '0.7rem 0 0',
              }}
            >
              <li>
                In Zapier, create a Zap with <strong>Webhooks by Zapier → Catch Hook</strong> as the trigger.{' '}
                <a
                  href="https://zapier.com/apps/webhook/integrations"
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontWeight: 600 }}
                >
                  Webhooks by Zapier →
                </a>
              </li>
              <li>Zapier gives you a URL like <code>https://hooks.zapier.com/hooks/catch/…</code>. Copy it.</li>
              <li>Paste it below and save. Then add whatever action(s) you want in Zapier (Slack, HubSpot, Sheets…).</li>
            </ol>
            <form
              action={saveOutbound}
              style={{ display: 'grid', gap: '0.5rem', marginTop: '0.9rem' }}
            >
              <label style={{ display: 'grid', gap: '0.35rem' }}>
                <span className="meta">Zapier Catch Hook URL</span>
                <input
                  name="zapier_outbound_url"
                  defaultValue={outboundHook}
                  placeholder="https://hooks.zapier.com/hooks/catch/..."
                  style={INPUT_STYLE}
                />
              </label>
              <button type="submit" className="btn approve" style={{ justifySelf: 'start' }}>
                Save outbound URL
              </button>
            </form>
          </section>

          <IntegrationRequestCard />
        </>
    </main>
  )
}
