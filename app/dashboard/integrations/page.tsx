import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { randomBytes } from 'node:crypto'
import { supabase } from '@/lib/supabase'
import { getCurrentTenant, isGatewayHost, requireTenant } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

const INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  padding: '0.55rem 0.7rem',
  borderRadius: 8,
  border: '1px solid var(--ink)',
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

  const tier = tenant.tier
  const locked = tier === 'salesperson'
  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const zapierKey = typeof integrations.zapier_key === 'string' ? integrations.zapier_key : ''
  const outboundHook =
    typeof integrations.zapier_outbound_url === 'string'
      ? integrations.zapier_outbound_url
      : ''

  const proto = host.includes('localhost') ? 'http' : 'https'
  const inboundUrl = zapierKey
    ? `${proto}://${host}/api/integrations/zapier?key=${zapierKey}`
    : ''

  async function generateKey() {
    'use server'
    const t = await requireTenant()
    if (t.tier === 'salesperson') return
    const next = { ...(t.integrations ?? {}), zapier_key: genKey() }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  async function rotateKey() {
    'use server'
    const t = await requireTenant()
    if (t.tier === 'salesperson') return
    const next = { ...(t.integrations ?? {}), zapier_key: genKey() }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  async function saveOutbound(formData: FormData) {
    'use server'
    const t = await requireTenant()
    if (t.tier === 'salesperson') return
    const url = String(formData.get('zapier_outbound_url') ?? '').trim()
    const next = { ...(t.integrations ?? {}), zapier_outbound_url: url || null }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <p className="eyebrow">Virtual Closer · {tenant.slug}</p>
          <h1>Integrations</h1>
          <p className="sub">
            Connect any CRM or tool through Zapier. You wire it up, your data flows in —
            we don&apos;t lock you into one CRM.
          </p>
          <p className="nav">
            <Link href="/dashboard">← Dashboard</Link>
            <span>·</span>
            <Link href="/brain">Brain dump</Link>
          </p>
        </div>
      </header>

      {locked ? (
        <section className="card" style={{ marginTop: '0.8rem' }}>
          <div className="section-head">
            <h2>Upgrade to unlock</h2>
            <p>Team Builder feature</p>
          </div>
          <p className="meta" style={{ marginTop: '0.4rem' }}>
            Integrations are part of <strong>Team Builder</strong>. Pipe leads in from
            HubSpot, Pipedrive, Salesforce, Notion, Google Sheets, Calendly — anything
            Zapier connects to. You build the Zap; we receive and de-dupe into your
            pipeline.
          </p>
          <p className="meta" style={{ marginTop: '0.4rem' }}>
            On Salesperson, your CRM <em>is</em> Virtual Closer — drop leads in via voice,
            Telegram, or CSV. Upgrade to Team Builder when you want your existing CRM to
            stay the source of truth.
          </p>
          <div style={{ marginTop: '0.9rem' }}>
            <Link
              className="btn approve"
              href="mailto:hello@virtualcloser.com?subject=Upgrade%20to%20Team%20Builder"
              style={{ textDecoration: 'none' }}
            >
              Talk to us about upgrading →
            </Link>
          </div>
        </section>
      ) : (
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
                    <li><strong>403</strong> — your account is on the Salesperson tier. Upgrade to use integrations.</li>
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

          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head">
              <h2>This is yours to customize</h2>
            </div>
            <p className="meta" style={{ marginTop: '0.4rem' }}>
              We keep this self-serve on purpose: <em>your</em> CRM stays the source of
              truth, and you stay in control of what flows where. We hand you the endpoint
              and the recipe — you wire it up however fits your workflow. Want us to build
              the Zaps for you? That&apos;s included in the Executive build.
            </p>
            <p className="meta" style={{ marginTop: '0.6rem' }}>
              Need help? Email{' '}
              <a href="mailto:hello@virtualcloser.com?subject=Integrations%20help">
                hello@virtualcloser.com
              </a>{' '}
              with your Zap URL and we&apos;ll take a look.
            </p>
          </section>
        </>
      )}
    </main>
  )
}
