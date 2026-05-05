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
import { listClientIntegrations, upsertClientIntegration } from '@/lib/client-integrations'
import {
  ensureSheetHeaders,
  getSheetMeta,
  getTokensFor,
  getTokensForRep,
  getTokensForMember,
  parseSheetId,
  type SheetCrmConfig,
} from '@/lib/google'
import { trelloConfigured, buildTrelloAuthUrl, validateTrelloToken } from '@/lib/trello'

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
  const activeAddons = await getActiveAddonKeys(tenant.id)

  const integrations = (tenant.integrations ?? {}) as Record<string, unknown>
  const zapierKey = typeof integrations.zapier_key === 'string' ? integrations.zapier_key : ''
  const outboundHook =
    typeof integrations.zapier_outbound_url === 'string'
      ? integrations.zapier_outbound_url
      : ''
  const sheetCfg = (integrations.google_sheet ?? null) as SheetCrmConfig | null
  // Per-member Google connection: prefer the viewer's own tokens. Fall back
  // to tenant-level so legacy individual-tier accounts and shared mailbox
  // setups keep working untouched.
  const memberGoogleTokens = viewerMember
    ? await getTokensForMember(tenant.id, viewerMember.id)
    : null
  const tenantGoogleTokens = await getTokensForRep(tenant.id)
  const googleTokens = memberGoogleTokens ?? tenantGoogleTokens
  const googleConnected = Boolean(googleTokens)
  let sheetTitle: string | null = null
  let sheetTabs: string[] = []
  if (googleConnected && sheetCfg?.spreadsheet_id) {
    // Sheet CRM is tenant-level; pick whichever connection is available so
    // the meta probe works even on enterprise where members have their own
    // calendars but the sheet stays shared.
    const sheetTokens = (await getTokensFor(tenant.id, viewerMember?.id ?? null))
    if (sheetTokens) {
      const meta = await getSheetMeta(tenant.id, sheetCfg.spreadsheet_id)
      sheetTitle = meta?.title ?? null
      sheetTabs = meta?.tabs ?? []
    }
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

  // ── Trello actions ───────────────────────────────────────────────────
  async function saveTrelloToken(formData: FormData) {
    'use server'
    const t = await requireTenant()
    const token = String(formData.get('token') ?? '').trim()
    if (!token) {
      revalidatePath('/dashboard/integrations')
      return
    }
    const memberInfo = await validateTrelloToken(token)
    if (!memberInfo) {
      revalidatePath('/dashboard/integrations')
      return
    }
    const next = {
      ...(t.integrations ?? {}),
      trello_token: token,
      trello_member_id: memberInfo.id,
      trello_member: memberInfo.fullName,
    }
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  async function disconnectTrello() {
    'use server'
    const t = await requireTenant()
    const next = { ...(t.integrations ?? {}) }
    delete (next as Record<string, unknown>).trello_token
    delete (next as Record<string, unknown>).trello_member_id
    delete (next as Record<string, unknown>).trello_member
    await supabase.from('reps').update({ integrations: next }).eq('id', t.id)
    revalidatePath('/dashboard/integrations')
  }

  // ── WAVV config ─────────────────────────────────────────────────────
  const isEnterpriseMember = tenant.tier === 'enterprise' && viewerMember !== null
  let wavvSecret = ''
  let wavvWebhookUrl = ''
  if (activeAddons.has('addon_wavv_kpi')) {
    const integrationRows = await listClientIntegrations(tenant.id).catch(() => [])
    const wavvRow = integrationRows.find((r) => r.key === 'wavv')
    const wavvBase = (wavvRow?.config ?? {}) as Record<string, unknown>
    if (isEnterpriseMember && viewerMember) {
      const overrides = (wavvBase.member_overrides ?? {}) as Record<string, Record<string, unknown>>
      wavvSecret = (overrides[viewerMember.id]?.webhook_secret as string | undefined) ?? ''
    } else {
      wavvSecret = (wavvBase.webhook_secret as string | undefined) ?? ''
    }
    if (wavvSecret) {
      wavvWebhookUrl = isEnterpriseMember && viewerMember
        ? `${proto}://${host}/api/webhooks/wavv/${tenant.id}?member=${viewerMember.id}&secret=${wavvSecret}`
        : `${proto}://${host}/api/webhooks/wavv/${tenant.id}?secret=${wavvSecret}`
    }
  }

  async function saveWavvConfig() {
    'use server'
    const t = await requireTenant()
    const m = await getCurrentMember()
    const isEntMember = t.tier === 'enterprise' && m !== null
    const secret = genKey()
    const rows = await listClientIntegrations(t.id).catch(() => [])
    const existing = rows.find((r) => r.key === 'wavv')
    const existingConfig = (existing?.config ?? {}) as Record<string, unknown>
    let newConfig: Record<string, unknown>
    if (isEntMember && m) {
      const overrides = ((existingConfig.member_overrides ?? {}) as Record<string, unknown>)
      newConfig = { ...existingConfig, member_overrides: { ...overrides, [m.id]: { webhook_secret: secret } } }
    } else {
      newConfig = { ...existingConfig, webhook_secret: secret }
    }
    await upsertClientIntegration(t.id, 'wavv', { label: 'WAVV dialer KPI ingest', kind: 'webhook_inbound', config: newConfig })
    revalidatePath('/dashboard/integrations')
  }

  // ── Derive status labels ────────────────────────────────────────────
  const sheetStatus = !googleConnected
    ? 'Google not connected'
    : sheetCfg
      ? `Linked — ${sheetTitle ?? sheetCfg.spreadsheet_id}`
      : 'Not linked'
  const sheetOk = googleConnected && Boolean(sheetCfg)

  const zapierInboundStatus = zapierKey ? 'Active — webhook URL generated' : 'Not set up'
  const zapierOutboundStatus = outboundHook ? 'Active — outbound hook saved' : 'Not set up'

  // ── Trello ────────────────────────────────────────────────────────────
  const trelloToken = typeof integrations.trello_token === 'string' ? integrations.trello_token : undefined
  const trelloMember = typeof integrations.trello_member === 'string' ? integrations.trello_member : undefined
  const trelloApiConfigured = trelloConfigured()
  const trelloAuthUrl = trelloApiConfigured ? buildTrelloAuthUrl() : ''

  return (
    <main className="wrap">
      <header className="hero">
        <div>
          <h1>Integrations</h1>
          <p className="sub">
            Connect your tools. Self-serve options below — click any to expand.
          </p>
        </div>
      </header>

      <DashboardNav tabs={navTabs.tabs} lockedAddons={navTabs.lockedAddons} />

      {/* ────────────────────────────────────────────────────────────
          SECTION 1 — Included with every plan
      ──────────────────────────────────────────────────────────── */}
      <section style={{ marginTop: '1.2rem' }}>
        <p
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--muted)',
            marginBottom: '0.55rem',
          }}
        >
          Wire it up yourself — included
        </p>

        <div style={{ display: 'grid', gap: '0.5rem' }}>

          {/* ── Google Suite — per-member on enterprise, tenant-level on individual ─── */}
          {(() => {
            const isEnterprise = tenant.tier === 'enterprise'
            const effectiveTokens = isEnterprise ? memberGoogleTokens : tenantGoogleTokens
            const status = effectiveTokens
              ? `Connected as ${effectiveTokens.email ?? 'your Google account'}`
              : isEnterprise && tenantGoogleTokens
              ? 'Account-level fallback — connect your own to take over'
              : 'Not connected'
            return (
              <IntegrationAccordion
                title="Google Suite"
                icon="G"
                badge="required"
                status={status}
                statusOk={Boolean(effectiveTokens)}
                defaultOpen={!effectiveTokens}
              >
                <p className="meta" style={{ marginBottom: '0.75rem' }}>
                  One Google connection powers three things:
                </p>
                <ul className="meta" style={{ margin: '0 0 0.75rem', paddingLeft: '1.2rem', display: 'grid', gap: '0.3rem' }}>
                  <li>
                    <strong>Google Calendar</strong> —{' '}
                    <Link href="/dashboard/calendar" style={{ fontWeight: 600 }}>Calendar tab</Link>,
                    Telegram booking &amp; rescheduling, free slot detection for the AI dialer
                  </li>
                  <li>
                    <strong>Gmail</strong> — sends emails from your Google account when you ask
                    Telegram to send
                  </li>
                  <li>
                    <strong>Google Sheets</strong> — links your Sheet CRM (configured separately below)
                  </li>
                </ul>
                <p className="meta" style={{ marginBottom: '0.75rem' }}>
                  {isEnterprise
                    ? 'Every member connects their own Google account. '
                    : 'Connect once — Calendar, Gmail, and Sheets all work through a single OAuth flow.'}
                </p>
                {effectiveTokens ? (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Link href="/dashboard/calendar" className="btn">
                      View calendar →
                    </Link>
                    <form action="/api/google/disconnect" method="POST">
                      <button type="submit" className="btn dismiss">
                        Disconnect
                      </button>
                    </form>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <a href="/api/google/oauth/start" className="btn approve">
                      Connect Google →
                    </a>
                    {isEnterprise && tenantGoogleTokens && (
                      <p className="meta" style={{ margin: 0 }}>
                        There&apos;s an account-level connection in place
                        {tenantGoogleTokens.email ? ` (${tenantGoogleTokens.email})` : ''}.
                        Connect your own to scope events, free-busy, and Gmail send to{' '}
                        <strong>your</strong> account.
                      </p>
                    )}
                  </div>
                )}
              </IntegrationAccordion>
            )
          })()}

          {/* ── Google Sheets CRM ─────────────────────────── */}
          <IntegrationAccordion
            title="Google Sheets CRM"
            icon="📊"
            badge="free"
            status={sheetStatus}
            statusOk={sheetOk}
            defaultOpen={sheetOk}
          >
            <p className="meta" style={{ marginBottom: '0.75rem' }}>
              Already running your CRM in a Google Sheet? Link it here and Virtual Closer
              will <strong>read and update rows by contact name or email</strong> automatically.
              Every &ldquo;new prospect Dana at Acme&rdquo;, &ldquo;Dana&rsquo;s hot&rdquo;,
              or &ldquo;just got off with Dana&rdquo; you tell Telegram is mirrored straight
              into your sheet.
            </p>

            {!googleConnected ? (
              <p className="meta">
                👉 Connect your Google account on the{' '}
                <Link href="/dashboard" style={{ fontWeight: 600, color: 'var(--red)' }}>
                  dashboard
                </Link>{' '}
                first — same connection that powers Calendar, we just add the Sheets
                permission.
              </p>
            ) : (
              <>
                <details className="collapse" style={{ marginBottom: '0.8rem' }}>
                  <summary>How it works — column matching &amp; auto-setup</summary>
                  <div style={{ paddingTop: '0.6rem', display: 'grid', gap: '0.4rem' }}>
                    <p className="meta">
                      <strong>Blank sheet?</strong> We&apos;ll write the standard headers for
                      you:{' '}
                      {['name','email','company','phone','status','notes','source','last_contact','created_at','updated_at'].map((h, i, arr) => (
                        <span key={h}><code>{h}</code>{i < arr.length - 1 ? ', ' : ''}</span>
                      ))}.
                    </p>
                    <p className="meta">
                      <strong>Own columns?</strong> We auto-match common variations —
                      &ldquo;Full Name&rdquo;, &ldquo;Email Address&rdquo;,
                      &ldquo;Organization&rdquo;, &ldquo;Stage&rdquo;, &ldquo;Last
                      Contacted&rdquo;…
                    </p>
                    <p className="meta">
                      <strong>Unique key</strong> (usually <code>email</code>) tells us which
                      column to use when matching rows — so we update instead of duplicating.
                    </p>
                  </div>
                </details>

                <form action={saveSheet} style={{ display: 'grid', gap: '0.6rem' }}>
                  <label style={{ display: 'grid', gap: '0.3rem' }}>
                    <span className="meta">
                      <strong>Sheet URL</strong> — paste from the address bar in Google Sheets
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
                  <div style={{ display: 'grid', gap: '0.6rem', gridTemplateColumns: '1fr 1fr' }}>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                      <span className="meta"><strong>Tab name</strong></span>
                      <input
                        name="tab_name"
                        defaultValue={sheetCfg?.tab_name ?? 'Sheet1'}
                        placeholder="Sheet1"
                        style={INPUT_STYLE}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: '0.3rem' }}>
                      <span className="meta"><strong>Unique-key column</strong></span>
                      <input
                        name="key_header"
                        defaultValue={sheetCfg?.key_header ?? 'email'}
                        placeholder="email"
                        style={INPUT_STYLE}
                      />
                    </label>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    <button type="submit" className="btn approve">
                      {sheetCfg ? 'Update sheet link' : 'Link this sheet'}
                    </button>
                    {sheetCfg && (
                      <button formAction={disconnectSheet} className="btn dismiss" type="submit">
                        Unlink sheet
                      </button>
                    )}
                  </div>
                </form>

                {sheetCfg && (
                  <div
                    style={{
                      marginTop: '0.8rem',
                      padding: '0.55rem 0.75rem',
                      background: 'rgba(26,122,66,0.06)',
                      border: '1px solid rgba(26,122,66,0.2)',
                      borderRadius: 8,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span className="meta" style={{ color: '#1a7a42', fontWeight: 600 }}>
                      ✅ {sheetTitle ?? sheetCfg.spreadsheet_id}
                    </span>
                    {sheetTabs.length > 0 && (
                      <span className="meta" style={{ color: 'var(--muted)' }}>
                        Tabs: {sheetTabs.map((t) => <code key={t} style={{ marginRight: 4 }}>{t}</code>)}
                      </span>
                    )}
                    <a
                      href={`https://docs.google.com/spreadsheets/d/${sheetCfg.spreadsheet_id}/edit`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ fontWeight: 600, color: 'var(--red)', fontSize: '0.85rem' }}
                    >
                      Open sheet →
                    </a>
                  </div>
                )}
              </>
            )}
          </IntegrationAccordion>

          {/* ── Trello ──────────────────────────────────────── */}
          <IntegrationAccordion
            title="Trello"
            icon="T"
            badge="beta"
            status={trelloToken ? `Connected as ${trelloMember ?? 'your Trello account'}` : 'Not connected'}
            statusOk={Boolean(trelloToken)}
            defaultOpen={!trelloToken}
          >
            {!trelloApiConfigured ? (
              <p className="meta">
                API key not configured — contact support to enable Trello.
              </p>
            ) : trelloToken ? (
              <>
                <p className="meta" style={{ marginBottom: '0.75rem' }}>
                  Connected as <strong>{trelloMember ?? 'your Trello account'}</strong>.
                  View your boards and cards in the Trello tab.
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <Link href="/dashboard/trello" className="btn">
                    View Trello boards →
                  </Link>
                  <form action={disconnectTrello}>
                    <button type="submit" className="btn dismiss">
                      Disconnect
                    </button>
                  </form>
                </div>
              </>
            ) : (
              <>
                <p className="meta" style={{ marginBottom: '0.9rem' }}>
                  Connect Trello to view boards, lists, and cards directly in your dashboard.
                </p>

                <div style={{ display: 'grid', gap: '0.7rem' }}>
                  {/* Step 1 */}
                  <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'var(--royal)',
                        color: '#fff',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      1
                    </span>
                    <div>
                      <p className="meta" style={{ margin: 0, fontWeight: 600 }}>
                        Get your Trello token
                      </p>
                      <p className="meta" style={{ margin: '0.2rem 0 0.5rem' }}>
                        Click below — Trello will ask you to approve access and then display your token.
                        Copy it.
                      </p>
                      <a
                        href={trelloAuthUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="btn approve"
                        style={{ textDecoration: 'none', display: 'inline-block' }}
                      >
                        Open Trello authorization →
                      </a>
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
                    <span
                      style={{
                        flexShrink: 0,
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        background: 'var(--royal)',
                        color: '#fff',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginTop: 1,
                      }}
                    >
                      2
                    </span>
                    <div style={{ flex: 1 }}>
                      <p className="meta" style={{ margin: '0 0 0.4rem', fontWeight: 600 }}>
                        Paste your token below
                      </p>
                      <form action={saveTrelloToken} style={{ display: 'grid', gap: '0.5rem' }}>
                        <input
                          name="token"
                          placeholder="Paste your Trello token here"
                          style={INPUT_STYLE}
                          required
                        />
                        <button type="submit" className="btn approve" style={{ justifySelf: 'start' }}>
                          Save token
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              </>
            )}
          </IntegrationAccordion>

          {/* ── Zapier inbound ──────────────────────────────── */}
          <IntegrationAccordion
            title="Zapier — push leads in"
            icon="⚡"
            badge="free"
            status={zapierInboundStatus}
            statusOk={Boolean(zapierKey)}
            defaultOpen={Boolean(zapierKey)}
          >
            <p className="meta" style={{ marginBottom: '0.75rem' }}>
              Hook up any tool that has a Zapier integration — HubSpot, Pipedrive,
              Typeform, Calendly, Facebook Lead Ads — and pipe new contacts straight
              into your dashboard. <strong>You build the Zap once, it runs forever.</strong>{' '}
              No extra charge. No us involved. Zapier&apos;s free plan is enough to
              get started.
            </p>

            {!zapierKey ? (
              <form action={generateKey}>
                <button type="submit" className="btn approve">
                  Generate my webhook URL
                </button>
              </form>
            ) : (
              <>
                <label style={{ display: 'grid', gap: '0.3rem', marginBottom: '0.7rem' }}>
                  <span className="meta">
                    <strong>Your personal inbound webhook URL</strong> — treat it like a
                    password
                  </span>
                  <input readOnly value={inboundUrl} style={INPUT_STYLE} />
                </label>

                <details className="collapse">
                  <summary>Setup guide — connect in 5 minutes</summary>
                  <ol style={{ paddingLeft: '1.2rem', display: 'grid', gap: '0.6rem', margin: '0.7rem 0 0' }}>
                    <li>
                      <p className="name" style={{ margin: 0 }}>Open Zapier and start a new Zap</p>
                      <p className="meta" style={{ margin: '0.1rem 0 0' }}>
                        <a href="https://zapier.com/app/zap-editor/create" target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                          Open the Zap editor →
                        </a>
                      </p>
                    </li>
                    <li>
                      <p className="name" style={{ margin: 0 }}>Pick your trigger app</p>
                      <p className="meta" style={{ margin: '0.1rem 0 0' }}>
                        Popular sources:{' '}
                        {[
                          ['HubSpot', 'https://zapier.com/apps/hubspot/integrations'],
                          ['Pipedrive', 'https://zapier.com/apps/pipedrive/integrations'],
                          ['Salesforce', 'https://zapier.com/apps/salesforce/integrations'],
                          ['Typeform', 'https://zapier.com/apps/typeform/integrations'],
                          ['Calendly', 'https://zapier.com/apps/calendly/integrations'],
                          ['Facebook Lead Ads', 'https://zapier.com/apps/facebook-lead-ads/integrations'],
                        ].map(([label, href], i, arr) => (
                          <span key={label}>
                            <a href={href} target="_blank" rel="noreferrer">{label}</a>
                            {i < arr.length - 1 ? ', ' : ''}
                          </span>
                        ))}
                      </p>
                    </li>
                    <li>
                      <p className="name" style={{ margin: 0 }}>Add action: Webhooks by Zapier → POST</p>
                      <p className="meta" style={{ margin: '0.1rem 0 0' }}>
                        Paste the URL above. Set <strong>Payload Type</strong> to <code>JSON</code>.
                      </p>
                    </li>
                    <li>
                      <p className="name" style={{ margin: 0 }}>Map these fields in the Data section</p>
                      <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1rem', display: 'grid', gap: '0.15rem' }}>
                        <li className="meta"><code>name</code> — full name <em>(required if no email)</em></li>
                        <li className="meta"><code>email</code> — email address <em>(required if no name)</em></li>
                        <li className="meta"><code>company</code>, <code>notes</code>, <code>status</code>, <code>source</code>, <code>external_id</code> — all optional</li>
                      </ul>
                    </li>
                    <li>
                      <p className="name" style={{ margin: 0 }}>Test &amp; flip it on</p>
                      <p className="meta" style={{ margin: '0.1rem 0 0' }}>
                        You should get <code>{`{"ok":true,"action":"created"}`}</code>. Refresh your dashboard — lead is there.
                      </p>
                    </li>
                  </ol>
                </details>

                <details className="collapse" style={{ marginTop: '0.4rem' }}>
                  <summary>Test from a terminal</summary>
                  <pre style={{ marginTop: '0.5rem', padding: '0.65rem 0.8rem', background: 'var(--paper-2)', border: '1px solid rgba(15,15,15,0.12)', borderRadius: 8, fontSize: '0.8rem', overflowX: 'auto', color: 'var(--ink)' }}>
{`curl -X POST '${inboundUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '{"name":"Test Lead","email":"test@example.com","company":"Acme"}'`}
                  </pre>
                </details>

                <details className="collapse" style={{ marginTop: '0.4rem' }}>
                  <summary>Common errors</summary>
                  <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1rem', display: 'grid', gap: '0.25rem' }}>
                    <li className="meta"><strong>401</strong> — copied URL without the <code>?key=…</code>. Copy the full URL above.</li>
                    <li className="meta"><strong>400</strong> — neither <code>name</code> nor <code>email</code> was mapped.</li>
                    <li className="meta"><strong>403</strong> — key expired. Rotate below and update your Zap.</li>
                    <li className="meta"><strong>Lead missing</strong> — refresh; if still missing check Zapier&apos;s task history.</li>
                  </ul>
                </details>

                <form action={rotateKey} style={{ marginTop: '0.9rem' }}>
                  <button type="submit" className="btn dismiss">
                    Rotate key — invalidates the old URL
                  </button>
                </form>
              </>
            )}
          </IntegrationAccordion>

          {/* ── Zapier outbound ─────────────────────────────── */}
          <IntegrationAccordion
            title="Zapier — push events out"
            icon="🔁"
            badge="free"
            status={zapierOutboundStatus}
            statusOk={Boolean(outboundHook)}
            defaultOpen={Boolean(outboundHook)}
          >
            <p className="meta" style={{ marginBottom: '0.75rem' }}>
              When Virtual Closer updates a lead (status flip, note added, call logged),
              it can fire a webhook to Zapier so you can fan it out to Slack, your CRM,
              a spreadsheet — anything.
            </p>
            <ol style={{ paddingLeft: '1.1rem', display: 'grid', gap: '0.3rem', margin: '0 0 0.9rem' }}>
              <li className="meta">In Zapier, create a Zap with <strong>Webhooks by Zapier → Catch Hook</strong> as the trigger.</li>
              <li className="meta">Copy the <code>hooks.zapier.com/…</code> URL Zapier gives you.</li>
              <li className="meta">Paste it below, save. Then wire whatever action(s) you want in Zapier.</li>
            </ol>
            <form action={saveOutbound} style={{ display: 'grid', gap: '0.5rem' }}>
              <label style={{ display: 'grid', gap: '0.3rem' }}>
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
          </IntegrationAccordion>

        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────
          SECTION 2 — Premium / locked integrations
      ──────────────────────────────────────────────────────────── */}
      <section style={{ marginTop: '1.8rem' }}>
        <p
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--muted)',
            marginBottom: '0.55rem',
          }}
        >
          We set it up for you — done-for-you add-ons
        </p>
        <p className="meta" style={{ marginBottom: '0.85rem' }}>
          Don&apos;t want to manage Zapier or deal with API setup? Upgrade to a
          direct integration — we build it, maintain it, and make sure your CRM
          stays in sync automatically without you touching a thing.
        </p>

        <div
          style={{
            display: 'flex',
            gap: '0.6rem',
            flexWrap: 'wrap',
            marginBottom: '1.2rem',
            padding: '1rem 1.1rem',
            background: 'var(--paper)',
            border: '1.5px solid var(--ink)',
            borderRadius: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <p style={{ margin: 0, fontWeight: 700, fontSize: '0.97rem' }}>Want us to do it for you?</p>
            <p className="meta" style={{ margin: '0.2rem 0 0' }}>
              Book a 30-min call and we&apos;ll scope the integration, set it up, and
              keep it running. You pay the add-on fee — we handle everything else.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <a
              className="btn approve"
              href="https://cal.com/virtualcloser/30min"
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'none' }}
            >
              Book a call →
            </a>
            <a
              className="btn dismiss"
              href="mailto:team@virtualcloser.com?subject=Integration%20setup"
              style={{ textDecoration: 'none' }}
            >
              Email us
            </a>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '0.5rem' }}>

          {!activeAddons.has('addon_ghl_crm') && (
            <LockedIntegrationCard
              icon="🏗️"
              title="GoHighLevel CRM"
              badge="CRM add-on · $40/mo"
              description="Two-way GHL integration. Pipeline stage moves trigger your GHL workflows — SMS, email, tags — automatically."
              whatsIncluded={[
                'Bi-directional contact + opportunity sync',
                '"Move Dana to Proposal" from Telegram updates GHL instantly',
                'AI dialer stamps GHL tags: vc-confirmed, vc-reschedule-requested',
              ]}
              priceLabel="$40 / mo"
            />
          )}

          {!activeAddons.has('addon_hubspot_crm') && (
            <LockedIntegrationCard
              icon="🧡"
              title="HubSpot CRM"
              badge="CRM add-on · $40/mo"
              description="Two-way HubSpot integration. Deals, contacts, and pipeline stages stay in sync automatically."
              whatsIncluded={[
                'Bi-directional deal + contact sync',
                'Pipeline stage moves reflected in HubSpot',
                'Note + activity logging on every interaction',
              ]}
              priceLabel="$40 / mo"
            />
          )}

          {!activeAddons.has('addon_pipedrive_crm') && (
            <LockedIntegrationCard
              icon="🔵"
              title="Pipedrive CRM"
              badge="CRM add-on · $40/mo"
              description="Two-way Pipedrive integration. Deals and contacts updated the moment you tell Telegram."
              whatsIncluded={[
                'Bi-directional deal + contact sync',
                'Pipeline stage moves reflected in Pipedrive',
                'Note + activity logging',
              ]}
              priceLabel="$40 / mo"
            />
          )}

          {!activeAddons.has('addon_salesforce_crm') && (
            <LockedIntegrationCard
              icon="☁️"
              title="Salesforce CRM"
              badge="CRM add-on · $80/mo"
              description="Two-way Salesforce integration, custom-mapped to your org&apos;s objects and field schema."
              whatsIncluded={[
                'Bi-directional opportunity + contact sync',
                "Custom field mapping to your org's schema",
                'Stage transition automations',
              ]}
              priceLabel="$80 / mo"
            />
          )}

          {!activeAddons.has('addon_bluebubbles') && (
            <LockedIntegrationCard
              icon="💬"
              title="iMessage relay — BlueBubbles"
              badge="Messaging add-on · $80/mo"
              description="Send and receive iMessage from inside Virtual Closer. AI drafts replies in your voice — you approve, it sends from your number."
              whatsIncluded={[
                "iMessage send + receive on your Mac's number",
                'AI-drafted replies, you approve before send',
                'Inbound messages routed to the right lead',
              ]}
              priceLabel="$80 / mo"
            />
          )}

          {activeAddons.has('addon_wavv_kpi') && (
            <IntegrationAccordion
              title="WAVV dialer KPI ingest"
              icon="📞"
              badge="active"
              status={wavvSecret ? (isEnterpriseMember ? 'Your webhook URL is live' : 'Webhook URL active') : 'Setup needed — generate your URL'}
              statusOk={Boolean(wavvSecret)}
              defaultOpen={!wavvSecret}
            >
              <p className="meta" style={{ marginBottom: '0.75rem' }}>
                {isEnterpriseMember
                  ? 'Your personal webhook URL attributes every WAVV call to you on the team dashboard. Your manager and owner see your stats alongside the rest of the team. Paste this URL into WAVV or your Zapier bridge.'
                  : 'Point your WAVV account (or a Zapier bridge) at the webhook URL below. Every call disposition lands on your dashboard within seconds — dials, connects, recordings, the works.'}
              </p>

              {wavvWebhookUrl ? (
                <>
                  <p style={{ fontSize: 12, fontWeight: 700, marginBottom: '0.3rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {isEnterpriseMember ? 'Your personal webhook URL' : 'Webhook URL'}
                  </p>
                  <input
                    readOnly
                    value={wavvWebhookUrl}
                    style={{ ...INPUT_STYLE, width: '100%', marginBottom: '0.75rem', boxSizing: 'border-box' }}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <details style={{ marginBottom: '0.75rem' }}>
                    <summary className="meta" style={{ cursor: 'pointer', fontWeight: 600 }}>Setup instructions</summary>
                    <div className="meta" style={{ paddingTop: '0.5rem', display: 'grid', gap: '0.4rem' }}>
                      <p><strong>Option A — Zapier bridge (most common):</strong> Create a Zap: WAVV call disposition → Webhooks by Zapier → POST to your URL above. The secret is already in the URL — no custom headers needed.</p>
                      <p><strong>Option B — GHL Call Status workflow:</strong> Add a webhook action to your GHL &ldquo;Call Status&rdquo; trigger and point it at your URL. Works even without a native WAVV webhook.</p>
                      <p><strong>Option C — Direct WAVV webhook</strong> (B2B partner accounts only): paste your URL into WAVV&apos;s webhook configuration screen.</p>
                    </div>
                  </details>
                  <form action={saveWavvConfig}>
                    <button type="submit" className="btn dismiss" style={{ fontSize: 12 }}>Rotate secret</button>
                  </form>
                </>
              ) : (
                <form action={saveWavvConfig}>
                  <button type="submit" className="btn approve">Generate webhook URL</button>
                </form>
              )}
            </IntegrationAccordion>
          )}

          {!activeAddons.has('addon_wavv_kpi') && (
            <LockedIntegrationCard
              icon="📞"
              title="WAVV dialer KPI ingest"
              badge="Analytics add-on · $20/mo"
              description="Your WAVV dispositions land on your dashboard the second they happen. Daily KPI rollups, recordings, and disposition trends."
              whatsIncluded={[
                'Inbound webhook receives every WAVV disposition',
                'Daily dials / connects / conversations / appts-set rollup',
                'Recording playback inside Virtual Closer',
              ]}
              priceLabel="$20 / mo"
            />
          )}

          {!activeAddons.has('addon_fathom') && (
            <LockedIntegrationCard
              icon="🎙️"
              title="Fathom call intelligence"
              badge="Analytics add-on · $30/mo"
              description="Your Fathom recordings + transcripts auto-imported, action items extracted, deals updated."
              whatsIncluded={[
                'Inbound webhook for every recorded call',
                'Action items extracted to brain dump',
                'Deal stage suggestions based on call content',
              ]}
              priceLabel="$30 / mo"
            />
          )}

        </div>
      </section>

      {/* ── Request custom integration ─────────────────────────────── */}
      <div id="request-integration">
        <IntegrationRequestCard />
      </div>
    </main>
  )
}
