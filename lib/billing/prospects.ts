// Prospect ↔ Rep (client) matcher.
//
// Prospects come from Cal.com bookings + Fathom call recordings (lead
// capture). Reps come from successful checkouts (paying customers).
// One person flows through both — we tie them together by email and/or
// phone when payment lands so the admin sees a single timeline.
//
// Matching rules (case + whitespace insensitive):
//   1. Email exact match
//   2. Phone E.164-ish match (strip non-digits)
//
// On match: set prospects.rep_id, prospects.status='won', prospects.updated_at.
// If no match exists, we create a synthetic prospect row so the admin
// /admin/clients view always has a unified row even for direct-checkout
// customers who skipped the booking flow.

import { supabase } from '@/lib/supabase'

function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null
  const digits = s.replace(/\D+/g, '')
  return digits.length >= 7 ? digits : null
}

function normalizeEmail(s: string | null | undefined): string | null {
  return s ? s.toLowerCase().trim() : null
}

export type ProspectMatch = {
  prospectId: string
  source: string
  isNew: boolean              // we created a synthetic one
  preExistingRepId: string | null
}

/** Find an existing prospect for this contact and convert them. If no
 *  prospect exists, creates a synthetic one tagged 'direct_checkout' so
 *  the admin index has one row per real customer. Idempotent. */
export async function matchAndConvertProspect(args: {
  email?: string | null
  phone?: string | null
  displayName?: string | null
  company?: string | null
  repId: string
  scope: 'individual' | 'team' | 'enterprise'
}): Promise<ProspectMatch | null> {
  const email = normalizeEmail(args.email)
  const phone = normalizePhone(args.phone)
  if (!email && !phone) return null

  // Try email first, then phone. Get the most recent matching prospect.
  type ProspectRow = { id: string; source: string; rep_id: string | null }
  let prospect: ProspectRow | null = null

  if (email) {
    const { data } = await supabase
      .from('prospects')
      .select('id, source, rep_id')
      .ilike('email', email)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) prospect = data as unknown as ProspectRow
  }

  if (!prospect && phone) {
    // Phone is stored as-typed. We do a simple ilike for the digit suffix
    // (last 10 digits typically — covers US format with or without +1).
    const tail = phone.slice(-10)
    if (tail.length >= 7) {
      const { data } = await supabase
        .from('prospects')
        .select('id, source, rep_id')
        .ilike('phone', `%${tail}%`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data) prospect = data as unknown as ProspectRow
    }
  }

  if (prospect) {
    await supabase
      .from('prospects')
      .update({
        rep_id: args.repId,
        status: 'won',
        updated_at: new Date().toISOString(),
      })
      .eq('id', prospect.id)
    return {
      prospectId: prospect.id,
      source: prospect.source,
      isNew: false,
      preExistingRepId: prospect.rep_id,
    }
  }

  // No match — create a synthetic prospect so the admin always sees one
  // unified row per customer. Source = 'direct_checkout'.
  const { data: created, error } = await supabase
    .from('prospects')
    .insert({
      source: 'direct_checkout',
      name: args.displayName ?? null,
      email: email,
      phone: args.phone ?? null,
      company: args.company ?? null,
      tier_interest: args.scope,
      status: 'won',
      rep_id: args.repId,
      notes: 'Created from direct checkout — no prior booking on file.',
    })
    .select('id, source')
    .single()
  if (error) {
    console.warn('[prospects] synthetic prospect insert failed', error)
    return null
  }
  return {
    prospectId: (created as { id: string }).id,
    source: (created as { source: string }).source,
    isNew: true,
    preExistingRepId: null,
  }
}
