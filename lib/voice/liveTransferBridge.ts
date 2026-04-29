// Live Transfer Bridge
//
// Selects the best available human rep to receive a live transfer call,
// retrieves their phone number, and returns a fully-formed transfer target
// that the Vapi dispatcher can inject as assistantOverrides.forwardingPhoneNumber.
//
// Availability is governed by dialer_transfer_availability windows (weekly
// schedule per member). Selection policy: round-robin by member_id within
// available set so no single rep gets all transfers in a session.

import { supabase } from '@/lib/supabase'
import { getAvailableTransferMemberIdsNow } from './liveTransferAvailability'

export type LiveTransferTarget = {
  member_id: string
  display_name: string
  phone: string
}

export type LiveTransferBridgeResult =
  | { available: true; target: LiveTransferTarget }
  | { available: false; reason: 'no_available_reps' | 'no_phones_configured' }

/**
 * Select the best available rep to receive a live transfer for a given
 * rep_id (tenant). Returns the target's phone number suitable for passing
 * as Vapi forwardingPhoneNumber.
 *
 * @param repId   Tenant account id (the seller account, not a member id)
 * @param seedKey Optional string (e.g. queue_id) used to round-robin selection
 *                deterministically within the available set.
 */
export async function selectLiveTransferTarget(
  repId: string,
  seedKey?: string,
): Promise<LiveTransferBridgeResult> {
  const availableIds = await getAvailableTransferMemberIdsNow(repId)
  if (!availableIds.length) {
    return { available: false, reason: 'no_available_reps' }
  }

  // Pull phone + display_name for available members in one query.
  const { data: members, error } = await supabase
    .from('members')
    .select('id, display_name, phone')
    .eq('rep_id', repId)
    .in('id', availableIds)
    .eq('is_active', true)
    .not('phone', 'is', null)

  if (error) throw error

  const eligible = (members ?? []).filter(
    (m): m is { id: string; display_name: string; phone: string } =>
      typeof m.phone === 'string' && m.phone.trim().length > 0,
  )

  if (!eligible.length) {
    return { available: false, reason: 'no_phones_configured' }
  }

  // Round-robin: derive index from seedKey or pick first.
  let idx = 0
  if (seedKey) {
    let hash = 0
    for (let i = 0; i < seedKey.length; i++) {
      hash = (hash * 31 + seedKey.charCodeAt(i)) >>> 0
    }
    idx = hash % eligible.length
  }

  const picked = eligible[idx]

  return {
    available: true,
    target: {
      member_id: picked.id,
      display_name: picked.display_name,
      phone: normalizePhone(picked.phone),
    },
  }
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, '')
  if (digits.startsWith('+')) return digits
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits
}
