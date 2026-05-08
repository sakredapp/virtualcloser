/**
 * Local Presence — picks the best caller ID from the number pool based on
 * the lead's area code. "Neighbor dialing" significantly improves answer rates
 * because the caller ID shows a local number instead of a toll-free or
 * out-of-state number.
 *
 * Numbers are stored in local_presence_numbers table.
 * To import the 79 Telnyx numbers: POST /api/admin/local-presence/import
 * with the list of E.164 numbers.
 */

import { supabase } from '@/lib/supabase'

type PresenceNumber = {
  id: string
  e164: string
  area_code: string
  state: string | null
  trunk_sid: string | null
}

/**
 * Given a lead's phone number, returns the best matching local presence
 * number from the pool for this rep.
 *
 * Matching priority:
 *   1. Exact area code match (same NXX)
 *   2. Same state (any number in the state)
 *   3. Any active number (round-robin by last_used_at)
 */
export async function pickLocalNumber(
  repId: string,
  leadPhone: string,
): Promise<PresenceNumber | null> {
  const areaCode = extractAreaCode(leadPhone)
  if (!areaCode) return null

  // 1. Exact area code match
  const { data: exact } = await supabase
    .from('local_presence_numbers')
    .select('id, e164, area_code, state, trunk_sid')
    .eq('rep_id', repId)
    .eq('active', true)
    .eq('area_code', areaCode)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()

  if (exact) {
    void touchNumber(exact.id)
    return exact as PresenceNumber
  }

  // 2. Same state — need to look up state from area code
  const state = AREA_CODE_TO_STATE[areaCode]
  if (state) {
    const { data: sameState } = await supabase
      .from('local_presence_numbers')
      .select('id, e164, area_code, state, trunk_sid')
      .eq('rep_id', repId)
      .eq('active', true)
      .eq('state', state)
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle()

    if (sameState) {
      void touchNumber(sameState.id)
      return sameState as PresenceNumber
    }
  }

  // 3. Any active number, least recently used
  const { data: any } = await supabase
    .from('local_presence_numbers')
    .select('id, e164, area_code, state, trunk_sid')
    .eq('rep_id', repId)
    .eq('active', true)
    .order('last_used_at', { ascending: true, nullsFirst: true })
    .limit(1)
    .maybeSingle()

  if (any) {
    void touchNumber(any.id)
    return any as PresenceNumber
  }

  return null
}

async function touchNumber(id: string): Promise<void> {
  await supabase
    .from('local_presence_numbers')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', id)
}

export function extractAreaCode(e164: string): string | null {
  // +1NXXNXXXXXX → NXX
  const digits = e164.replace(/\D/g, '')
  if (digits.startsWith('1') && digits.length === 11) return digits.slice(1, 4)
  if (digits.length === 10) return digits.slice(0, 3)
  return null
}

// ── Bulk import helper ────────────────────────────────────────────────────

export async function importLocalNumbers(
  repId: string,
  numbers: { e164: string; trunk_sid?: string; provider?: string }[],
): Promise<{ imported: number; skipped: number }> {
  const rows = numbers.map((n) => {
    const areaCode = extractAreaCode(n.e164) ?? ''
    return {
      rep_id: repId,
      e164: n.e164,
      area_code: areaCode,
      state: AREA_CODE_TO_STATE[areaCode] ?? null,
      provider: n.provider ?? 'telnyx',
      trunk_sid: n.trunk_sid ?? null,
    }
  })

  const { data, error } = await supabase
    .from('local_presence_numbers')
    .upsert(rows, { onConflict: 'rep_id,e164', ignoreDuplicates: true })
    .select('id')

  if (error) throw new Error(error.message)
  return { imported: data?.length ?? 0, skipped: numbers.length - (data?.length ?? 0) }
}

// ── US area code → state lookup (major codes only) ────────────────────────
// Abbreviated — covers the states most likely used in health insurance.
// Full dataset can be loaded from a CSV if needed.

