// Pipeline / Kanban model.
//
// A single deals pipeline anchored on the prospects table. Stages flow
// left → right on the board:
//
//   lead → call_booked → plan_generated → quote_sent → payment_made
//        → kickoff_scheduled → building → active
//
// Plus a `lost` lane (out-of-band, off the main flow).
//
// Stages auto-advance on key system events (Fathom plan generated, build
// fee paid, sub activated). Admin can manually drag any deal to any
// stage at any time — manual moves take priority and stick.

import { supabase } from '@/lib/supabase'

export const STAGE_ORDER = [
  'lead',
  'call_booked',
  'plan_generated',
  'quote_sent',
  'payment_made',
  'kickoff_scheduled',
  'building',
  'active',
] as const

export type PipelineStage = (typeof STAGE_ORDER)[number] | 'lost'

export const STAGE_LABEL: Record<PipelineStage, string> = {
  lead: 'Lead',
  call_booked: 'Call booked',
  plan_generated: 'Plan generated',
  quote_sent: 'Quote sent',
  payment_made: 'Payment made',
  kickoff_scheduled: 'Kickoff scheduled',
  building: 'Building',
  active: 'Active',
  lost: 'Lost',
}

export const STAGE_TONE: Record<PipelineStage, { bg: string; bd: string; fg: string; accent: string }> = {
  lead:              { bg: '#f3f4f6', bd: '#d1d5db', fg: '#374151', accent: '#9ca3af' },
  call_booked:       { bg: '#eff6ff', bd: '#93c5fd', fg: '#1e3a8a', accent: '#3b82f6' },
  plan_generated:    { bg: '#f5f3ff', bd: '#c4b5fd', fg: '#5b21b6', accent: '#8b5cf6' },
  quote_sent:        { bg: '#fef3c7', bd: '#fbbf24', fg: '#78350f', accent: '#f59e0b' },
  payment_made:      { bg: '#fff5f3', bd: '#ff2800', fg: '#9a1500', accent: '#ff2800' },
  kickoff_scheduled: { bg: '#fce7f3', bd: '#f472b6', fg: '#831843', accent: '#ec4899' },
  building:          { bg: '#fff7ed', bd: '#fb923c', fg: '#7c2d12', accent: '#f97316' },
  active:            { bg: '#ecfdf5', bd: '#16a34a', fg: '#065f46', accent: '#16a34a' },
  lost:              { bg: '#fee2e2', bd: '#dc2626', fg: '#7f1d1d', accent: '#dc2626' },
}

/** Auto-advance a prospect to the given stage. Idempotent — only updates
 *  if the new stage is "later" than the current OR explicitly forced.
 *  Called from system events (Fathom plan, payment, activation). */
export async function autoAdvanceStage(args: {
  prospectId: string
  targetStage: PipelineStage
  /** When true, always overwrite. Otherwise only advance forward. */
  force?: boolean
}): Promise<void> {
  if (!args.prospectId) return
  const { data: cur } = await supabase
    .from('prospects')
    .select('pipeline_stage')
    .eq('id', args.prospectId)
    .maybeSingle()
  if (!cur) return
  const currentStage = (cur.pipeline_stage as PipelineStage | null) ?? 'lead'
  if (!args.force && stageRank(args.targetStage) <= stageRank(currentStage)) return
  await supabase
    .from('prospects')
    .update({ pipeline_stage: args.targetStage })
    .eq('id', args.prospectId)
}

function stageRank(s: PipelineStage): number {
  const idx = STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number])
  if (idx >= 0) return idx
  if (s === 'lost') return -1
  return -2
}

/** Same logic but matches by rep_id (used by activate-subscription which
 *  doesn't carry the prospect_id around). */
export async function autoAdvanceStageByRep(args: {
  repId: string
  targetStage: PipelineStage
  force?: boolean
}): Promise<void> {
  const { data } = await supabase
    .from('prospects')
    .select('id')
    .eq('rep_id', args.repId)
    .maybeSingle()
  if (!data?.id) return
  await autoAdvanceStage({ prospectId: (data.id as string), targetStage: args.targetStage, force: args.force })
}
