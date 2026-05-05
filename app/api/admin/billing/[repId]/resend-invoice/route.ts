// POST /api/admin/billing/:repId/resend-invoice
// Body: { stripeInvoiceId?: string }
//
// Fetches the given Stripe invoice (or the latest one if omitted),
// generates a branded PDF, and emails it to the client. Safe to call
// multiple times — purely a send action, no state mutations.

import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { generateInvoicePdf, makeInvoiceNumber } from '@/lib/billing/invoicePdf'
import { sendEmail } from '@/lib/email'
import { audit } from '@/lib/billing/auditLog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function POST(req: NextRequest, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })

  const { repId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { stripeInvoiceId?: string }

  const { data: rep } = await supabase
    .from('reps')
    .select('id, email, display_name, stripe_customer_id')
    .eq('id', repId)
    .maybeSingle()

  if (!rep) return NextResponse.json({ ok: false, reason: 'rep_not_found' }, { status: 404 })
  if (!rep.email) return NextResponse.json({ ok: false, reason: 'rep_has_no_email' }, { status: 400 })
  if (!rep.stripe_customer_id) return NextResponse.json({ ok: false, reason: 'no_stripe_customer' }, { status: 400 })

  const stripe = getStripe()
  let inv: Stripe.Invoice

  try {
    if (body.stripeInvoiceId) {
      inv = await stripe.invoices.retrieve(body.stripeInvoiceId, { expand: ['lines'] })
    } else {
      const list = await stripe.invoices.list({
        customer: rep.stripe_customer_id as string,
        limit: 1,
        expand: ['data.lines'],
      })
      if (!list.data.length) {
        return NextResponse.json({ ok: false, reason: 'no_invoices_found' }, { status: 404 })
      }
      inv = list.data[0]
    }
  } catch (err) {
    console.error('[resend-invoice] Stripe fetch failed', { repId, err })
    return NextResponse.json({ ok: false, reason: 'stripe_error' }, { status: 502 })
  }

  const totalCents = inv.amount_paid ?? inv.amount_due ?? 0
  const stripeLines = (inv.lines?.data ?? []).filter((l) => (l.amount ?? 0) !== 0)
  const lineItems = stripeLines.length > 0
    ? stripeLines.map((l) => ({
        description: l.description ?? 'Virtual Closer — Service',
        amountCents: l.amount ?? 0,
      }))
    : [{ description: 'Virtual Closer — Service', amountCents: totalCents }]

  const invoiceNumber = makeInvoiceNumber(inv.id)
  const issuedDate = new Date(inv.created * 1000).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  })
  const isPaid = inv.status === 'paid'
  const paymentUrl = (inv as { hosted_invoice_url?: string }).hosted_invoice_url
    ?? `https://${ROOT}/dashboard/billing`
  const displayName = (rep.display_name as string | null) ?? (rep.email as string)
  const dollars = formatDollars(totalCents)

  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await generateInvoicePdf({
      invoiceNumber,
      issuedDate,
      dueDate: isPaid ? 'Paid' : 'Upon receipt',
      clientName: displayName,
      clientEmail: rep.email as string,
      lineItems,
      paymentUrl,
    })
  } catch (err) {
    console.error('[resend-invoice] PDF generation failed', { repId, invoiceId: inv.id, err })
  }

  await sendEmail({
    to: rep.email as string,
    subject: isPaid
      ? `Receipt ${invoiceNumber} — Virtual Closer (${dollars} paid)`
      : `Invoice ${invoiceNumber} — Virtual Closer (${dollars} due)`,
    html: buildResendEmailHtml({ displayName, totalCents, paymentUrl, invoiceNumber, isPaid, lineItems }),
    text: [
      `Hi ${displayName},`,
      ``,
      isPaid ? `Here's your Virtual Closer receipt for ${dollars}.` : `Your Virtual Closer invoice for ${dollars} is attached.`,
      ``,
      ...lineItems.map((l) => `  ${l.description}: ${formatDollars(l.amountCents)}`),
      ``,
      `Total: ${dollars}`,
      `Invoice #: ${invoiceNumber}`,
      isPaid ? `` : `Pay here: ${paymentUrl}`,
      ``,
      `— Virtual Closer`,
    ].filter((l) => l !== undefined).join('\n'),
    attachments: pdfBuffer
      ? [{ filename: `VC-Invoice-${invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
      : undefined,
  })

  await audit({
    actorKind: 'admin',
    action: 'invoice.resent',
    repId,
    stripeObjectId: inv.id,
    amountCents: totalCents,
    notes: [
      `invoice ${invoiceNumber}`,
      body.stripeInvoiceId ? `requested: ${body.stripeInvoiceId}` : 'latest invoice',
      pdfBuffer ? 'PDF attached' : 'PDF failed',
    ].filter(Boolean).join(' · '),
  }).catch(() => {})

  return NextResponse.json({ ok: true, invoiceNumber, invoiceId: inv.id })
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function buildResendEmailHtml(args: {
  displayName: string
  totalCents: number
  paymentUrl: string
  invoiceNumber: string
  isPaid: boolean
  lineItems: { description: string; amountCents: number }[]
}): string {
  const dollars = formatDollars(args.totalCents)
  const RED = '#ff2800'
  const INK = '#0f0f0f'
  const MUTED = '#6b6b6b'
  const CREAM = '#f7f4ef'
  const BORDER = 'rgba(15,15,15,0.12)'
  const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

  const lineRows = args.lineItems.map((l) => `
    <tr>
      <td style="padding:10px 14px;border-bottom:1px solid ${BORDER};color:${INK};font-size:13px;">${esc(l.description)}</td>
      <td style="padding:10px 14px;border-bottom:1px solid ${BORDER};text-align:right;font-weight:700;color:${INK};font-size:13px;">${formatDollars(l.amountCents)}</td>
    </tr>`).join('')

  const ctaRow = args.isPaid ? '' : `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td bgcolor="${RED}" style="border-radius:10px;">
        <a href="${args.paymentUrl}"
           style="display:inline-block;padding:13px 26px;background:${RED};color:#fff;font-weight:700;font-size:14px;text-decoration:none;border-radius:10px;letter-spacing:0.02em;">
          Pay ${dollars} securely →
        </a>
      </td></tr>
    </table>`

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">${args.isPaid ? `Receipt ${args.invoiceNumber} — ${dollars} paid.` : `Invoice ${args.invoiceNumber} — ${dollars} due.`}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${CREAM};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;">

      <tr><td style="background:${RED};height:4px;border-radius:6px 6px 0 0;"></td></tr>

      <tr><td style="background:#fff;border:1px solid ${BORDER};border-top:none;border-radius:0 0 14px 14px;padding:0;overflow:hidden;">

        <div style="padding:22px 28px 16px;border-bottom:1px solid ${BORDER};">
          <p style="margin:0 0 2px;font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:${RED};font-weight:700;">Virtual Closer</p>
          <h1 style="margin:0;font-size:20px;line-height:1.2;color:${INK};font-weight:700;">${args.isPaid ? 'Receipt' : 'Invoice'} ${esc(args.invoiceNumber)}</h1>
        </div>

        <div style="padding:22px 28px;">
          <p style="margin:0 0 14px;font-size:14px;line-height:1.5;">Hey ${esc(args.displayName.split(' ')[0])},</p>
          <p style="margin:0 0 20px;font-size:13px;color:${MUTED};line-height:1.55;">
            ${args.isPaid
              ? `Here's your itemised receipt for your Virtual Closer service. Your PDF copy is attached.`
              : `Here's your Virtual Closer invoice. Pay securely using the button below. Your PDF is attached.`
            }
          </p>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border:1.5px solid ${RED};border-radius:8px;overflow:hidden;margin-bottom:20px;">
            <tr style="background:${CREAM};">
              <td style="padding:9px 14px;font-weight:700;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${RED};border-bottom:1px solid ${BORDER};width:55%;">Description</td>
              <td style="padding:9px 14px;font-weight:700;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${RED};border-bottom:1px solid ${BORDER};text-align:right;">Amount</td>
            </tr>
            ${lineRows}
            <tr style="background:${CREAM};">
              <td style="padding:10px 14px;font-weight:700;color:${INK};">${args.isPaid ? 'Total paid' : 'Total due'}</td>
              <td style="padding:10px 14px;text-align:right;font-weight:800;font-size:15px;color:${RED};">${dollars}</td>
            </tr>
          </table>

          ${ctaRow}

          <p style="margin:0;font-size:11px;color:${MUTED};line-height:1.5;">
            View your full invoice history: <a href="https://${ROOT}/dashboard/billing" style="color:${RED};text-decoration:none;font-weight:600;">billing dashboard →</a>
            &nbsp;·&nbsp; Questions? Reply to this email.
          </p>
        </div>

        <div style="padding:12px 28px;border-top:1px solid ${BORDER};font-size:11px;color:${MUTED};">
          Sent by Virtual Closer · <a href="https://${ROOT}" style="color:${RED};text-decoration:none;">${ROOT}</a>
        </div>

      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
