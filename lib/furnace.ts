import { supabase } from './supabase'
import type { Disposition } from '@/types'

export type FurnaceConfig = {
  enabled: boolean
  client_id?: string
}

export async function getFurnaceConfig(repId: string): Promise<FurnaceConfig | null> {
  const { data } = await supabase
    .from('reps')
    .select('settings')
    .eq('id', repId)
    .maybeSingle()
  const settings = (data?.settings as Record<string, unknown> | null) ?? {}
  const cfg = settings.furnace as FurnaceConfig | undefined
  if (!cfg?.enabled) return null
  return cfg
}

// Maps VC canonical stage → Furnace disposition
const STAGE_TO_FURNACE: Record<string, Disposition> = {
  'Appointment Set':     'appointment_set',
  'Follow-Up Scheduled': 'callback',
  'Disqualified':        'disqualified',
  'Engaged':             'interested',
  'Opted Out':           'do_not_contact',
  'Needs Human Review':  'callback',
}

// Maps raw call outcome → Furnace disposition (for outcomes that don't produce a stage)
const OUTCOME_TO_FURNACE: Record<string, Disposition> = {
  'no_answer':            'no_answer',
  'voicemail':            'left_voicemail',
  'confirmed':            'appointment_set',
  'connected':            'interested',
  'cancelled':            'disqualified',
  'reschedule_requested': 'reschedule',
}

export function mapStageToFurnaceDisposition(stage: string): Disposition | null {
  return STAGE_TO_FURNACE[stage] ?? null
}

export function mapOutcomeToFurnaceDisposition(outcome: string): Disposition | null {
  return OUTCOME_TO_FURNACE[outcome] ?? null
}

async function pushToFurnace(args: {
  furnaceLeadId: string
  disposition: Disposition
  repId: string
  vcLeadId?: string | null
}): Promise<void> {
  const secret = process.env.LEADS_WEBHOOK_SECRET
  const url = process.env.FURNACE_SYNC_URL ?? 'https://www.furnaceleads.com/api/vc/sync'
  if (!secret) {
    console.warn('[furnace] LEADS_WEBHOOK_SECRET not set — skipping disposition push')
    return
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': secret },
    body: JSON.stringify({
      furnace_lead_id: args.furnaceLeadId,
      vc_lead_id: args.vcLeadId ?? undefined,
      disposition: args.disposition,
      rep_id: args.repId,
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`furnace_sync_failed:${res.status}:${text}`)
  }
}

/**
 * Looks up the lead's furnace_lead_id (source='furnace', external_id set),
 * checks the client is a Furnace client, and pushes the disposition.
 * Safe to fire-and-forget — logs errors, never throws.
 */
export async function pushLeadDispositionToFurnace(
  repId: string,
  leadId: string,
  disposition: Disposition,
): Promise<void> {
  try {
    const config = await getFurnaceConfig(repId)
    if (!config) return // not a Furnace client — skip silently

    const { data: lead } = await supabase
      .from('leads')
      .select('external_id, source')
      .eq('id', leadId)
      .eq('rep_id', repId)
      .maybeSingle()

    // Only push Furnace-originated leads (source='furnace' + external_id set)
    const furnaceLeadId =
      lead?.source === 'furnace' ? (lead?.external_id as string | null) : null
    if (!furnaceLeadId) return

    await pushToFurnace({ furnaceLeadId, disposition, repId, vcLeadId: leadId })
  } catch (err) {
    console.error('[furnace] pushLeadDispositionToFurnace failed', err)
  }
}
