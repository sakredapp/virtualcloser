// POST /api/admin/billing/:repId/send-build-fee-link
// Body: { amountCents: number, note?: string }
//
// Creates a Stripe Checkout session for a custom build-fee amount and
// emails the payment link to the client. No cart needed — the rep already
// exists. On payment the webhook records the method and sets
// billing_status='pending_activation' so the normal activate flow works.

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { getStripe, isStripeConfigured } from '@/lib/billing/stripe'
import { supabase } from '@/lib/supabase'
import { audit } from '@/lib/billing/auditLog'
import { sendEmail } from '@/lib/email'

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
  const description = note
    ? `Custom build fee — ${note}`
    : 'Virtual Closer — Custom Build Fee'

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: { name: description },
        },
        quantity: 1,
      },
    ],
    success_url: `https://${rep.slug}.${ROOT}/welcome?flow=build_fee`,
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

  // Email the link to the client.
  await sendEmail({
    to: rep.email as string,
    subject: 'Your Virtual Closer build fee payment link',
    html: buildFeeLinkHtml({
      displayName: (rep.display_name as string | null) ?? 'there',
      amountCents,
      paymentUrl: session.url!,
      note,
    }),
    text: `Hi, here's your Virtual Closer build fee payment link ($${(amountCents / 100).toFixed(2)}): ${session.url}`,
  })

  await audit({
    actorKind: 'admin',
    action: 'build_fee.link_sent',
    repId,
    stripeObjectId: session.id,
    amountCents,
    notes: note || 'custom build fee link sent',
  })

  return NextResponse.json({ ok: true, sessionId: session.id, url: session.url })
}

function buildFeeLinkHtml(args: {
  displayName: string
  amountCents: number
  paymentUrl: string
  note: string
}): string {
  const dollars = `$${(args.amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const noteHtml = args.note
    ? `<p style="margin:0 0 16px;font-size:14px;color:#374151;"><strong>Note from your account manager:</strong> ${esc(args.note)}</p>`
    : ''
  return `
    <p style="margin:0 0 14px;">Hey ${esc(args.displayName)},</p>
    <p style="margin:0 0 14px;">Your Virtual Closer build fee of <strong>${dollars}</strong> is ready to pay.</p>
    ${noteHtml}
    <p style="margin:0 0 20px;font-size:13px;color:#6b7280;">
      Once payment is processed, our team will begin your build. You'll receive a confirmation email
      and your dashboard access as soon as the build is live.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
      <tr><td bgcolor="#ff2800" style="border-radius:10px;">
        <a href="${args.paymentUrl}" style="display:inline-block;padding:13px 24px;background:#ff2800;color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:10px;">
          Pay ${dollars} →
        </a>
      </td></tr>
    </table>
    <p style="margin:0;font-size:12px;color:#9ca3af;">
      Link expires after payment or 24 hours. Questions? Reply to this email.
    </p>
  `
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
