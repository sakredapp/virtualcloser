import type { Tenant } from './tenant'
import type { AddonKey } from './addons'

export type OnboardingStep = {
  key: string
  title: string
  /** Short one-liner shown beside the step. */
  description: string
  /**
   * Ordered "do this exactly" instructions. Each line is a discrete click,
   * paste, or command. Placeholders like {slug}, {id}, {display_name}, {email}
   * are auto-filled from the tenant row on the admin detail page.
   */
  instructions: string[]
  owner: 'you' | 'client'
  done?: boolean
  done_at?: string | null
}

// ---------------------------------------------------------------------------
// Shared steps (run for every tier, in this order)
// ---------------------------------------------------------------------------
const SHARED_STEPS: OnboardingStep[] = [
  {
    key: 'kickoff_call',
    title: 'Kickoff call (30 min)',
    description: 'Discovery call before you build anything.',
    owner: 'you',
    instructions: [
      'Send Calendly link: https://cal.com/virtualcloser/kickoff to {email}.',
      'On the call, get: (1) their ICP, (2) top 3 objections they hear, (3) current CRM, (4) where leads currently come from, (5) 3 sample recent deals (won + lost + stuck).',
      'Record the call in Fathom.',
      'Paste the Fathom summary into the "Build notes" field on this page when done.',
    ],
  },
  {
    key: 'payment_confirmed',
    title: 'Confirm payment received',
    description: 'Don\'t start work until Stripe shows paid.',
    owner: 'you',
    instructions: [
      'Open Stripe → Payments → search "{display_name}" or "{email}".',
      'Confirm build fee is captured (one-time) AND the monthly subscription is active.',
      'If missing, resend the Payment Link from /offer for the tier they picked.',
    ],
  },
  {
    key: 'add_subdomain',
    title: 'Add {slug}.virtualcloser.com in Vercel',
    description: 'Their branded URL.',
    owner: 'you',
    instructions: [
      'Open https://vercel.com/your-team/virtualcloser/settings/domains in a new tab.',
      'Click "Add Domain".',
      'Enter: {slug}.virtualcloser.com',
      'Select "No redirect". Save.',
      'Wait ~30 seconds. Visit https://{slug}.virtualcloser.com — you should see the login page.',
    ],
  },
  {
    key: 'set_client_login',
    title: 'Set client login email + password',
    description: 'So they can sign in at /login.',
    owner: 'you',
    instructions: [
      'On this page → "Client login" card.',
      'Confirm email is {email}. If wrong, fix + save.',
      'Generate a strong password in 1Password.',
      'Paste it into "Set new password" and click "Save login".',
      'Store the password in 1Password under "VC · {slug}".',
    ],
  },
  {
    key: 'lead_import',
    title: 'Import current leads',
    description: 'CSV → Supabase.',
    owner: 'client',
    instructions: [
      'Ask client for a CSV export of their current leads with columns: name, email, company, last_contact, notes, status (optional).',
      'Open Supabase → Table Editor → leads → "Insert" → "Import data from CSV".',
      'Map columns. In the "rep_id" override field, set: {id}',
      'Upload. Refresh the table and confirm rows show rep_id = {id}.',
    ],
  },
  {
    key: 'telegram_bot',
    title: 'Connect Telegram bot',
    description: 'So client can text/voice-note their CRM.',
    owner: 'client',
    instructions: [
      'No action needed from you — the client self-serves on their dashboard.',
      'Email {email}: "Log in at https://{slug}.virtualcloser.com/dashboard. Scroll to the Connect Telegram card. It shows your 8-character link code and a tap-through to @VirtualCloserBot. Send the bot /link YOURCODE and you\'re done — every text or voice-note after that lands in your dashboard."',
      'After they send /link, their dashboard card flips to "connected" automatically. No credentials to copy around.',
    ],
  },
  {
    key: 'test_run',
    title: 'Fire a morning-scan manually',
    description: 'Prove the pipeline works end-to-end.',
    owner: 'you',
    instructions: [
      'In a terminal, run:',
      '  curl -H "Authorization: Bearer $CRON_SECRET" https://virtualcloser.com/api/cron/morning-scan',
      'Open https://{slug}.virtualcloser.com/dashboard — confirm drafts appear.',
      'Check the client\'s Telegram — confirm the morning briefing arrived.',
      'If no briefing: double-check "Telegram chat ID" on this page and TELEGRAM_BOT_TOKEN in Vercel env.',
    ],
  },
  {
    key: 'dashboard_walkthrough',
    title: 'Send dashboard walkthrough',
    description: '10-min Loom.',
    owner: 'you',
    instructions: [
      'Open Loom. Record screen at https://{slug}.virtualcloser.com/dashboard (logged in as them).',
      'Show: (1) approving a draft, (2) dismissing a draft, (3) /brain voice dump, (4) texting the Telegram bot a task.',
      'Keep it under 10 minutes.',
      'Paste Loom link into "Build notes" and email to {email}.',
    ],
  },
  {
    key: 'billing_setup',
    title: 'Confirm recurring billing is live',
    description: 'Monthly subscription running.',
    owner: 'you',
    instructions: [
      'Open Stripe → Customers → {email}.',
      'Confirm there is an active subscription at ${monthly_fee}/mo.',
      'Confirm the one-time build fee of ${build_fee} shows as paid.',
      'If anything is off, fix in Stripe and log a note on this page.',
    ],
  },
]

