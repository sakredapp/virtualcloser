// Server-rendered onboarding checklist for the admin clients page.
//
// Shows green/yellow/red badges for each piece of platform plumbing this
// client needs configured to actually use the AI dialer + roleplay + CRM
// sync. The admin sees at a glance what's left to do.

import { getIntegrationConfig } from '@/lib/client-integrations'
import { supabase } from '@/lib/supabase'

type CheckStatus = 'ok' | 'partial' | 'missing'

type CheckItem = {
  key: string
  label: string
  status: CheckStatus
  detail: string
  doc?: string // 1-line "how to fix this"
}

async function buildChecklist(repId: string): Promise<CheckItem[]> {
  const items: CheckItem[] = []

  // 1. RevRing voice
  const revring = await getIntegrationConfig(repId, 'revring')
  if (revring?.api_key && revring?.from_number) {
    const agentsConfigured =
      !!revring.confirm_agent_id ||
      !!revring.appointment_setter_agent_id ||
      !!revring.live_transfer_agent_id
    items.push({
      key: 'revring',
      label: 'Voice (RevRing)',
      status: agentsConfigured ? 'ok' : 'partial',
      detail: agentsConfigured
        ? `API key set · from=${revring.from_number} · agents wired (${[
            revring.confirm_agent_id && 'confirm',
            revring.appointment_setter_agent_id && 'setter',
            revring.live_transfer_agent_id && 'transfer',
          ].filter(Boolean).join(', ')})`
        : 'API key + from number set, but no agent IDs wired yet. Add the agent IDs in the RevRing card below.',
      doc: 'RevRing dashboard → copy API key + from number, then create per-flow agents and paste their IDs.',
    })
  } else {
    items.push({
      key: 'revring',
      label: 'Voice (RevRing)',
      status: 'missing',
      detail: 'No RevRing API key + from number set. Voice dialer + roleplay will not work.',
      doc: 'Sign up at revring.ai → copy API key + your purchased from number, paste into the RevRing card in Integrations below.',
    })
  }

  // 2. Twilio (BYO phone number — optional, for caller-ID spoofing)
  const twilio = await getIntegrationConfig(repId, 'twilio')
  if (twilio?.account_sid && twilio?.auth_token && twilio?.phone_number) {
    items.push({
      key: 'twilio',
      label: 'Twilio (BYO phone + SMS)',
      status: 'ok',
      detail: `Account SID + token + ${twilio.phone_number} on file. SMS workflows on stage updates can fire.`,
    })
  } else {
    items.push({
      key: 'twilio',
      label: 'Twilio (BYO phone + SMS)',
      status: 'missing',
      detail: 'Optional. Without it, the dialer uses the RevRing-configured from number and SMS-on-stage-change workflows are disabled.',
      doc: 'Twilio Console → Account → API keys + a US phone number. Paste account_sid + auth_token + phone_number into Integrations below.',
    })
  }

  // 3. GHL CRM
  const ghl = await getIntegrationConfig(repId, 'ghl')
  if (ghl?.api_key && ghl?.location_id) {
    const webhookSet = !!ghl.webhook_secret
    items.push({
      key: 'ghl',
      label: 'GoHighLevel CRM',
      status: webhookSet ? 'ok' : 'partial',
      detail: webhookSet
        ? `Connected (location ${String(ghl.location_id).slice(0, 8)}…). Inbound webhook signed.`
        : `API key + location set. Inbound webhook secret missing → events from GHL won't be auth-verified.`,
      doc: webhookSet ? '' : 'GHL Settings → Webhooks → set URL to /api/webhooks/ghl/<rep_id> and copy the secret.',
    })
  } else {
    items.push({
      key: 'ghl',
      label: 'GoHighLevel CRM',
      status: 'missing',
      detail: 'Not connected. Bidirectional pipeline sync + stage-change SMS workflows disabled.',
      doc: 'GHL → Settings → Private Integrations → create token. Paste api_key + location_id into Integrations.',
    })
  }

  // 4. HubSpot CRM
  const hubspot = await getIntegrationConfig(repId, 'hubspot')
  items.push({
    key: 'hubspot',
    label: 'HubSpot CRM',
    status: hubspot?.api_key ? 'ok' : 'missing',
    detail: hubspot?.api_key
      ? 'Private app token on file. Stage pushes work.'
      : 'Optional. Skip if client uses GHL.',
    doc: hubspot?.api_key ? '' : 'HubSpot → Settings → Integrations → Private Apps → CRM scopes (deals).',
  })

  // 4b. WAVV dialer KPI ingest — only relevant if the add-on was purchased.
  const { data: wavvAddon } = await supabase
    .from('client_addons')
    .select('status')
    .eq('rep_id', repId)
    .eq('addon_key', 'addon_wavv_kpi')
    .maybeSingle()
  if (wavvAddon && wavvAddon.status !== 'cancelled') {
    const wavv = await getIntegrationConfig(repId, 'wavv')
    const ghlConnected = !!(ghl?.api_key && ghl?.location_id)
    // Primary path: WAVV calls land in GHL → GHL Call Status workflow
    // webhook → us. "Ready" = GHL is connected. The wavv integration row
    // is only needed for the rare direct/Zapier delivery case.
    const status: CheckStatus = ghlConnected
      ? 'ok'
      : wavv?.webhook_secret
        ? 'partial'
        : 'missing'
    items.push({
      key: 'wavv',
      label: 'WAVV dialer KPI ingest',
      status,
      detail: ghlConnected
        ? `Delivered via GHL: every WAVV call placed inside GHL fires the Call Status workflow → /api/webhooks/ghl/${repId} → voice_calls (provider=wavv) + dialer_kpis. Make sure the client built a Workflow with trigger "Call Status" → action "Webhook" pointing at that URL.`
        : wavv?.webhook_secret
          ? 'GHL not connected, but a direct/Zapier wavv webhook secret is configured — secondary path will work.'
          : 'Add-on purchased but no delivery path configured. Connect GHL above (preferred) OR set a wavv webhook_secret for direct/Zapier delivery.',
      doc: ghlConnected
        ? `In the client's GHL: Automation → Workflows → New → Trigger "Call Status" (any) → Action "Webhook" → paste /api/webhooks/ghl/${repId}. Save & publish.`
        : 'Connect GHL (above) so WAVV-on-GHL calls flow in automatically. Or save a wavv integration with a webhook_secret if the client wants direct/Zapier delivery.',
    })
  }

  // 5. Training docs uploaded
  const { count: docCount } = await supabase
    .from('roleplay_training_docs')
    .select('id', { head: true, count: 'exact' })
    .eq('rep_id', repId)
    .eq('is_active', true)
  items.push({
    key: 'training_docs',
    label: 'AI training documents',
    status: (docCount ?? 0) > 0 ? 'ok' : 'missing',
    detail:
      (docCount ?? 0) > 0
        ? `${docCount} active doc${docCount === 1 ? '' : 's'} feeding the dialer + roleplay assistant prompts.`
        : 'Client has not uploaded any product brief / scripts / objection guides. AI will use generic prompt templates only.',
    doc: '/dashboard/dialer or /dashboard/roleplay → drag-drop PDF/.txt/.md/.docx. Auto-extracted into the assistant system prompt.',
  })

  // 6. Roleplay scenarios
  const { count: scenarioCount } = await supabase
    .from('roleplay_scenarios')
    .select('id', { head: true, count: 'exact' })
    .eq('rep_id', repId)
    .eq('is_active', true)
  items.push({
    key: 'scenarios',
    label: 'Roleplay scenarios',
    status: (scenarioCount ?? 0) > 0 ? 'ok' : 'partial',
    detail:
      (scenarioCount ?? 0) > 0
        ? `${scenarioCount} active scenarios (custom + presets).`
        : 'No scenarios saved yet. Client can click preset library on /dashboard/roleplay.',
  })

  // 7. Telegram bot link
  const { data: linked } = await supabase
    .from('members')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', repId)
    .not('telegram_chat_id', 'is', null)
  items.push({
    key: 'telegram',
    label: 'Telegram bot linked',
    status: (linked as unknown as { count?: number })?.count ? 'ok' : 'missing',
    detail: (linked as unknown as { count?: number })?.count
      ? 'At least one member linked their chat ID.'
      : 'No member has linked their Telegram chat. Bot relay + KPI logging via Telegram disabled until they do.',
    doc: '/dashboard → /telegram link button → opens t.me/<bot>?start=<code>.',
  })

  // 8. Cal.com booking link (offer page)
  const { data: rep } = await supabase
    .from('reps')
    .select('cal_booking_url, business_name')
    .eq('id', repId)
    .maybeSingle()
  items.push({
    key: 'cal',
    label: 'Cal.com booking link',
    status: rep?.cal_booking_url ? 'ok' : 'missing',
    detail: rep?.cal_booking_url
      ? `Link on file: ${rep.cal_booking_url}`
      : 'No public booking link set — /offer "Book a call" CTAs will fall back to default URL.',
    doc: 'Cal.com → Event types → copy public link. Set as cal_booking_url on the rep row.',
  })

  return items
}

