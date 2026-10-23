// Self-hosted box only (selfhost/): send one test email through the client's
// SMTP so the installer and golden-test.sh can prove mail goes out. Bearer
// CRON_SECRET; 404 anywhere SELFHOST is not 1 (so it does nothing on Vercel).
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
//     -d '{"to":"it@client.com"}' https://<box>/api/cron/selfhost-mail-test

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { sendEmail } from '@/lib/email'
import { smtpConfig } from '@/lib/emailSmtp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (process.env.SELFHOST !== '1') return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!smtpConfig()) return NextResponse.json({ ok: false, error: 'SMTP_HOST not set in selfhost/.env' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as { to?: unknown }
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!/^[^\s@]+@[^\s@]+$/.test(to)) return NextResponse.json({ ok: false, error: 'to: a valid address' }, { status: 400 })

  const box = process.env.BOX_ID || 'box'
  const res = await sendEmail({
    brand: 'cxo',
    to,
    subject: `Suite CXO test email from ${box}`,
    text: `This is a test email from the Suite CXO server ${box}. If you can read it, outgoing mail works.`,
    html: `<p>This is a test email from the Suite CXO server <b>${box.replace(/[<>&"]/g, '')}</b>.</p><p>If you can read it, outgoing mail works.</p>`,
  })
  return NextResponse.json(res, { status: res.ok ? 200 : 502 })
}