// ---------------------------------------------------------------------------
// Team Builder extras
// ---------------------------------------------------------------------------
const TEAM_BUILDER_EXTRAS: OnboardingStep[] = [
  {
    key: 'brand_assets',
    title: 'Collect brand assets',
    description: 'Logo, colors, email signature — for branded outbound + dashboard skin.',
    owner: 'client',
    instructions: [
      'Email client: "Reply with (1) logo as SVG or PNG, (2) your 2 brand colors in hex, (3) a copy-paste email signature, (4) tone — formal / casual / punchy."',
      'Save files in Google Drive → Clients → {slug}.',
      'Paste tone + colors into "Build notes" on this page.',
    ],
  },
  {
    key: 'hubspot_connect',
    title: 'Connect HubSpot (or Pipedrive)',
    description: 'CRM becomes the source of truth.',
    owner: 'client',
    instructions: [
      'Client-facing steps (paste into email):',
      '  1. In HubSpot go to Settings → Integrations → Private Apps → Create private app.',
      '  2. Name it "Virtual Closer".',
      '  3. Scopes tab: check crm.objects.contacts.read, crm.objects.contacts.write, crm.objects.deals.read, crm.objects.deals.write.',
      '  4. Click Create. Copy the access token.',
      '  5. Reply with the token.',
      'Paste the token into "HubSpot private app token" on this page and save.',
      'Run: curl -H "Authorization: Bearer $CRON_SECRET" https://virtualcloser.com/api/cron/hot-leads — confirm CRM sync logs in agent_runs.',
    ],
  },
  {
    key: 'email_provider',
    title: 'Connect outbound email (Gmail / Outlook)',
    description: 'Approve = actually sends.',
    owner: 'client',
    instructions: [
      'Send client: https://{slug}.virtualcloser.com/settings/email',
      'They click "Connect Gmail" or "Connect Outlook" and authorize.',
      'On this page, confirm the Activity log shows "Email provider connected".',
      'Send yourself a test draft via the dashboard → Approve → confirm it arrives.',
    ],
  },
  {
    key: 'fathom_capture',
    title: 'Connect Fathom call capture',
    description: 'Call transcripts attached to deals.',
    owner: 'client',
    instructions: [
      'In Fathom → Integrations → Webhooks → Add webhook.',
      'URL: https://{slug}.virtualcloser.com/api/webhooks/fathom',
      'Events: meeting.summarized.',
      'Save. Have client record a 2-min test meeting to verify it lands in their dashboard.',
    ],
  },
  {
    key: 'custom_playbook',
    title: 'Tune classification prompts',
    description: 'Bake their voice into the AI.',
    owner: 'you',
    instructions: [
      'Open lib/claude.ts → REP_CONTEXT.',
      'Add a new case for "{id}" with: ICP, sales motion, top 3 objections (from the kickoff-call Fathom summary).',
      'Commit: "{slug}: tune playbook".',
      'Deploy. Re-run /api/cron/morning-scan and spot-check 3 drafts for tone.',
    ],
  },
]

