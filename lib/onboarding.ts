import type { Tenant } from './tenant'

export type OnboardingStep = {
  key: string
  title: string
  description: string
  owner: 'you' | 'client'
  done?: boolean
  done_at?: string | null
}

const SHARED_STEPS: OnboardingStep[] = [
  {
    key: 'kickoff_call',
    title: 'Kickoff call (30 min)',
    description:
      'Confirm goals, list their current pipeline tools, and identify the top 3 pains the AI should solve first.',
    owner: 'you',
  },
  {
    key: 'create_rep_row',
    title: 'Create Supabase tenant row',
    description:
      "INSERT INTO reps (id, slug, display_name, tier, email, monthly_fee). The slug becomes <slug>.virtualcloser.com.",
    owner: 'you',
  },
  {
    key: 'add_subdomain',
    title: 'Add subdomain in Vercel',
    description:
      'Vercel → Project → Domains → add <slug>.virtualcloser.com. Wildcard DNS already routes it.',
    owner: 'you',
  },
  {
    key: 'brand_assets',
    title: 'Collect brand assets',
    description:
      'Logo (SVG or PNG), brand colors, signature block for outbound email, and preferred tone (formal / casual / punchy).',
    owner: 'client',
  },
  {
    key: 'lead_import',
    title: 'Import current leads',
    description:
      'Client exports leads from their current CRM as CSV (name, email, company, last_contact, notes). You import into Supabase.',
    owner: 'client',
  },
  {
    key: 'slack_webhook',
    title: 'Slack incoming webhook',
    description:
      "Client creates a Slack incoming webhook pointed at their #sales channel and sends you the URL. Paste into reps.slack_webhook.",
    owner: 'client',
  },
  {
    key: 'test_run',
    title: 'Run /api/cron/morning-scan manually',
    description:
      'Trigger the cron with the CRON_SECRET header, verify drafts appear in /dashboard and the Slack briefing fires.',
    owner: 'you',
  },
  {
    key: 'dashboard_walkthrough',
    title: 'Dashboard walkthrough with client',
    description:
      'Record a 10-min Loom showing approve/dismiss flow and the /brain page, send to client.',
    owner: 'you',
  },
  {
    key: 'billing_setup',
    title: 'Set up recurring billing',
    description:
      'Create Stripe subscription for monthly_fee and invoice for build_fee (one-time).',
    owner: 'you',
  },
]

const PRO_EXTRAS: OnboardingStep[] = [
  {
    key: 'hubspot_connect',
    title: 'HubSpot / CRM integration',
    description:
      'Client generates a HubSpot private-app token with contacts.read + contacts.write. Paste into reps.hubspot_token.',
    owner: 'client',
  },
  {
    key: 'email_provider',
    title: 'Connect outbound email provider',
    description:
      'Gmail / Outlook OAuth or SMTP credentials so Approve actually sends the email (not just marks it sent).',
    owner: 'client',
  },
  {
    key: 'custom_playbook',
    title: 'Tune classification prompts',
    description:
      "Update lib/claude.ts REP_CONTEXT per client: their ICP, sales motion, top objections. Commit with their slug in the notes.",
    owner: 'you',
  },
]

const SPACE_STATION_EXTRAS: OnboardingStep[] = [
  {
    key: 'dedicated_infra',
    title: 'Provision dedicated Mac Mini / server',
    description:
      'Enterprise tier gets its own infra for compliance + capacity. Install n8n, configure workflows, point DNS.',
    owner: 'you',
  },
  {
    key: 'byok_claude',
    title: 'Client-owned Anthropic key',
    description:
      'Client creates their own Anthropic account, sets a spend limit, and shares the API key. Paste into reps.claude_api_key.',
    owner: 'client',
  },
  {
    key: 'custom_workflows',
    title: 'Build custom n8n workflows',
    description:
      'Map their full sales flow (calls, meetings, proposals, signed contracts) into n8n nodes with approval gates.',
    owner: 'you',
  },
  {
    key: 'sla_doc',
    title: 'Sign SLA + data processing addendum',
    description:
      'Enterprise clients get an uptime SLA (99.5%) and a DPA. Pull template from /legal/ and send via PandaDoc.',
    owner: 'you',
  },
]

export function defaultOnboardingSteps(tier: Tenant['tier'] | string): OnboardingStep[] {
  const base = SHARED_STEPS.map((s) => ({ ...s, done: false, done_at: null }))
  if (tier === 'pro') return [...base, ...PRO_EXTRAS.map((s) => ({ ...s, done: false, done_at: null }))]
  if (tier === 'space_station')
    return [
      ...base,
      ...PRO_EXTRAS.map((s) => ({ ...s, done: false, done_at: null })),
      ...SPACE_STATION_EXTRAS.map((s) => ({ ...s, done: false, done_at: null })),
    ]
  return base
}

export const TIER_INFO: Record<
  'starter' | 'pro' | 'space_station',
  { label: string; monthly: number; build: [number, number]; description: string }
> = {
  starter: {
    label: 'Starter',
    monthly: 50,
    build: [1500, 2500],
    description:
      'Dashboard + brain-dump + daily AI scans. Slack briefings. Hosted by us. Best for solo reps.',
  },
  pro: {
    label: 'Pro',
    monthly: 150,
    build: [3500, 5000],
    description:
      'Everything in Starter + CRM sync (HubSpot/Pipedrive) + outbound email sending + custom classification playbook.',
  },
  space_station: {
    label: 'Space Station',
    monthly: 400,
    build: [8000, 15000],
    description:
      'Enterprise: dedicated infra, n8n automations, BYOK Anthropic, custom workflows, SLA + DPA.',
  },
}
