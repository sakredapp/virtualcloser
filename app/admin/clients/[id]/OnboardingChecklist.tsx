// Server-rendered onboarding checklist for the admin client detail page.
//
// Every check reads live DB / integration config state so the admin always
// sees the real current status — no stale snapshots. Green = go-live ready,
// yellow = partial / warning, red = blocked / missing.

import { getIntegrationConfig } from '@/lib/client-integrations'
import { supabase } from '@/lib/supabase'

type CheckStatus = 'ok' | 'partial' | 'missing'

type CheckItem = {
  key: string
  label: string
  status: CheckStatus
  detail: string
  action?: string  // what the admin needs to do (shown when not ok)
}

// ── Data ──────────────────────────────────────────────────────────────────

async function buildChecklist(repId: string): Promise<CheckItem[]> {
  const items: CheckItem[] = []

  // ── Load all config upfront (parallel) ───────────────────────────────
  const [revring, twilio, ghl, hubspot] = await Promise.all([
    getIntegrationConfig(repId, 'revring'),
    getIntegrationConfig(repId, 'twilio'),
    getIntegrationConfig(repId, 'ghl'),
    getIntegrationConfig(repId, 'hubspot'),
  ])

  const [
    { data: repRow },
    { data: salespeople },
    { count: docCount },
    { count: scenarioCount },
    { data: members },
    { data: agentBillingRows },
    { data: wavvAddon },
  ] = await Promise.all([
    supabase.from('reps').select('billing_status, cal_booking_url, business_name').eq('id', repId).maybeSingle(),
    supabase.from('ai_salespeople').select('*').eq('rep_id', repId).is('archived_at', null),
    supabase.from('roleplay_training_docs').select('id', { head: true, count: 'exact' }).eq('rep_id', repId).eq('is_active', true),
    supabase.from('roleplay_scenarios').select('id', { head: true, count: 'exact' }).eq('rep_id', repId).eq('is_active', true),
    supabase.from('members').select('id, display_name, telegram_chat_id').eq('rep_id', repId),
    supabase.from('agent_billing').select('id, status, member_id').eq('rep_id', repId),
    supabase.from('client_addons').select('status').eq('rep_id', repId).eq('addon_key', 'addon_wavv_kpi').maybeSingle(),
  ])

  const activeSalespeople = (salespeople ?? []).filter(
    (s) => (s as Record<string, unknown>).status === 'active',
  )
  const primarySetter = activeSalespeople[0] as Record<string, unknown> | undefined

  // ── SECTION 1: BILLING + SUBSCRIPTION ────────────────────────────────

  items.push({ key: 'section_billing', label: '── BILLING & SUBSCRIPTION ──', status: 'ok', detail: '' })

  // 1.1 Subscription active
  const billingActive = repRow?.billing_status === 'active'
  items.push({
    key: 'subscription',
    label: '1. Subscription active',
    status: billingActive ? 'ok' : 'missing',
    detail: billingActive
      ? 'Subscription is active. Billing period open.'
      : 'No active subscription. Client cannot access any paid features.',
    action: 'Admin billing page → Activate Subscription. Idempotent — safe to re-run.',
  })

  // 1.2 Agent billing seeded
  if (billingActive) {
    const activeAgentCount = (agentBillingRows ?? []).filter(
      (r) => (r as { status: string }).status === 'active',
    ).length
    const memberIds = (agentBillingRows ?? []).map((r) => (r as { member_id: string }).member_id)
    let openPeriodCount = 0
    if (memberIds.length > 0) {
      const { count } = await supabase
        .from('agent_billing_period')
        .select('id', { count: 'exact', head: true })
        .in('member_id', memberIds)
        .eq('status', 'open')
      openPeriodCount = count ?? 0
    }
    items.push({
      key: 'agent_billing',
      label: '2. Agent billing seeded',
      status: activeAgentCount > 0 && openPeriodCount > 0 ? 'ok' : 'missing',
      detail:
        activeAgentCount > 0 && openPeriodCount > 0
          ? `${activeAgentCount} member(s) active + ${openPeriodCount} open billing period(s). Dialer cap checks will pass.`
          : `${activeAgentCount} active billing row(s), ${openPeriodCount} open period(s). Without both, canDial() blocks every SDR call.`,
      action: 'POST /api/admin/billing/<repId>/activate-subscription — idempotent, seeds missing rows without re-charging.',
    })
  }

  // ── SECTION 2: TEAM SETUP ─────────────────────────────────────────────

  items.push({ key: 'section_team', label: '── TEAM SETUP ──', status: 'ok', detail: '' })

  // 2.1 Owner member exists
  const ownerMember = (members ?? []).find((m) => (m as Record<string, unknown>).role === 'owner')
  const memberCount = (members ?? []).length
  items.push({
    key: 'members',
    label: '3. Team members invited',
    status: memberCount > 0 ? 'ok' : 'missing',
    detail: memberCount > 0
      ? `${memberCount} member(s) on account${ownerMember ? ` including owner ${(ownerMember as Record<string, unknown>).display_name}` : ''}.`
      : 'No members. Client cannot log in.',
    action: '/admin/clients/<id>/members → Invite member (role: owner).',
  })

  // 2.2 Telegram linked (for call + booking alerts)
  const telegramLinkedCount = (members ?? []).filter(
    (m) => (m as Record<string, unknown>).telegram_chat_id,
  ).length
  items.push({
    key: 'telegram',
    label: '4. Telegram alerts linked',
    status: telegramLinkedCount > 0 ? 'ok' : 'missing',
    detail: telegramLinkedCount > 0
      ? `${telegramLinkedCount} member(s) linked. Booking alerts + dialer updates will fire.`
      : 'No members linked to Telegram. Client will not receive real-time booking alerts or daily summaries.',
    action: 'Client goes to /dashboard → Telegram section → clicks "Link Telegram" → starts bot with their code.',
  })

  // ── SECTION 3: REVRING / VOICE INFRASTRUCTURE ─────────────────────────

  items.push({ key: 'section_voice', label: '── REVRING VOICE INFRASTRUCTURE ──', status: 'ok', detail: '' })

  // 3.1 RevRing API key + from number
  const revringOk = !!(revring?.api_key && revring?.from_number)
  items.push({
    key: 'revring_creds',
    label: '5. RevRing: API key + from number',
    status: revringOk ? 'ok' : 'missing',
    detail: revringOk
      ? `API key set. From number: ${revring!.from_number}`
      : 'No RevRing credentials. All AI voice features (dialer, confirm calls, roleplay) are blocked.',
    action: 'RevRing dashboard → create sub-profile for this client → copy API key. Assign a Twilio number (BYO trunk) to that profile → paste from_number. Add in the AI Voice card below.',
  })

  // 3.2 RevRing agent IDs
  const confirmerSet = !!revring?.confirm_agent_id
  const setterAgentSet = !!revring?.appointment_setter_agent_id
  const liveTransferSet = !!revring?.live_transfer_agent_id
  const agentCount = [confirmerSet, setterAgentSet, liveTransferSet].filter(Boolean).length
  items.push({
    key: 'revring_agents',
    label: '6. RevRing: voice agent IDs wired',
    status: agentCount >= 2 ? 'ok' : agentCount === 1 ? 'partial' : 'missing',
    detail: agentCount >= 2
      ? `Agents: ${[confirmerSet && 'confirm', setterAgentSet && 'setter', liveTransferSet && 'live-transfer'].filter(Boolean).join(', ')}`
      : `Only ${agentCount} agent(s) wired. Missing: ${[!confirmerSet && 'confirm', !setterAgentSet && 'appointment_setter', !liveTransferSet && 'live_transfer'].filter(Boolean).join(', ')}.`,
    action: 'RevRing dashboard → Agents → create per-flow agents → copy each agent ID → paste into AI Voice config card below.',
  })

  // 3.3 RevRing webhook secret
  const revringWebhookSet = !!revring?.webhook_secret
  items.push({
    key: 'revring_webhook',
    label: '7. RevRing: inbound webhook secret',
    status: revringWebhookSet ? 'ok' : 'missing',
    detail: revringWebhookSet
      ? 'Webhook secret on file. Post-call events (outcome, transcript, recording) will be verified + ingested.'
      : 'No webhook secret. RevRing cannot deliver call outcomes — AI SDR pipeline stage moves, dispositions, and SMS follow-ups will not fire after calls.',
    action: `RevRing dashboard → Webhooks → set URL to https://virtualcloser.com/api/webhooks/revring → copy signing secret → paste as webhook_secret in the RevRing config below.`,
  })

  // 3.4 Live calling gate
  const dryRun = revring?.dry_run !== false
  const liveEnabled = revring?.live_enabled === true
  items.push({
    key: 'live_calling',
    label: '8. Live calling enabled (final switch)',
    status: (!dryRun && liveEnabled) ? 'ok' : 'missing',
    detail: (!dryRun && liveEnabled)
      ? 'dry_run=false + live_enabled=true. Real calls will fire on next cron tick.'
      : `BLOCKED: ${dryRun ? 'dry_run is still true' : ''}${dryRun && !liveEnabled ? ' + ' : ''}${!liveEnabled ? 'live_enabled is false' : ''}. Flip both ONLY after all other steps are ✓.`,
    action: 'Set dry_run=false and live_enabled=true in the RevRing integration config below. Do this LAST — after all agents, calendar, and schedule are confirmed working.',
  })

  // ── SECTION 4: TWILIO (BYO ACCOUNT) ──────────────────────────────────

  items.push({ key: 'section_twilio', label: '── TWILIO (CLIENT\'S OWN ACCOUNT) ──', status: 'ok', detail: '' })

  // 4.1 Twilio credentials
  const twilioCredsOk = !!(twilio?.account_sid && twilio?.auth_token && twilio?.phone_number)
  items.push({
    key: 'twilio_creds',
    label: '9. Twilio: account SID + auth token + number',
    status: twilioCredsOk ? 'ok' : 'missing',
    detail: twilioCredsOk
      ? `Account SID on file. From number: ${twilio!.phone_number}. BYO SMS + caller ID ready.`
      : 'No Twilio credentials. AI SMS follow-ups + SMS-on-stage workflows are disabled.',
    action: `Client creates their own Twilio account at twilio.com (required — cannot use a shared account). Console → Account → API Keys → copy Account SID + Auth Token. Buy a US number. Paste all three into Integrations below as key="twilio": { account_sid, auth_token, phone_number }.`,
  })

  // 4.2 Twilio inbound SMS webhook URL
  // We can't auto-verify this is set in Twilio's console, so it's a manual step reminder
  items.push({
    key: 'twilio_sms_webhook',
    label: '10. Twilio: inbound SMS webhook URL set',
    status: twilioCredsOk ? 'partial' : 'missing',
    detail: twilioCredsOk
      ? `Twilio credentials are on file but we cannot auto-verify the inbound webhook is registered in Twilio's console. Must be done manually.`
      : 'Set up Twilio credentials first (step 9).',
    action: `Twilio console → Phone Numbers → the client's number → Messaging → "A message comes in" → Webhook → set URL to: https://virtualcloser.com/api/webhooks/sms/inbound → HTTP POST → Save. Without this, replies from leads never reach the AI.`,
  })

  // ── SECTION 5: AI SALESPERSON (SDR) SETUP ────────────────────────────

  items.push({ key: 'section_setter', label: '── AI SALESPERSON (SDR) SETUP ──', status: 'ok', detail: '' })

  // 5.1 AI Salesperson created + active
  items.push({
    key: 'ai_salesperson',
    label: '11. AI Salesperson: created & active',
    status: activeSalespeople.length > 0 ? 'ok' : salespeople && (salespeople as unknown[]).length > 0 ? 'partial' : 'missing',
    detail: activeSalespeople.length > 0
      ? `${activeSalespeople.length} active setter(s): ${activeSalespeople.map((s) => String((s as Record<string, unknown>).name)).join(', ')}`
      : salespeople && (salespeople as unknown[]).length > 0
        ? `${(salespeople as unknown[]).length} setter(s) exist but none are active (status=draft/paused). Set status → active.`
        : 'No AI Salesperson created. The SDR dialer has nothing to call with.',
    action: 'Client goes to /dashboard/dialer/appointment-setter → Create Salesperson → fill in name, persona, product, and set status → Active.',
  })

  // 5.2 Setter: persona + product filled in
  const persona = primarySetter?.voice_persona as Record<string, unknown> | undefined
  const product = primarySetter?.product_intent as Record<string, unknown> | undefined
  const personaOk = !!(persona?.ai_name && persona?.role_title)
  const productOk = !!(product?.name && product?.explanation)
  items.push({
    key: 'setter_persona',
    label: '12. AI Salesperson: persona + product filled',
    status: primarySetter ? (personaOk && productOk ? 'ok' : 'partial') : 'missing',
    detail: primarySetter
      ? personaOk && productOk
        ? `Agent name: "${persona!.ai_name}" | Product: "${product!.name}"`
        : `Missing: ${[!personaOk && 'AI name / role title', !productOk && 'product name / explanation'].filter(Boolean).join(', ')}. AI will fall back to generic templates.`
      : 'Create a setter first (step 11).',
    action: 'Setter config → Voice Persona: fill in AI name + role title. Product Intent: fill in product name + what it does + why they opted in.',
  })

  // 5.3 Setter: call script + qualifying questions
  const script = primarySetter?.call_script as Record<string, unknown> | undefined
  const qualifying = script?.qualifying as unknown[] | undefined
  const scriptOk = !!(script?.opening && qualifying && qualifying.length > 0)
  items.push({
    key: 'setter_script',
    label: '13. AI Salesperson: call script configured',
    status: primarySetter ? (scriptOk ? 'ok' : 'partial') : 'missing',
    detail: primarySetter
      ? scriptOk
        ? `Opening set. ${qualifying!.length} qualifying question(s) loaded.`
        : `Missing: ${[!script?.opening && 'opening line', (!qualifying || qualifying.length === 0) && 'qualifying questions'].filter(Boolean).join(', ')}.`
      : 'Create a setter first (step 11).',
    action: 'Setter config → Call Script → add opening line + at least 2–3 qualifying questions. This is what the AI says and asks on calls.',
  })

  // 5.4 Setter: calendar configured (required for booking)
  const calendar = primarySetter?.calendar as Record<string, unknown> | undefined
  const calendarOk = !!(calendar?.calendar_id || calendar?.calendar_url)
  items.push({
    key: 'setter_calendar',
    label: '14. AI Salesperson: booking calendar linked',
    status: primarySetter ? (calendarOk ? 'ok' : 'missing') : 'missing',
    detail: primarySetter
      ? calendarOk
        ? `Calendar: ${calendar!.provider ?? 'ghl'} → ID: ${String(calendar!.calendar_id ?? calendar!.calendar_url ?? '').slice(0, 24)}…`
        : 'No calendar linked. The AI will book appointments but they will NOT appear anywhere. Critical gap.'
      : 'Create a setter first (step 11).',
    action: 'GHL → Calendars → copy the calendar ID. In setter config → Calendar → paste GHL calendar ID. Without this, appointments go into a void.',
  })

  // 5.5 Setter: schedule configured
  const schedule = primarySetter?.schedule as Record<string, unknown> | undefined
  const scheduleOk = !!(schedule?.timezone && schedule?.active_days && schedule?.start_hour !== undefined)
  items.push({
    key: 'setter_schedule',
    label: '15. AI Salesperson: dialing schedule set',
    status: primarySetter ? (scheduleOk ? 'ok' : 'partial') : 'missing',
    detail: primarySetter
      ? scheduleOk
        ? `Timezone: ${schedule!.timezone} | Hours: ${schedule!.start_hour}:00–${schedule!.end_hour}:00 | Days: ${(schedule!.active_days as number[])?.join(',')}`
        : 'Timezone / active days / hours not set. Dialer will default to UTC business hours which may miss the client\'s timezone window.'
      : 'Create a setter first (step 11).',
    action: 'Setter config → Schedule → set timezone (e.g. America/New_York), active days, start/end hours, and max dials per day.',
  })

  // 5.6 Setter: SMS scripts (for AI SMS follow-ups after missed calls)
  const smsScripts = primarySetter?.sms_scripts as Record<string, unknown> | undefined
  const smsScriptsOk = !!(smsScripts?.first || smsScripts?.missed)
  items.push({
    key: 'setter_sms_scripts',
    label: '16. AI Salesperson: SMS follow-up scripts',
    status: primarySetter
      ? (twilioCredsOk ? (smsScriptsOk ? 'ok' : 'partial') : 'missing')
      : 'missing',
    detail: primarySetter
      ? twilioCredsOk
        ? smsScriptsOk
          ? `First-touch and/or voicemail follow-up SMS templates configured. AI will send custom messages.`
          : `Twilio is connected but no SMS scripts set. AI will use generic fallback templates after missed calls. Add custom scripts for better response rates.`
        : 'Set up Twilio first (step 9). SMS AI follow-ups require the client\'s own Twilio number.'
      : 'Create a setter first (step 11).',
    action: 'Setter config → SMS Scripts → add "first" (first outbound touch) and "missed" (post-voicemail follow-up). Supports {{name}} and {{product}} variables.',
  })

  // ── SECTION 6: GHL / CRM ─────────────────────────────────────────────

  items.push({ key: 'section_crm', label: '── CRM INTEGRATIONS ──', status: 'ok', detail: '' })

  // 6.1 GHL
  const ghlOk = !!(ghl?.api_key && ghl?.location_id)
  const ghlWebhookOk = !!ghl?.webhook_secret
  items.push({
    key: 'ghl',
    label: '17. GoHighLevel CRM connected',
    status: ghlOk && ghlWebhookOk ? 'ok' : ghlOk ? 'partial' : 'missing',
    detail: ghlOk
      ? ghlWebhookOk
        ? `Connected (location ${String(ghl!.location_id).slice(0, 10)}…). Inbound webhook signed.`
        : `API key + location set but webhook secret missing → GHL → VC events are NOT auth-verified.`
      : 'Not connected. Bidirectional pipeline sync, stage-based SMS workflows, and GHL calendar booking are all disabled.',
    action: ghlOk
      ? `GHL → Settings → Webhooks → URL: https://virtualcloser.com/api/webhooks/ghl/${repId} → copy secret → paste as webhook_secret in the GHL config.`
      : 'GHL → Settings → Private Integrations → create token (all CRM scopes + Calendar). Paste api_key + location_id into Integrations.',
  })

  // 6.2 HubSpot (optional)
  items.push({
    key: 'hubspot',
    label: '18. HubSpot CRM (optional)',
    status: hubspot?.api_key ? 'ok' : 'missing',
    detail: hubspot?.api_key
      ? 'Private app token on file. Stage pushes + deal syncs active.'
      : 'Not connected. Skip if client uses GHL.',
    action: 'HubSpot → Settings → Integrations → Private Apps → create app with CRM scopes (contacts, deals) → copy token.',
  })

  // 6.3 WAVV (if addon)
  if (wavvAddon && (wavvAddon as { status: string }).status !== 'cancelled') {
    const wavv = await getIntegrationConfig(repId, 'wavv')
    items.push({
      key: 'wavv',
      label: '19. WAVV dialer KPI ingest',
      status: ghlOk ? 'ok' : wavv?.webhook_secret ? 'partial' : 'missing',
      detail: ghlOk
        ? `Via GHL workflow. Make sure the client built: Automation → Workflows → Trigger "Call Status" → Webhook → https://virtualcloser.com/api/webhooks/ghl/${repId}.`
        : wavv?.webhook_secret
          ? 'Direct/Zapier path active. GHL not connected.'
          : 'Add-on purchased but no delivery path configured. Connect GHL (preferred).',
      action: ghlOk
        ? `GHL → Automation → Workflows → New → Trigger: Call Status (any) → Action: Webhook → https://virtualcloser.com/api/webhooks/ghl/${repId} → Publish.`
        : 'Connect GHL (step 17) so WAVV calls flow in automatically.',
    })
  }

  // ── SECTION 7: KNOWLEDGE & CONTENT ───────────────────────────────────

  items.push({ key: 'section_content', label: '── KNOWLEDGE & CONTENT ──', status: 'ok', detail: '' })

  const contentItemNumber = wavvAddon ? 20 : 19

  // 7.1 Training docs
  items.push({
    key: 'training_docs',
    label: `${contentItemNumber}. AI training documents uploaded`,
    status: (docCount ?? 0) > 0 ? 'ok' : 'missing',
    detail: (docCount ?? 0) > 0
      ? `${docCount} active doc(s) feeding the dialer + roleplay assistant.`
      : 'No documents uploaded. AI uses only the setter persona and generic prompts — no product-specific knowledge.',
    action: 'Client goes to /dashboard/dialer or /dashboard/roleplay → Upload Documents → drag-drop product PDFs, call scripts, objection guides, FAQ docs. AI ingests automatically.',
  })

  // 7.2 Roleplay scenarios
  items.push({
    key: 'scenarios',
    label: `${contentItemNumber + 1}. Roleplay scenarios configured`,
    status: (scenarioCount ?? 0) > 0 ? 'ok' : 'partial',
    detail: (scenarioCount ?? 0) > 0
      ? `${scenarioCount} active scenario(s) ready.`
      : 'No scenarios yet. Client can add custom ones or load from the preset library.',
    action: 'Client goes to /dashboard/roleplay → Add Scenario → or click "Load Presets" to pull from the template library.',
  })

  // ── SECTION 8: BOOKING LINKS ──────────────────────────────────────────

  items.push({ key: 'section_links', label: '── BOOKING & LINKS ──', status: 'ok', detail: '' })

  // 8.1 Cal.com / booking URL
  items.push({
    key: 'cal',
    label: `${contentItemNumber + 2}. Public booking link set`,
    status: repRow?.cal_booking_url ? 'ok' : 'missing',
    detail: repRow?.cal_booking_url
      ? `Booking URL: ${repRow.cal_booking_url}`
      : 'No booking link. /offer page "Book a Call" CTA will use fallback URL.',
    action: 'Cal.com (or GHL calendar URL) → copy public booking link → set cal_booking_url on the rep row in DB or via the client settings UI.',
  })

  return items
}

