// POST /api/admin/billing/:repId/send-build-fee-link
// Body: { amountCents: number, note?: string }
//
// Creates a Stripe Checkout session for a custom build-fee amount, generates
// a branded PDF invoice, and emails both to the client. On payment the webhook
// records the saved card and sets billing_status='pending_activation' so the
// normal activate-subscription flow works without any extra steps.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'
import { sendEmail } from '@/lib/email'
import { generateInvoicePdf, makeInvoiceNumber } from '@/lib/billing/invoicePdf'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ROOT = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'

export async function POST(req: NextRequest, ctx: { params: Promise<{ repId: string }> }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 })
  if (!isStripeConfigured()) return NextResponse.json({ ok: false, reason: 'stripe_not_configured' }, { status: 501 })

  const { repId } = await ctx.params
  const body = await req.json().catch(() => ({})) as { amountCents?: number; note?: string }
  const amountCents = Math.round(Number(body.amountCents ?? 0))
  if (!Number.isFinite(amountCents) || amountCents < 100) {
    return NextResponse.json({ ok: false, reason: 'amount must be at least $1' }, { status: 400 })
  }

  const { data: rep } = await supabase
    .from('reps')
    .select('id, email, display_name, stripe_customer_id, slug')
    .eq('id', repId)
    .maybeSingle()
  if (!rep) return NextResponse.json({ ok: false, reason: 'rep_not_found' }, { status: 404 })
  if (!rep.email) return NextResponse.json({ ok: false, reason: 'rep_has_no_email' }, { status: 400 })

  const stripe = getStripe()

  // Reuse existing Stripe customer or create one.
  let customerId = rep.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: rep.email as string,
      name: (rep.display_name as string | null) ?? undefined,
      metadata: { rep_id: repId },
    })
    customerId = customer.id
    await supabase.from('reps').update({ stripe_customer_id: customerId }).eq('id', repId)
  }

  const note = (body.note ?? '').trim()
  const lineDescription = note ? `Virtual Closer — Build Fee (${note})` : 'Virtual Closer — Build Fee'

  // Success goes to the subdomain welcome page if the slug exists, otherwise
  // the root domain welcome — avoids a broken null.virtualcloser.com URL.
  const slug = (rep.slug as string | null) ?? null
  const successUrl = slug
    ? `https://${slug}.${ROOT}/welcome?flow=build_fee`
    : `https://${ROOT}/welcome?flow=build_fee`

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: { name: lineDescription },
        },
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: `https://${ROOT}/admin/clients/${repId}`,
    allow_promotion_codes: false,
    payment_method_types: ['card'],
    payment_intent_data: {
      setup_future_usage: 'off_session',
      metadata: { rep_id: repId, kind: 'admin_build_fee' },
    },
    metadata: {
      rep_id: repId,
      vc_kind: 'admin_build_fee',
      vc_amount_cents: String(amountCents),
      vc_note: note,
    },
  })

  const invoiceNumber = makeInvoiceNumber(session.id)
  const issuedDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const displayName = (rep.display_name as string | null) ?? (rep.email as string)
  const dollars = formatDollars(amountCents)

  // Generate PDF invoice.
  let pdfBuffer: Buffer | null = null
  try {
    pdfBuffer = await generateInvoicePdf({
      invoiceNumber,
      issuedDate,
      dueDate: 'Upon receipt',
      clientName: displayName,
      clientEmail: rep.email as string,
      lineItems: [{ description: lineDescription, amountCents }],
      note: note || undefined,
      paymentUrl: session.url!,
    })
  } catch (err) {
    // PDF failure is non-fatal — email still sends without attachment.
    console.error('[send-build-fee-link] PDF generation failed', err)
  }

  // Send branded email with PDF invoice attached.
  await sendEmail({
    to: rep.email as string,
    subject: `Invoice ${invoiceNumber} — Virtual Closer Build Fee (${dollars})`,
    html: buildFeeEmailHtml({ displayName, amountCents, paymentUrl: session.url!, note, invoiceNumber }),
    text: [
      `Hi ${displayName},`,
      ``,
      `Your Virtual Closer build fee of ${dollars} is ready. Pay securely here: ${session.url}`,
      ``,
      `Invoice #: ${invoiceNumber}`,
      note ? `Note: ${note}` : null,
      ``,
      `Your PDF invoice is attached.`,
      ``,
      `— Virtual Closer`,
    ].filter((l) => l !== null).join('\n'),
    attachments: pdfBuffer
      ? [{ filename: `VC-Invoice-${invoiceNumber}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
      : undefined,
  })

  await audit({
    actorKind: 'admin',
    action: 'build_fee.link_sent',
    repId,
    stripeObjectId: session.id,
    amountCents,
    notes: [
      `invoice ${invoiceNumber}`,
      note || null,
      pdfBuffer ? 'PDF attached' : 'PDF failed',
    ].filter(Boolean).join(' · '),
  })

  return NextResponse.json({ ok: true, sessionId: session.id, url: session.url, invoiceNumber })
}

// ── Email HTML ─────────────────────────────────────────────────────────────

function buildFeeEmailHtml(args: {
  displayName: string
  amountCents: number
  paymentUrl: string
  note: string
  invoiceNumber: string
}): string {
  const dollars = formatDollars(args.amountCents)
  const RED = '#ff2800'
  const INK = '#0f0f0f'
  const MUTED = '#5a5a5a'
  const BORDER = 'rgba(15,15,15,0.12)'
  const PAPER2 = '#f7f4ef'
  const ROOT_DOMAIN = process.env.ROOT_DOMAIN ?? 'virtualcloser.com'
  const logoUrl = `https://${ROOT_DOMAIN}/logo.png`

  const noteRow = args.note
    ? `<tr><td style="padding:10px 14px;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED};">
         <strong style="color:${INK};">Note from your account manager</strong><br>${esc(args.note)}
       </td></tr>`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:${RED};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};">
<span style="display:none;visibility:hidden;opacity:0;color:transparent;height:0;width:0;">Invoice ${args.invoiceNumber} — ${dollars} due on receipt.</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${RED};padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

      <!-- Logo -->
      <tr><td align="center" style="padding-bottom:18px;">
        <a href="https://${ROOT_DOMAIN}" style="text-decoration:none;display:inline-block;">
          <img src="${logoUrl}" alt="Virtual Closer" width="64" height="64"
               style="display:block;border-radius:14px;border:1px solid ${BORDER};background:#fff;">
        </a>
      </td></tr>

      <!-- Card -->
      <tr><td style="background:#fff;border:1px solid ${INK};border-radius:14px;padding:0;overflow:hidden;">

        <!-- Card header -->
        <div style="background:${INK};padding:18px 28px;">
          <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:rgba(255,255,255,0.65);font-weight:700;">Virtual Closer</p>
          <h1 style="margin:4px 0 0;font-size:22px;line-height:1.2;color:#fff;font-weight:700;">Invoice ${esc(args.invoiceNumber)}</h1>
        </div>

        <!-- Body -->
        <div style="padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Hey ${esc(args.displayName)},</p>
          <p style="margin:0 0 20px;font-size:14px;color:${MUTED};line-height:1.55;">
            Your build fee invoice is ready. A PDF copy is attached to this email for your records.
            Once payment is received, our team will begin your build immediately.
          </p>

          <!-- Invoice summary table -->
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                 style="border:1px solid ${BORDER};border-radius:10px;overflow:hidden;margin-bottom:20px;font-size:13px;">
            <tr style="background:${PAPER2};">
              <td style="padding:10px 14px;font-weight:700;color:${INK};border-bottom:1px solid ${BORDER};width:55%;">Description</td>
              <td style="padding:10px 14px;font-weight:700;color:${INK};border-bottom:1px solid ${BORDER};text-align:right;">Amount</td>
            </tr>
            <tr>
              <td style="padding:12px 14px;border-bottom:1px solid ${BORDER};color:${INK};">Virtual Closer — Build Fee</td>
              <td style="padding:12px 14px;border-bottom:1px solid ${BORDER};text-align:right;font-weight:700;color:${INK};">${dollars}</td>
            </tr>
            ${noteRow}
            <tr style="background:${PAPER2};">
              <td style="padding:12px 14px;font-weight:700;color:${INK};">Total due</td>
              <td style="padding:12px 14px;text-align:right;font-weight:800;font-size:16px;color:${RED};">${dollars}</td>
            </tr>
          </table>

          <!-- CTA button -->
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
            <tr><td bgcolor="${RED}" style="border-radius:10px;">
              <a href="${args.paymentUrl}"
                 style="display:inline-block;padding:14px 28px;background:${RED};color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;letter-spacing:0.02em;">
                Pay ${dollars} securely →
              </a>
            </td></tr>
          </table>

          <p style="margin:0;font-size:12px;color:${MUTED};line-height:1.5;">
            Your card details are encrypted by Stripe — we never see your card number.
            The payment link is single-use and expires after payment is completed.
            Questions? Just reply to this email.
          </p>
        </div>

        <!-- Footer -->
        <div style="padding:14px 28px;border-top:1px solid ${BORDER};font-size:11px;color:${MUTED};">
          Sent by Virtual Closer · <a href="https://${ROOT_DOMAIN}" style="color:${RED};text-decoration:none;">${ROOT_DOMAIN}</a>
        </div>

      </td></tr>

      <tr><td align="center" style="padding-top:14px;font-size:11px;color:rgba(255,255,255,0.75);">
        You're receiving this because your account manager sent you an invoice.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
