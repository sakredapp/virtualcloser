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
              <h2>Inbound — push leads into Virtual Closer</h2>
              <p>via Zapier</p>
            </div>
            <p className="meta" style={{ marginTop: '0.4rem' }}>
              Use this URL as a <strong>Webhook by Zapier → POST</strong> action in any
              Zap. Map fields to <code>name, email, company, notes, status, source,
              external_id, last_contact</code>. Leads de-dupe by email (then external_id),
              so re-runs are safe.
            </p>

            {!zapierKey ? (
              <form action={generateKey} style={{ marginTop: '0.9rem' }}>
                <button type="submit" className="btn approve">
                  Generate my webhook URL
                </button>
              </form>
            ) : (
              <>
                <label style={{ display: 'grid', gap: '0.35rem', marginTop: '0.9rem' }}>
                  <span className="meta">Your inbound webhook URL (treat like a password)</span>
                  <input readOnly value={inboundUrl} style={INPUT_STYLE} />
                </label>

                <details className="collapse" style={{ marginTop: '0.7rem' }}>
                  <summary>How to wire this in Zapier (60 sec)</summary>
                  <ol style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.4rem', margin: '0.5rem 0 0' }}>
                    <li>Make a Zap. Trigger = your CRM (HubSpot, Pipedrive, Salesforce, Sheets, etc.) &mdash; e.g. &ldquo;New contact&rdquo;.</li>
                    <li>Action = <strong>Webhooks by Zapier → POST</strong>.</li>
                    <li>URL = paste the URL above. Payload type = <strong>JSON</strong>.</li>
                    <li>Map data: <code>name</code>, <code>email</code>, <code>company</code>, <code>notes</code> (and optionally <code>status</code>, <code>source</code>, <code>external_id</code>).</li>
                    <li>Test. New leads will appear in your dashboard within seconds.</li>
                  </ol>
                </details>

                <details className="collapse" style={{ marginTop: '0.5rem' }}>
                  <summary>Test from your terminal</summary>
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

                <form action={rotateKey} style={{ marginTop: '0.9rem' }}>
                  <button type="submit" className="btn dismiss">
                    Rotate key (invalidates old URL)
                  </button>
                </form>
              </>
            )}
          </section>

          <section className="card" style={{ marginTop: '0.8rem' }}>
            <div className="section-head">
              <h2>Outbound — push events out</h2>
              <p>optional</p>
            </div>
            <p className="meta" style={{ marginTop: '0.4rem' }}>
              Want Virtual Closer to <em>send</em> events back to Zapier (e.g. when a lead
              flips hot, when an email is sent, when a call is logged)? Paste a
              <strong> Zapier Catch Hook URL</strong> below and we&apos;ll POST events to
              it. Leave blank to disable.
            </p>
            <form action={saveOutbound} style={{ display: 'grid', gap: '0.5rem', marginTop: '0.9rem' }}>
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
              <h2>What we don&apos;t do for you</h2>
            </div>
            <p className="meta" style={{ marginTop: '0.4rem' }}>
              We deliberately keep this self-serve so <em>your</em> CRM stays the source of
              truth and you stay in control of what flows where. We give you the endpoint;
              you build the Zap to fit your workflow. If you want us to set it up for you,
              that&apos;s part of the Executive build.
            </p>
          </section>
        </>
      )}
    </main>
  )
}
