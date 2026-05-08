/**
 * Campaign templates — define the multi-step sequence of actions the
 * orchestrator executes for each lead. Each step specifies:
 *
 *  action       — what to do: 'sms' | 'call' | 'email'
 *  delay_min    — minutes to wait AFTER the PREVIOUS step fires
 *                 (step 0 fires immediately on campaign start)
 *  sms_script   — which AiSalesperson.sms_scripts key to use
 *  stop_on_outcome — outcomes that should immediately cancel the campaign
 *
 * Stop dispositions are global across all templates — if a lead is marked
 * do_not_contact / not_interested / appointment_set the campaign halts
 * regardless of which step it's on.
 */

export type CampaignAction = 'sms' | 'call' | 'email'

export type CampaignStep = {
  step: number           // 1-indexed
  action: CampaignAction
  delay_min: number      // wait after previous step before firing this one
  sms_script?: string    // key in AiSalesperson.sms_scripts
  label?: string         // human-readable label for the log
}

export type CampaignTemplate = {
  key: string
  name: string
  steps: CampaignStep[]
  /** Lead dispositions that immediately stop the campaign. */
  stop_dispositions: string[]
  /** Lead dispositions that count as successful conversion. */
  success_dispositions: string[]
  /** Days before a fully-idle campaign is auto-archived. */
  expire_days: number
}

// ── Shared stop rules ─────────────────────────────────────────────────────

const UNIVERSAL_STOP = [
  'do_not_contact',
  'not_interested',
  'wrong_number',
  'disconnected',
  'disqualified',
]

const UNIVERSAL_SUCCESS = [
  'appointment_set',
  'second_call_booked',
  'third_call_booked',
  'application_sent',
  'application_approved',
]

// ── Health Insurance SDR ──────────────────────────────────────────────────

export const HEALTH_INSURANCE_CAMPAIGN: CampaignTemplate = {
  key: 'health_insurance',
  name: 'Health Insurance SDR — Rachel (7-Touch)',
  expire_days: 30,
  stop_dispositions: UNIVERSAL_STOP,
  success_dispositions: UNIVERSAL_SUCCESS,
  steps: [
    {
      step: 1,
      action: 'sms',
      delay_min: 0,
      sms_script: 'first',
      label: 'Day 0 — First SMS touch',
    },
    {
      step: 2,
      action: 'call',
      delay_min: 90,            // 90 min after SMS: AI dial attempt 1
      label: 'Day 0 — AI dial #1 (after first SMS)',
    },
    {
      step: 3,
      action: 'sms',
      delay_min: 1440,          // +24h: second SMS
      sms_script: 'second',
      label: 'Day 1 — Second SMS',
    },
    {
      step: 4,
      action: 'call',
      delay_min: 120,           // 2h after second SMS: AI dial attempt 2
      label: 'Day 1 — AI dial #2',
    },
    {
      step: 5,
      action: 'sms',
      delay_min: 2880,          // +48h: followup SMS
      sms_script: 'followup',
      label: 'Day 3 — Follow-up SMS',
    },
    {
      step: 6,
      action: 'call',
      delay_min: 2880,          // +48h: AI dial attempt 3
      label: 'Day 5 — AI dial #3',
    },
    {
      step: 7,
      action: 'sms',
      delay_min: 2880,          // +48h: final SMS
      sms_script: 'no_response',
      label: 'Day 7 — Final SMS',
    },
  ],
}

// ── Mortgage Protection SDR ───────────────────────────────────────────────

export const MORTGAGE_PROTECTION_CAMPAIGN: CampaignTemplate = {
  key: 'mortgage_protection',
  name: 'Mortgage Protection SDR (7-Touch)',
  expire_days: 30,
  stop_dispositions: UNIVERSAL_STOP,
  success_dispositions: UNIVERSAL_SUCCESS,
  steps: [
    { step: 1, action: 'sms',  delay_min: 0,    sms_script: 'first',       label: 'Day 0 — First SMS' },
    { step: 2, action: 'call', delay_min: 90,                               label: 'Day 0 — AI dial #1' },
    { step: 3, action: 'sms',  delay_min: 1440, sms_script: 'second',      label: 'Day 1 — Second SMS' },
    { step: 4, action: 'call', delay_min: 120,                              label: 'Day 1 — AI dial #2' },
    { step: 5, action: 'sms',  delay_min: 2880, sms_script: 'followup',    label: 'Day 3 — Follow-up SMS' },
    { step: 6, action: 'call', delay_min: 2880,                             label: 'Day 5 — AI dial #3' },
    { step: 7, action: 'sms',  delay_min: 2880, sms_script: 'no_response', label: 'Day 7 — Final SMS' },
  ],
}

// ── Registry ──────────────────────────────────────────────────────────────

export const CAMPAIGN_TEMPLATES: Record<string, CampaignTemplate> = {
  health_insurance: HEALTH_INSURANCE_CAMPAIGN,
  mortgage_protection: MORTGAGE_PROTECTION_CAMPAIGN,
}

export function getTemplate(key: string): CampaignTemplate | null {
  return CAMPAIGN_TEMPLATES[key] ?? null
}