// ── Render ────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<CheckStatus, { color: string; bg: string; label: string }> = {
  ok:      { color: '#fff',   bg: '#1f8a3b', label: '✓ ready'   },
  partial: { color: '#0f0f0f', bg: '#f0c100', label: '⚠ partial' },
  missing: { color: '#fff',   bg: '#c21a00', label: '✗ missing'  },
}

export default async function OnboardingChecklist({ repId }: { repId: string }) {
  const items = await buildChecklist(repId)

  const checkItems = items.filter((i) => !i.label.startsWith('──'))
  const okCount = checkItems.filter((i) => i.status === 'ok').length
  const totalCount = checkItems.length
  const allReady = okCount === totalCount

  return (
    <section
      className="card"
      style={{ marginTop: '1rem', borderLeft: `4px solid ${allReady ? '#1f8a3b' : '#c21a00'}` }}
    >
      <div className="section-head">
        <h2>Onboarding checklist</h2>
        <p style={{ fontWeight: 700, color: allReady ? '#1f8a3b' : '#c21a00' }}>
          {okCount}/{totalCount} ready{allReady ? ' — client is go-live ready ✓' : ''}
        </p>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {items.map((item) => {
          // Section header rows
          if (item.label.startsWith('──')) {
            return (
              <li key={item.key} style={{ paddingTop: 12, paddingBottom: 2 }}>
                <p style={{
                  margin: 0,
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--muted, #5a5a5a)',
                }}>
                  {item.label.replace(/──\s*/g, '')}
                </p>
              </li>
            )
          }

          const s = STATUS_STYLES[item.status]
          return (
            <li
              key={item.key}
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: 12,
                alignItems: 'start',
                padding: '10px 12px',
                borderRadius: 8,
                background: item.status === 'ok'
                  ? 'var(--paper-2, #f7f4ef)'
                  : item.status === 'partial'
                    ? '#fffbea'
                    : '#fff5f5',
                border: `1px solid ${item.status === 'ok' ? 'rgba(0,0,0,0.06)' : item.status === 'partial' ? '#e8d600' : '#fca5a5'}`,
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  background: s.bg,
                  color: s.color,
                  padding: '4px 8px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  marginTop: 2,
                  minWidth: 72,
                  justifyContent: 'center',
                }}
              >
                {s.label}
              </span>
              <div>
                <p style={{ margin: 0, fontWeight: 700, fontSize: '0.9rem' }}>{item.label}</p>
                <p style={{ margin: '2px 0 0', fontSize: '0.82rem', color: 'var(--muted, #5a5a5a)' }}>
                  {item.detail}
                </p>
                {item.action && item.status !== 'ok' ? (
                  <p
                    style={{
                      margin: '5px 0 0',
                      fontSize: '0.79rem',
                      color: '#0f0f0f',
                      fontStyle: 'italic',
                      background: 'rgba(0,0,0,0.04)',
                      padding: '5px 8px',
                      borderRadius: 5,
                      borderLeft: '3px solid var(--red, #ff2800)',
                    }}
                  >
                    → {item.action}
                  </p>
                ) : null}
              </div>
            </li>
          )
        })}
      </ul>

      {!allReady && (
        <p style={{
          marginTop: 16,
          fontSize: '0.8rem',
          color: 'var(--muted, #5a5a5a)',
          textAlign: 'center',
          fontStyle: 'italic',
        }}>
          Complete all steps above before setting live_enabled=true. Step 8 (Live calling) is the final switch.
        </p>
      )}
    </section>
  )
}