// ---------------------------------------------------------------------------
// Executive extras
// ---------------------------------------------------------------------------
const EXECUTIVE_EXTRAS: OnboardingStep[] = [
  {
    key: 'dedicated_infra',
    title: 'Provision dedicated infra',
    description: 'Isolated data, own cron cadence.',
    owner: 'you',
    instructions: [
      'Create a new Supabase project named "vc-{slug}".',
      'Copy NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY into Vercel env, scoped to {slug}.virtualcloser.com preview only.',
      'Run supabase/schema.sql in the new project\'s SQL editor.',
      'Update reps.settings JSON on this tenant: {"dedicated":true,"project_ref":"..."}.',
    ],
  },
  {
    key: 'byok_claude',
    title: 'Client-owned Anthropic key',
    description: 'Cost + usage under their control.',
    owner: 'client',
    instructions: [
      'Client-facing: "Create an Anthropic account at https://console.anthropic.com, set a monthly spend limit, generate an API key, and reply with it."',
      'Paste into "Claude API key" on this page and save.',
    ],
  },
  {
    key: 'fathom_connect',
    title: 'Connect Fathom / Gong for team call intel',
    description: 'Powers momentum + health scoring.',
    owner: 'client',
    instructions: [
      'Fathom: Settings → API → create a read-only team token → reply with it.',
      '(Gong alternative: Settings → Integrations → API → Generate access key + secret.)',
      'Paste into "Build notes" on this page (format: FATHOM_API_KEY=... or GONG_KEY=.../GONG_SECRET=...).',
      'Add those env vars in Vercel scoped to this tenant and redeploy.',
    ],
  },
  {
    key: 'team_rollup',
    title: 'Configure team + manager hierarchy',
    description: 'Map their org so the rollup works.',
    owner: 'you',
    instructions: [
      'Get from client: CSV with columns team_name, manager_name, manager_email, rep_name, rep_email.',
      'In Supabase, insert into teams + team_members tables for rep_id = {id}.',
      'Assign revenue targets per team in reps.settings.team_targets JSON: {"East":600000,"West":480000,...}.',
      'Load https://{slug}.virtualcloser.com/dashboard — verify the Executive command center shows each team.',
    ],
  },
  {
    key: 'sla_doc',
    title: 'Sign SLA + DPA',
    description: 'Enterprise paperwork.',
    owner: 'you',
    instructions: [
      'Open PandaDoc → Templates → "VC Executive SLA + DPA".',
      'Fill: company = {display_name}, effective date = today, uptime = 99.5%.',
      'Send for signature to {email}.',
      'When signed, download PDF into Google Drive → Clients → {slug} → legal.',
    ],
  },
]

