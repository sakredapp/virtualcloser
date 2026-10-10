/**
 * Amazon SES (v2 API) — the fallback sender for partner email when an
 * executive has not connected Google. No SDK: SigV4 over fetch, so the
 * dependency list stays as it is.
 *
 * Env (place on the Vercel project to switch this path on; CXO_SES_FALLBACK=1 is
 * required on top, owner 10-10, so it stays OFF by default):
 *   AWS_SES_ACCESS_KEY_ID      IAM key with ses:SendEmail
 *   AWS_SES_SECRET_ACCESS_KEY
 *   AWS_SES_REGION             e.g. us-east-1
 *   CXO_SES_FROM_DOMAIN        verified sending domain, e.g. mail.suitecxo.com
 *
 * Mail goes out as "<Exec name> via Suite CXO <noreply@<domain>>" with the
 * executive as Reply-To, so replies land in their own inbox.
 */

import { createHash, createHmac } from 'node:crypto'

export function sesConfigured(): boolean {
  // Owner 10-10: coded, OFF. Scaled email for companies without their own
  // Google client waits on the CASA assessment for the public OAuth client;
  // until then this path stays dark unless CXO_SES_FALLBACK=1 is set as well.
  if (process.env.CXO_SES_FALLBACK !== '1') return false
  return Boolean(
    process.env.AWS_SES_ACCESS_KEY_ID &&
      process.env.AWS_SES_SECRET_ACCESS_KEY &&
      process.env.AWS_SES_REGION &&
      process.env.CXO_SES_FROM_DOMAIN,
  )
}

export const SES_ENV_NEEDED = ['AWS_SES_ACCESS_KEY_ID', 'AWS_SES_SECRET_ACCESS_KEY', 'AWS_SES_REGION', 'CXO_SES_FROM_DOMAIN'] as const

export function sesFromAddress(senderName: string): string {
  const domain = process.env.CXO_SES_FROM_DOMAIN ?? 'mail.suitecxo.com'
  const name = senderName.replace(/[<>"\r\n]/g, '').trim() || 'Suite CXO'
  return `"${name} via Suite CXO" <noreply@${domain}>`
}

const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
const hmac = (key: Buffer | string, s: string) => createHmac('sha256', key).update(s).digest()

export async function sendSesEmail(input: {
  from: string
  to: string
  subject: string
  text: string
  replyTo?: string | null
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  if (!sesConfigured()) return { ok: false, error: 'ses_not_configured' }
  const region = process.env.AWS_SES_REGION!
  const accessKey = process.env.AWS_SES_ACCESS_KEY_ID!
  const secret = process.env.AWS_SES_SECRET_ACCESS_KEY!

  const host = `email.${region}.amazonaws.com`
  const path = '/v2/email/outbound-emails'
  const body = JSON.stringify({
    FromEmailAddress: input.from,
    Destination: { ToAddresses: [input.to] },
    ReplyToAddresses: input.replyTo ? [input.replyTo] : undefined,
    Content: {
      Simple: {
        Subject: { Data: input.subject, Charset: 'UTF-8' },
        Body: { Text: { Data: input.text, Charset: 'UTF-8' } },
      },
    },
  })

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256(body)
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date'
  const canonicalRequest = ['POST', path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${dateStamp}/${region}/ses/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const kDate = hmac(`AWS4${secret}`, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 'ses')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex')
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

  try {
    const res = await fetch(`https://${host}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Host: host,
        'X-Amz-Date': amzDate,
        'X-Amz-Content-Sha256': payloadHash,
        Authorization: authorization,
      },
      body,
    })
    const json = (await res.json().catch(() => ({}))) as { MessageId?: string; message?: string }
    if (!res.ok) {
      console.error('[ses] sendEmail failed', res.status, json)
      return { ok: false, error: json.message ?? `ses_${res.status}` }
    }
    return { ok: true, messageId: json.MessageId }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'ses_failed' }
  }
}
