import type { Tenant } from './tenant'

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
    key: 'brand_assets',
    title: 'Collect brand assets',
    description: 'Logo, colors, email signature.',
    owner: 'client',
    instructions: [
      'Email client: "Reply with (1) logo as SVG or PNG, (2) your 2 brand colors in hex, (3) a copy-paste email signature, (4) tone — formal / casual / punchy."',
      'Save files in Google Drive → Clients → {slug}.',
      'Paste tone + colors into "Build notes" on this page.',
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

export function defaultOnboardingSteps(tier: Tenant['tier'] | string): OnboardingStep[] {
  const base = SHARED_STEPS.map((s) => ({ ...s, done: false, done_at: null }))
  if (tier === 'team_builder')
    return [...base, ...TEAM_BUILDER_EXTRAS.map((s) => ({ ...s, done: false, done_at: null }))]
  if (tier === 'executive')
    return [
      ...base,
      ...TEAM_BUILDER_EXTRAS.map((s) => ({ ...s, done: false, done_at: null })),
      ...EXECUTIVE_EXTRAS.map((s) => ({ ...s, done: false, done_at: null })),
    ]
  return base
}

export const TIER_INFO: Record<
  'salesperson' | 'team_builder' | 'executive',
  { label: string; monthly: number; build: [number, number]; description: string }
> = {
  salesperson: {
    label: 'Salesperson',
    monthly: 50,
    build: [1500, 2500],
    description:
      'A voice-first personal CRM for one closer. Talk to it like Jarvis — set targets, create tasks, mark no-shows, log calls, text it from Telegram. Your calendar, pipeline, and brain, in one place.',
  },
  team_builder: {
    label: 'Team Builder',
    monthly: 150,
    build: [3500, 5000],
    description:
      'Everything in Salesperson + real CRM sync (HubSpot / Pipedrive), outbound email, call transcript capture, and playbook tuning. For closers running a pipeline who want cleaner data and more signal.',
  },
  executive: {
    label: 'Executive',
    monthly: 400,
    build: [8000, 15000],
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