// ---------------------------------------------------------------------------
// Per-addon build steps — appended to tier steps on conversion
// ---------------------------------------------------------------------------
export const ADDON_STEPS: Partial<Record<AddonKey, OnboardingStep>> = {
  addon_ghl_crm: {
    key: 'addon_ghl_crm',
    title: 'Connect GoHighLevel CRM',
    description: 'Two-way pipeline sync + SMS + workflow enrollment.',
    owner: 'you',
    instructions: [
      'Ask client: GHL account → Settings → Business Profile → copy the Location ID.',
      'Ask client: GHL account → Settings → Private Integrations → create integration named "Virtual Closer" → copy the API key.',
      'On this page → Integrations → GoHighLevel: paste api_key + location_id → Save.',
      'Optional — inbound GHL webhooks: GHL → Settings → Webhooks → Add → URL: https://{slug}.virtualcloser.com/api/webhooks/ghl/{id} → events: ContactCreate, ContactUpdate, OpportunityCreate, OpportunityStatusChange, AppointmentCreate → copy the webhook secret → paste into "GHL webhook secret" in Integrations.',
      'Test: text the bot "move [lead name] to Proposal" → confirm the opportunity stage updates in GHL within ~5 seconds.',
      'Optional per-stage workflow enrollment: in GHL integration config, add stage_workflows JSON like {"Proposal":"workflow-id-123","Closed Won":"workflow-id-456"}.',
    ],
  },

  addon_hubspot_crm: {
    key: 'addon_hubspot_crm',
    title: 'Connect HubSpot CRM',
    description: 'Two-way deal + contact sync.',
    owner: 'you',
    instructions: [
      'Client-facing (paste into email to {email}):',
      '  1. HubSpot → Settings → Integrations → Private Apps → Create private app.',
      '  2. Name it "Virtual Closer".',
      '  3. Scopes: crm.objects.contacts.read/write, crm.objects.deals.read/write.',
      '  4. Click Create → copy the access token → reply with it.',
      'On this page → Integrations → HubSpot: paste token → Save.',
      'Test: create a test deal in HubSpot → confirm it appears in {slug}.virtualcloser.com/dashboard/pipeline within 60 seconds.',
    ],
  },

  addon_pipedrive_crm: {
    key: 'addon_pipedrive_crm',
    title: 'Connect Pipedrive CRM',
    description: 'Two-way deal + contact sync.',
    owner: 'you',
    instructions: [
      'Client-facing:',
      '  1. Pipedrive → avatar (top right) → Personal preferences → API → copy Personal API token.',
      '  2. Reply with the token.',
      'On this page → Integrations → Pipedrive: paste api_key → Save.',
      'Test: move a deal stage via Telegram bot → confirm the Pipedrive deal stage updates.',
    ],
  },

  addon_salesforce_crm: {
    key: 'addon_salesforce_crm',
    title: 'Connect Salesforce CRM',
    description: 'Bi-directional opportunity + contact sync with custom field mapping.',
    owner: 'you',
    instructions: [
      'Ask client for: Salesforce org URL, Connected App consumer_key + consumer_secret, username + password + security_token.',
      'On this page → Integrations → Salesforce: fill all five fields → Save.',
      'Confirm the custom field mapping matches their Opportunity schema — ask client for a screenshot of their Opportunity page layout.',
      'Map any non-standard fields in lib/crm-sync.ts → salesforceFieldMap for this rep.',
      'Deploy. Test: create a lead in VC, move to Proposal → confirm Salesforce opportunity stage changes.',
    ],
  },

  addon_dialer_lite: {
    key: 'addon_dialer_lite',
    title: 'Set up AI dialer (Lite — 100 appts/mo)',
    description: 'Confirm bot calls every appointment 30–60 min before it starts.',
    owner: 'you',
    instructions: [
      'On this page → Integrations → Vapi: paste client Vapi API key (leave blank to use platform key).',
      'Click "Re-provision Vapi" — creates a confirmation assistant + phone number for {display_name}.',
      'Confirm vapi.confirm_assistant_id and vapi.phone_number_id are set (green in checklist below).',
      'Client must upload at least one training doc: {slug}.virtualcloser.com/dashboard → Settings → Training docs.',
      'Test: book a Cal.com event 10 min from now → wait for outbound call → press 1 → confirm lead flips to "confirmed" in pipeline.',
      'Cap: 100 appts/month. Monitor at /admin/billing.',
    ],
  },

  addon_dialer_pro: {
    key: 'addon_dialer_pro',
    title: 'Set up AI dialer (Pro — 300 appts/mo)',
    description: 'Same as Lite — cap raised to 300 appts/month.',
    owner: 'you',
    instructions: [
      'On this page → Integrations → Vapi: paste client Vapi API key (leave blank to use platform key).',
      'Click "Re-provision Vapi" — creates a confirmation assistant + phone number for {display_name}.',
      'Confirm vapi.confirm_assistant_id and vapi.phone_number_id are set (green in checklist below).',
      'Client uploads training docs at {slug}.virtualcloser.com/dashboard → Settings → Training docs.',
      'Test: book a Cal.com event 10 min from now → wait for outbound call → press 1 → confirm lead flips to confirmed.',
      'Cap: 300 appts/month. Monitor at /admin/billing.',
    ],
  },

  addon_roleplay_lite: {
    key: 'addon_roleplay_lite',
    title: 'Author roleplay scenarios (Lite — 300 min/mo)',
    description: 'Create at least one scenario so client can run sessions immediately.',
    owner: 'you',
    instructions: [
      'On {slug}.virtualcloser.com/dashboard/roleplay → "New scenario".',
      'Write the persona brief: who is the AI playing, what stage in the sales cycle, what objections to throw.',
      'Example: "You are a skeptical VP of Sales. Lead with budget objection, then ROI challenge."',
      'Set difficulty (Easy/Medium/Hard). Save.',
      'Run a 2-min test session yourself — confirm voice quality and persona.',
      'Create 2–3 scenarios covering the top objections from kickoff call notes.',
      'Cap: 300 min/month shared org-wide. Monitor at /admin/billing.',
    ],
  },

  addon_roleplay_pro: {
    key: 'addon_roleplay_pro',
    title: 'Author roleplay scenarios (Pro — 1,000 min/mo)',
    description: 'Same as Lite — cap raised to 1,000 min/month.',
    owner: 'you',
    instructions: [
      'On {slug}.virtualcloser.com/dashboard/roleplay → "New scenario".',
      'Create at least 3 scenarios covering top objections from kickoff notes.',
      'Run a test session. Confirm voice quality and scoring.',
      'Cap: 1,000 min/month shared org-wide. Monitor at /admin/billing.',
    ],
  },

  addon_wavv_kpi: {
    key: 'addon_wavv_kpi',
    title: 'Configure WAVV KPI ingest',
    description: 'Wire WAVV webhook so every disposition lands on the dashboard.',
    owner: 'you',
    instructions: [
      'Give client the inbound URL: https://{slug}.virtualcloser.com/api/webhooks/wavv/{id}',
      'Client: WAVV admin → Settings → Integrations → Webhooks → paste URL → copy the webhook secret.',
      'On this page → Integrations → WAVV: paste webhook_secret → Save.',
      'Test: client makes 1 test dial in WAVV → confirm a KPI row appears in their dashboard within 30 seconds.',
    ],
  },

  addon_team_leaderboard: {
    key: 'addon_team_leaderboard',
    title: 'Set up team + leaderboard',
    description: 'Add members, assign roles, configure revenue targets.',
    owner: 'you',
    instructions: [
      'Get from client: list of team members with name, email, role (owner/manager/rep).',
      'On this page → Members & teams → "Add member" for each person.',
      'Set each member\'s role: owner (full access), manager (team view), rep (self only).',
      'Ask client for monthly revenue target per rep. Set in each member\'s profile.',
      'Visit {slug}.virtualcloser.com/dashboard/team — confirm leaderboard renders with all reps.',
    ],
  },

  addon_white_label: {
    key: 'addon_white_label',
    title: 'Configure white label (custom domain + branding)',
    description: 'Client\'s own domain, logo, and brand colors.',
    owner: 'you',
    instructions: [
      'Get from client: desired domain (e.g. app.theircompany.com), logo SVG/PNG, primary hex color.',
      'Vercel → virtualcloser project → Settings → Domains → add their custom domain → follow DNS instructions.',
      'DNS propagates in 5–30 min. Confirm https://app.theircompany.com loads the login page.',
      'Upload logo: place in public/logos/{slug}.png. Set NEXT_PUBLIC_LOGO_URL env var in Vercel scoped to this domain.',
      'Set NEXT_PUBLIC_BRAND_COLOR=#hexvalue in Vercel env for this domain. Redeploy.',
      'Update reps row settings: white_label = {"domain":"app.theircompany.com","logo":"/logos/{slug}.svg","color":"#hex"}.',
      'Confirm logo + color render at their custom domain.',
    ],
  },

  addon_bluebubbles: {
    key: 'addon_bluebubbles',
    title: 'Set up BlueBubbles iMessage relay',
    description: 'Client\'s Mac sends/receives iMessage through Virtual Closer.',
    owner: 'client',
    instructions: [
      'Client must have a Mac that stays on (Mac mini works great).',
      'Client installs BlueBubbles server: https://bluebubbles.app/install',
      'BlueBubbles server → Settings → copy Server URL and Password.',
      'On this page → Integrations → BlueBubbles: paste server_url + password → Save.',
      'Test: text the Telegram bot "iMessage [phone number]: Hey, just following up" → confirm it delivers as a real iMessage.',
      'Mac must stay awake: System Settings → Battery → Never sleep.',
    ],
  },

  addon_fathom: {
    key: 'addon_fathom',
    title: 'Connect Fathom call intelligence',
    description: 'Every recorded call auto-imports action items and updates deals.',
    owner: 'client',
    instructions: [
      'Client-facing steps:',
      '  1. Fathom → Settings → Integrations → Webhooks → Add webhook.',
      '  2. URL: https://{slug}.virtualcloser.com/api/webhooks/fathom',
      '  3. Events: meeting.summarized → Save.',
      'Client records a 2-min test meeting → confirm a brain item appears on {slug}.virtualcloser.com/brain within 2 minutes.',
      'If webhook isn\'t firing: Fathom → Settings → Integrations → Webhooks → check the delivery log.',
    ],
  },
}

