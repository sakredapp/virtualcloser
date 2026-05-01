// AI Dialer liability agreement — persistence layer.
//
// Pure-text constants + HTML renderer live in lib/liabilityAgreementCopy.ts
// so client components can import the agreement body without dragging in
// the supabase server client. Re-exported here for legacy callers.

import { supabase } from './supabase'
import {
  AGREEMENT_BODY,
  AGREEMENT_TITLE,
  CURRENT_VERSION,
  renderAgreementHtml,
} from './liabilityAgreementCopy'

export { AGREEMENT_BODY, AGREEMENT_TITLE, CURRENT_VERSION, renderAgreementHtml }

export type LiabilityAgreementRow = {
  id: string
  rep_id: string
  member_id: string
  agreement_version: string
  signature_name: string
  agreement_text: string
  pdf_storage_path: string | null
  signed_at: string
  signed_ip: string | null
  signed_user_agent: string | null
}

/**
 * Has this member already signed the CURRENT version? Used to gate the
 * dialer modal — if the answer is yes, no modal shows.
 */
export async function hasMemberSignedCurrent(memberId: string): Promise<boolean> {
  const { data } = await supabase
    .from('liability_agreements')
    .select('id')
    .eq('member_id', memberId)
    .eq('agreement_version', CURRENT_VERSION)
    .maybeSingle()
  return Boolean(data)
}

export async function listAgreementsForRep(repId: string): Promise<LiabilityAgreementRow[]> {
  const { data, error } = await supabase
    .from('liability_agreements')
    .select('*')
    .eq('rep_id', repId)
    .order('signed_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as LiabilityAgreementRow[]
}

const BUCKET = 'liability-agreements'

/**
 * Returns a signed download URL valid for `expiresInSec` seconds (default
 * 5 minutes). Caller must verify auth before exposing this URL — admin
 * for cross-member access, member for their own row only.
 */
export async function getSignedAgreementUrl(
  storagePath: string,
  expiresInSec = 300,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSec)
  if (error) {
    console.error('[liability] signed url failed', error)
    return null
  }
  return data?.signedUrl ?? null
}

/**
 * Persist a new signature and upload the rendered HTML to the storage
 * bucket as the audit record. (Real PDF generation is out of scope for
 * this commit — the HTML attachment + the agreement_text snapshot column
 * cover the audit need; bolt on a PDF renderer later if needed.)
 */
export async function recordSignature(args: {
  repId: string
  memberId: string
  signatureName: string
  signedIp?: string | null
  signedUserAgent?: string | null
  workspaceLabel?: string | null
}): Promise<{ ok: true; row: LiabilityAgreementRow } | { ok: false; error: string }> {
  const signedAtIso = new Date().toISOString()
  const html = renderAgreementHtml({
    signatureName: args.signatureName,
    signedAt: signedAtIso,
    workspaceLabel: args.workspaceLabel ?? undefined,
  })

  const { data: row, error: insertError } = await supabase
    .from('liability_agreements')
    .insert({
      rep_id: args.repId,
      member_id: args.memberId,
      agreement_version: CURRENT_VERSION,
      signature_name: args.signatureName,
      agreement_text: AGREEMENT_BODY,
      signed_ip: args.signedIp ?? null,
      signed_user_agent: args.signedUserAgent ?? null,
      signed_at: signedAtIso,
    })
    .select('*')
    .single()
  if (insertError) {
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('liability_agreements')
        .select('*')
        .eq('member_id', args.memberId)
        .eq('agreement_version', CURRENT_VERSION)
        .maybeSingle()
      if (existing) return { ok: true, row: existing as LiabilityAgreementRow }
    }
    return { ok: false, error: insertError.message }
  }

  const path = `${args.repId}/${args.memberId}/${(row as LiabilityAgreementRow).id}.html`
  try {
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, new Blob([html], { type: 'text/html' }), {
        contentType: 'text/html',
        upsert: true,
      })
    if (!upErr) {
      await supabase
        .from('liability_agreements')
        .update({ pdf_storage_path: path })
        .eq('id', (row as LiabilityAgreementRow).id)
      ;(row as LiabilityAgreementRow).pdf_storage_path = path
    } else {
      console.error('[liability] upload failed', upErr)
    }
  } catch (err) {
    console.error('[liability] upload exception', err)
  }

  return { ok: true, row: row as LiabilityAgreementRow }
}