const AREA_CODE_TO_STATE: Record<string, string> = {
  // Alabama
  '205': 'AL', '251': 'AL', '256': 'AL', '334': 'AL', '938': 'AL',
  // Arizona
  '480': 'AZ', '520': 'AZ', '602': 'AZ', '623': 'AZ', '928': 'AZ',
  // California
  '209': 'CA', '213': 'CA', '310': 'CA', '323': 'CA', '408': 'CA',
  '415': 'CA', '424': 'CA', '442': 'CA', '510': 'CA', '530': 'CA',
  '559': 'CA', '562': 'CA', '619': 'CA', '626': 'CA', '628': 'CA',
  '650': 'CA', '657': 'CA', '661': 'CA', '669': 'CA', '707': 'CA',
  '714': 'CA', '747': 'CA', '760': 'CA', '805': 'CA', '818': 'CA',
  '831': 'CA', '858': 'CA', '909': 'CA', '916': 'CA', '925': 'CA',
  '949': 'CA', '951': 'CA',
  // Florida
  '239': 'FL', '305': 'FL', '321': 'FL', '352': 'FL', '386': 'FL',
  '407': 'FL', '561': 'FL', '727': 'FL', '754': 'FL', '772': 'FL',
  '786': 'FL', '813': 'FL', '850': 'FL', '863': 'FL', '904': 'FL',
  '941': 'FL', '954': 'FL',
  // Georgia
  '229': 'GA', '404': 'GA', '470': 'GA', '478': 'GA', '678': 'GA',
  '706': 'GA', '762': 'GA', '770': 'GA', '912': 'GA',
  // Illinois
  '217': 'IL', '224': 'IL', '309': 'IL', '312': 'IL', '331': 'IL',
  '618': 'IL', '630': 'IL', '708': 'IL', '773': 'IL', '779': 'IL',
  '815': 'IL', '847': 'IL', '872': 'IL',
  // Michigan
  '231': 'MI', '248': 'MI', '269': 'MI', '313': 'MI', '517': 'MI',
  '586': 'MI', '616': 'MI', '734': 'MI', '810': 'MI', '906': 'MI',
  '947': 'MI', '989': 'MI',
  // New York
  '212': 'NY', '315': 'NY', '347': 'NY', '516': 'NY', '518': 'NY',
  '585': 'NY', '607': 'NY', '631': 'NY', '646': 'NY', '716': 'NY',
  '718': 'NY', '845': 'NY', '914': 'NY', '917': 'NY', '929': 'NY',
  '934': 'NY',
  // North Carolina
  '252': 'NC', '336': 'NC', '704': 'NC', '743': 'NC', '828': 'NC',
  '910': 'NC', '919': 'NC', '980': 'NC', '984': 'NC',
  // Ohio
  '216': 'OH', '234': 'OH', '330': 'OH', '380': 'OH', '419': 'OH',
  '440': 'OH', '513': 'OH', '567': 'OH', '614': 'OH', '740': 'OH',
  '937': 'OH',
  // Pennsylvania
  '215': 'PA', '223': 'PA', '267': 'PA', '272': 'PA', '412': 'PA',
  '445': 'PA', '484': 'PA', '570': 'PA', '610': 'PA', '717': 'PA',
  '724': 'PA', '814': 'PA', '878': 'PA',
  // Texas
  '210': 'TX', '214': 'TX', '254': 'TX', '281': 'TX', '325': 'TX',
  '346': 'TX', '361': 'TX', '409': 'TX', '430': 'TX', '432': 'TX',
  '469': 'TX', '512': 'TX', '682': 'TX', '713': 'TX', '726': 'TX',
  '737': 'TX', '806': 'TX', '817': 'TX', '830': 'TX', '832': 'TX',
  '903': 'TX', '915': 'TX', '936': 'TX', '940': 'TX', '956': 'TX',
  '972': 'TX', '979': 'TX',
  // Virginia
  '276': 'VA', '434': 'VA', '540': 'VA', '571': 'VA', '703': 'VA',
  '757': 'VA', '804': 'VA',
  // Washington
  '206': 'WA', '253': 'WA', '360': 'WA', '425': 'WA', '509': 'WA',
  '564': 'WA',
}