export function defaultOnboardingSteps(
  tier: Tenant['tier'] | string,
  selectedAddons?: AddonKey[],
): OnboardingStep[] {
  const base = SHARED_STEPS.map((s) => ({ ...s, done: false, done_at: null }))

  let tierSteps: OnboardingStep[]
  if (tier === 'team_builder')
    tierSteps = [...base, ...TEAM_BUILDER_EXTRAS.map((s) => ({ ...s, done: false, done_at: null }))]
  else if (tier === 'executive')
    tierSteps = [
      ...base,
      ...TEAM_BUILDER_EXTRAS.map((s) => ({ ...s, done: false, done_at: null })),
      ...EXECUTIVE_EXTRAS.map((s) => ({ ...s, done: false, done_at: null })),
    ]
  else
    tierSteps = base

  if (!selectedAddons || selectedAddons.length === 0) return tierSteps

  const addonSteps = selectedAddons
    .filter((k) => k !== 'base_build' && ADDON_STEPS[k])
    .map((k) => ({ ...ADDON_STEPS[k]!, done: false, done_at: null }))

  return [...tierSteps, ...addonSteps]
}

export const TIER_INFO: Record<
  'salesperson' | 'team_builder' | 'executive',
  { label: string; monthly: number; build: [number, number]; description: string }
