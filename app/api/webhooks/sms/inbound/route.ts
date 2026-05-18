// Twilio inbound SMS webhook.
//
// Twilio hits this endpoint when any lead replies to a client's Twilio number.
// Multi-tenant routing: we look up which rep owns the `To` number, then
// validate the Twilio signature with that rep's auth token.
//
// Response contract: always return 200 (empty body) within ~1s.
// All AI processing runs async via a background promise.

import { NextRequest, NextResponse } from 'next/server'
import { findRepByTwilioPhone, getTwilioCreds, validateTwilioSignature } from '@/lib/sms/twilioClient'
import { handleInboundSms } from '@/lib/sms/aiEngine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Twilio posts application/x-www-form-urlencoded
  let params: Record<string, string>
  try {
    const text = await req.text()
    params = Object.fromEntries(new URLSearchParams(text))
  } catch {
    return new NextResponse('', { status: 200 }) // Always 200 to Twilio
  }

  const from = params.From ?? ''
  const to = params.To ?? ''
  const body = params.Body ?? ''
  const messageSid = params.MessageSid ?? ''

  if (!from || !to || !messageSid) {
    return new NextResponse('', { status: 200 })
  }

  // Route to the correct rep via their Twilio phone number
  const repId = await findRepByTwilioPhone(to)
  if (!repId) {
    // Unknown `to` number — not one of our clients. Log and return 200.
    console.warn('[sms-inbound] unknown To number:', to)
    return new NextResponse('', { status: 200 })
  }

  // Validate Twilio signature against the rep's auth token. We MUST look up
  // the rep first because Twilio signatures are per-account — but we refuse
  // to process the message unless the signature is valid (or auth is
  // explicitly absent on both sides). Return 200 either way to suppress
  // Twilio retry storms.
  const creds = await getTwilioCreds(repId)
  if (creds) {
    const signature = req.headers.get('x-twilio-signature') ?? ''
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const webhookUrl = `${baseUrl}/api/webhooks/sms/inbound`

    if (!signature) {
      console.warn('[sms-inbound] missing X-Twilio-Signature for rep', repId, '— refusing to process')
      return new NextResponse('', { status: 200 })
    }
    if (!baseUrl) {
      console.error('[sms-inbound] NEXT_PUBLIC_APP_URL not configured — cannot validate Twilio signature')
      return new NextResponse('', { status: 200 })
    }
    const valid = validateTwilioSignature(creds.authToken, signature, webhookUrl, params)
    if (!valid) {
      console.warn('[sms-inbound] invalid Twilio signature for rep', repId)
      return new NextResponse('', { status: 200 })
    }
  } else {
    // No creds stored for this rep means an unmanaged Twilio number — refuse
    // to process unsigned messages rather than treating "no creds" as "skip
    // auth", which used to silently let any caller forge inbound SMS.
    console.warn('[sms-inbound] no Twilio creds for rep', repId, '— refusing to process')
    return new NextResponse('', { status: 200 })
  }

  // Process async — return 200 immediately (Twilio has a 15s webhook timeout)
  // Using a detached promise; in Vercel Fluid Compute this continues after response.
  void handleInboundSms({
    repId,
    from,
    to,
    body,
    providerMessageId: messageSid,
  }).catch((err) => {
    console.error('[sms-inbound] handleInboundSms error for rep', repId, err)
  })

  return new NextResponse('', { status: 200 })
}