const STATUS_STYLES: Record<CheckStatus, { color: string; bg: string; label: string }> = {
  ok:      { color: '#fff', bg: '#1f8a3b', label: '✓ ready' },
  partial: { color: '#0f0f0f', bg: '#f0c100', label: '⚠ partial' },
  missing: { color: '#fff', bg: '#c21a00', label: '✗ missing' },
}

export default async function OnboardingChecklist({ repId }: { repId: string }) {
  const items = await buildChecklist(repId)
  const okCount = items.filter((i) => i.status === 'ok').length
  const totalCount = items.length

  return (
    <section
      className="card"
      style={{ marginTop: '1rem', borderLeft: '4px solid var(--red, #ff2800)' }}
    >
      <div className="section-head">
        <h2>Onboarding checklist</h2>
        <p>
          {okCount}/{totalCount} ready
        </p>
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
        {items.map((item) => {
          const s = STATUS_STYLES[item.status]
          return (
            <li
              key={item.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                gap: 12,
                alignItems: 'start',
                padding: '10px 12px',
                borderRadius: 8,
                background: 'var(--paper-2, #f7f4ef)',
                border: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: s.bg,
                  color: s.color,
                  padding: '4px 8px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  marginTop: 2,
                }}
              >
                {s.label}
              </span>
              <div>
                <p style={{ margin: 0, fontWeight: 700 }}>{item.label}</p>
                <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: 'var(--muted, #5a5a5a)' }}>
                  {item.detail}
                </p>
                {item.doc && item.status !== 'ok' ? (
                  <p
                    style={{
                      margin: '4px 0 0',
                      fontSize: '0.8rem',
                      color: 'var(--ink, #0f0f0f)',
                      fontStyle: 'italic',
                    }}
                  >
                    → {item.doc}
                  </p>
                ) : null}
              </div>
              <span style={{ alignSelf: 'center', fontSize: '0.7rem', color: 'var(--muted, #5a5a5a)' }}>
                {item.key}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
