// Thin Twilio REST API wrapper for SMS.
// Uses per-client credentials stored in client_integrations (key='twilio').
// Each client has their own Twilio account — we never use a shared trunk for SMS.

import { createHmac } from 'crypto'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { supabase } from '@/lib/supabase'

export type TwilioCreds = {
  accountSid: string
  authToken: string
  phoneNumber: string  // E.164 from-number
}

// ── Credential helpers ────────────────────────────────────────────────────

export async function getTwilioCreds(repId: string): Promise<TwilioCreds | null> {
  const cfg = (await getIntegrationConfig(repId, 'twilio')) as Record<string, unknown> | null
  const sid = cfg?.account_sid as string | undefined
  const token = cfg?.auth_token as string | undefined
  const phone = cfg?.phone_number as string | undefined
  if (!sid || !token || !phone) return null
  return { accountSid: sid, authToken: token, phoneNumber: phone }
}

// Look up which rep owns a given Twilio `to` number so the inbound webhook
// can route without a rep_id in the URL.
export async function findRepByTwilioPhone(toPhone: string): Promise<string | null> {
  // client_integrations rows look like: { rep_id, key='twilio', config: { phone_number: '+1...' } }
  const { data } = await supabase
    .from('client_integrations')
    .select('rep_id, config')
    .eq('key', 'twilio')
  for (const row of data ?? []) {
    const cfg = row.config as Record<string, unknown> | null
    if (cfg?.phone_number === toPhone) return row.rep_id as string
  }
  return null
}

// ── Send ─────────────────────────────────────────────────────────────────

export async function sendSms(
  creds: TwilioCreds,
  to: string,
  body: string,
): Promise<{ sid: string }> {
  const auth = Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString('base64')
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${creds.accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: creds.phoneNumber, To: to, Body: body }).toString(),
    },
  )
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Twilio SMS failed (${res.status}): ${text}`)
  }
  const data = (await res.json()) as { sid: string }
  return { sid: data.sid }
}

// ── Signature validation ──────────────────────────────────────────────────
// https://www.twilio.com/docs/usage/webhooks/webhooks-security
// Twilio signs: HMAC-SHA1(authToken, url + alphabetically-sorted params)

export function validateTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort()
  const toSign = url + sortedKeys.map((k) => k + params[k]).join('')
  const expected = createHmac('sha1', authToken).update(toSign).digest('base64')
  // Use timing-safe compare to prevent timing attacks
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  }
  return diff === 0
}
