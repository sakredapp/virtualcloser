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
import { generateAgreementPdf } from './billing/generateAgreementPdf'
import { sendEmail } from './email'

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

  const agreementRow = row as LiabilityAgreementRow

  // Generate PDF and upload — non-blocking for the caller
  try {
    const pdfBuffer = await generateAgreementPdf({
      signatureName: args.signatureName,
      signedAt: signedAtIso,
      workspaceLabel: args.workspaceLabel ?? null,
      ipAddress: args.signedIp ?? null,
    })

    const pdfPath = `${args.repId}/${args.memberId}/${agreementRow.id}.pdf`
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(pdfPath, pdfBuffer, { contentType: 'application/pdf', upsert: true })

    if (!upErr) {
      await supabase
        .from('liability_agreements')
        .update({ pdf_storage_path: pdfPath })
        .eq('id', agreementRow.id)
      agreementRow.pdf_storage_path = pdfPath
    } else {
      console.error('[liability] PDF upload failed', upErr)
    }

    // Look up the member's email to send the signed copy
    const { data: member } = await supabase
      .from('members')
      .select('email, display_name')
      .eq('id', args.memberId)
      .maybeSingle()

    const email = (member?.email as string | null) ?? null
    if (email) {
      const firstName = ((member?.display_name as string | null) ?? '').split(' ')[0] || 'there'
      const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'
      const RED_HEX = '#ff2800'
      const INK_HEX = '#0f0f0f'
      const MUTED_HEX = '#6b6b6b'
      const CREAM_HEX = '#f7f4ef'
      const BORDER_HEX = 'rgba(15,15,15,0.12)'
      const signedDate = new Date(signedAtIso).toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      }) + ' UTC'

      await sendEmail({
        to: email,
        subject: `Signed: Virtual Closer — Operational & Liability Agreement`,
        html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${CREAM_HEX};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK_HEX};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM_HEX};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
      <tr><td style="background:${RED_HEX};height:4px;border-radius:6px 6px 0 0;"></td></tr>
      <tr><td style="background:#fff;border:1px solid ${BORDER_HEX};border-top:none;border-radius:0 0 14px 14px;padding:28px;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${RED_HEX};font-weight:700;">Virtual Closer</p>
        <h1 style="margin:0 0 18px;font-size:20px;font-weight:700;color:${INK_HEX};">Your signed agreement</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">Hey ${firstName},</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#374151;">
          Your <strong>Virtual Closer — Operational &amp; Liability Agreement</strong> has been signed and recorded.
          A copy of the signed document is attached to this email as a PDF for your records.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="background:${CREAM_HEX};border:1px solid ${BORDER_HEX};border-radius:8px;padding:14px 18px;width:100%;margin-bottom:20px;">
          <tr>
            <td style="font-size:13px;color:${MUTED_HEX};padding:3px 0;"><strong style="color:${INK_HEX};">Signed by:</strong> &nbsp;${args.signatureName.replace(/</g, '&lt;')}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:${MUTED_HEX};padding:3px 0;"><strong style="color:${INK_HEX};">Date &amp; time:</strong> &nbsp;${signedDate}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:${MUTED_HEX};padding:3px 0;"><strong style="color:${INK_HEX};">Agreement version:</strong> &nbsp;<code style="font-family:monospace;font-size:12px;">${CURRENT_VERSION}</code></td>
          </tr>
        </table>
        <p style="margin:0;font-size:12px;color:${MUTED_HEX};line-height:1.55;">
          This record is also archived in your Virtual Closer account. Questions? Reply to this email.
        </p>
        <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${BORDER_HEX};font-size:11px;color:${MUTED_HEX};">
          Sent by Virtual Closer · <a href="https://${ROOT}" style="color:${RED_HEX};text-decoration:none;">${ROOT}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
        text: [
          `Hey ${firstName},`,
          ``,
          `Your Virtual Closer — Operational & Liability Agreement has been signed and recorded.`,
          `A signed copy is attached as a PDF.`,
          ``,
          `Signed by: ${args.signatureName}`,
          `Date: ${signedDate}`,
          `Version: ${CURRENT_VERSION}`,
          ``,
          `— Virtual Closer`,
        ].join('\n'),
        attachments: [
          {
            filename: `VC-Agreement-${agreementRow.id.slice(0, 8).toUpperCase()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      }).catch((err) => console.error('[liability] confirmation email failed', err))
    }
  } catch (err) {
    console.error('[liability] PDF generation failed', err)
  }

  return { ok: true, row: agreementRow }
}
