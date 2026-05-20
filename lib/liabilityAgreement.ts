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
  getAgreement,
} from './liabilityAgreementCopy'
import { generateAgreementPdf } from './billing/generateAgreementPdf'
import { sendEmail } from './email'
import { getBrand } from './brand'
import type { BrandKey } from './brand'

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
 * Has this member already signed the current version for their brand? Used
 * to gate the dashboard modal — if the answer is yes, no modal shows. The
 * "current version" is brand-specific (VC and CXO have separate agreements
 * and version strings), so pass the tenant's brand.
 */
export async function hasMemberSignedCurrent(
  memberId: string,
  brand?: BrandKey | null,
): Promise<boolean> {
  const { data } = await supabase
    .from('liability_agreements')
    .select('id')
    .eq('member_id', memberId)
    .eq('agreement_version', getAgreement(brand).version)
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
  brand?: BrandKey | null
}): Promise<{ ok: true; row: LiabilityAgreementRow } | { ok: false; error: string }> {
  const signedAtIso = new Date().toISOString()
  const agreement = getAgreement(args.brand)

  const { data: row, error: insertError } = await supabase
    .from('liability_agreements')
    .insert({
      rep_id: args.repId,
      member_id: args.memberId,
      agreement_version: agreement.version,
      signature_name: args.signatureName,
      agreement_text: agreement.body,
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
        .eq('agreement_version', agreement.version)
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
      brand: args.brand,
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
      const brandCfg = getBrand(args.brand)
      const ROOT = brandCfg.rootDomain
      const ACCENT_HEX = brandCfg.theme.accent
      const INK_HEX = brandCfg.theme.ink
      const MUTED_HEX = brandCfg.theme.muted
      const PAPER2_HEX = brandCfg.theme.paper2
      const BORDER_HEX = brandCfg.theme.borderSoft
      const BRAND_NAME = brandCfg.name
      const fileSlug = (args.brand ?? 'virtualcloser') === 'cxo' ? 'CXO' : 'VC'
      const signedDate = new Date(signedAtIso).toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
      }) + ' UTC'

      await sendEmail({
        to: email,
        brand: args.brand ?? undefined,
        subject: `Signed: ${agreement.title}`,
        html: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${PAPER2_HEX};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK_HEX};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER2_HEX};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">
      <tr><td style="background:${ACCENT_HEX};height:4px;border-radius:6px 6px 0 0;"></td></tr>
      <tr><td style="background:#fff;border:1px solid ${BORDER_HEX};border-top:none;border-radius:0 0 14px 14px;padding:28px;">
        <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT_HEX};font-weight:700;">${BRAND_NAME}</p>
        <h1 style="margin:0 0 18px;font-size:20px;font-weight:700;color:${INK_HEX};">Your signed agreement</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.6;">Hey ${firstName},</p>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:${MUTED_HEX};">
          Your <strong>${agreement.title}</strong> has been signed and recorded.
          A copy of the signed document is attached to this email as a PDF for your records.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="background:${PAPER2_HEX};border:1px solid ${BORDER_HEX};border-radius:8px;padding:14px 18px;width:100%;margin-bottom:20px;">
          <tr>
            <td style="font-size:13px;color:${MUTED_HEX};padding:3px 0;"><strong style="color:${INK_HEX};">Signed by:</strong> &nbsp;${args.signatureName.replace(/</g, '&lt;')}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:${MUTED_HEX};padding:3px 0;"><strong style="color:${INK_HEX};">Date &amp; time:</strong> &nbsp;${signedDate}</td>
          </tr>
          <tr>
            <td style="font-size:13px;color:${MUTED_HEX};padding:3px 0;"><strong style="color:${INK_HEX};">Agreement version:</strong> &nbsp;<code style="font-family:monospace;font-size:12px;">${agreement.version}</code></td>
          </tr>
        </table>
        <p style="margin:0;font-size:12px;color:${MUTED_HEX};line-height:1.55;">
          This record is also archived in your ${BRAND_NAME} account. Questions? Reply to this email.
        </p>
        <p style="margin:20px 0 0;padding-top:16px;border-top:1px solid ${BORDER_HEX};font-size:11px;color:${MUTED_HEX};">
          Sent by ${BRAND_NAME} · <a href="https://${ROOT}" style="color:${ACCENT_HEX};text-decoration:none;">${ROOT}</a>
        </p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`,
        text: [
          `Hey ${firstName},`,
          ``,
          `Your ${agreement.title} has been signed and recorded.`,
          `A signed copy is attached as a PDF.`,
          ``,
          `Signed by: ${args.signatureName}`,
          `Date: ${signedDate}`,
          `Version: ${agreement.version}`,
          ``,
          `— ${BRAND_NAME}`,
        ].join('\n'),
        attachments: [
          {
            filename: `${fileSlug}-Agreement-${agreementRow.id.slice(0, 8).toUpperCase()}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      }).catch((err) => console.error('[liability] confirmation email failed', err))
    }

    // Admin copy — same branded PDF, so the team has a record of every signing.
    const brandCfg = getBrand(args.brand)
    const adminTo = process.env.ADMIN_EMAIL || 'team@sakredhealth.com'
    const fileSlug = (args.brand ?? 'virtualcloser') === 'cxo' ? 'CXO' : 'VC'
    await sendEmail({
      to: adminTo,
      brand: args.brand ?? undefined,
      subject: `[Admin] Signed: ${agreement.title} · ${args.signatureName}`,
      html: `<p>${args.signatureName.replace(/</g, '&lt;')} signed the ${brandCfg.name} agreement` +
        `${args.workspaceLabel ? ` for <strong>${String(args.workspaceLabel).replace(/</g, '&lt;')}</strong>` : ''}.</p>` +
        `<p>Version: <code>${agreement.version}</code><br/>Signed at: ${new Date(signedAtIso).toUTCString()}</p>` +
        `<p>The signed PDF is attached.</p>`,
      text: `${args.signatureName} signed the ${brandCfg.name} agreement` +
        `${args.workspaceLabel ? ` for ${args.workspaceLabel}` : ''}. Version ${agreement.version}, signed ${new Date(signedAtIso).toUTCString()}. PDF attached.`,
      attachments: [
        {
          filename: `${fileSlug}-Agreement-${agreementRow.id.slice(0, 8).toUpperCase()}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    }).catch((err) => console.error('[liability] admin copy failed', err))
  } catch (err) {
    console.error('[liability] PDF generation failed', err)
  }

  return { ok: true, row: agreementRow }
}