> = {
  salesperson: {
    label: 'Salesperson',
    monthly: 50,
    build: [2000, 2000],
    description:
      'A voice-first personal CRM for one closer. Talk to it like Jarvis — set targets, create tasks, mark no-shows, log calls, text it from Telegram. Your calendar, pipeline, and brain, in one place.',
  },
  team_builder: {
    label: 'Team Builder',
    monthly: 150,
    build: [5000, 5000],
    description:
      'Everything in Salesperson + real CRM sync (HubSpot / Pipedrive), outbound email, call transcript capture, and playbook tuning. For closers running a pipeline who want cleaner data and more signal.',
  },
  executive: {
    label: 'Executive',
    monthly: 400,
    build: [10000, 10000],
    description:
      'A command center for running teams. Revenue + momentum rollups, per-team health, manager and rep scorecards, fulfillment-partner oversight, call-intelligence (Fathom / Gong) tied to deal velocity. Dedicated infra, BYOK, SLA.',
  },
}

/**
 * Expand {placeholders} in onboarding-step text using fields from the tenant row.
 * Called per-step on the admin detail page so every instruction shows a
 * client-specific value (slug, email, fees, etc.) — no mental substitution.
 */
export function fillInstructions(
  text: string,
  tenant: {
    id: string
    slug: string
    display_name: string
    email: string | null
    monthly_fee: number | string | null
    build_fee: number | string | null
  },
): string {
  return text
    .replaceAll('{id}', tenant.id)
    .replaceAll('{slug}', tenant.slug)
    .replaceAll('{display_name}', tenant.display_name)
    .replaceAll('{email}', tenant.email ?? '—')
    .replaceAll('{monthly_fee}', String(tenant.monthly_fee ?? ''))
    .replaceAll('{build_fee}', String(tenant.build_fee ?? ''))
}
