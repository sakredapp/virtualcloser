import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { upsertProspect, type ProspectStatus } from '@/lib/prospects'
import { sendTelegramMessage } from '@/lib/telegram'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type CalAttendee = {
  name?: string
  email?: string
  timeZone?: string
}

type CalResponses = Record<string, unknown>

type CalPayload = {
  uid?: string
  bookingId?: number | string
  title?: string
  startTime?: string
  endTime?: string
  additionalNotes?: string
  location?: string
  attendees?: CalAttendee[]
  organizer?: CalAttendee
  responses?: CalResponses
  metadata?: Record<string, unknown>
  eventType?: { slug?: string; title?: string }
}

type CalWebhookBody = {
  triggerEvent?: string
  createdAt?: string
  payload?: CalPayload
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.CAL_WEBHOOK_SECRET
  if (!secret) return true // no secret configured — skip verification
  if (!signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(signature.replace(/^sha256=/, ''), 'hex')
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

function pick(obj: CalResponses | undefined, keys: string[]): string | null {
  if (!obj) return null
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
      const inner = (v as { value?: unknown }).value
      if (typeof inner === 'string' && inner.trim()) return inner.trim()
    }
  }
  return null
}

function mapStatus(trigger?: string): ProspectStatus {
  switch (trigger) {
    case 'BOOKING_CANCELLED':
    case 'BOOKING_CANCELED':
      return 'canceled'
    case 'BOOKING_RESCHEDULED':
    case 'BOOKING_CREATED':
    case 'MEETING_STARTED':
    case 'MEETING_ENDED':
    default:
      return 'booked'
  }
}

export async function POST(req: Request) {
  const raw = await req.text()
  const sig = req.headers.get('x-cal-signature-256')
  if (!verifySignature(raw, sig)) {
    return NextResponse.json({ ok: false, error: 'bad_signature' }, { status: 401 })
  }

  let body: CalWebhookBody
  try {
    body = JSON.parse(raw) as CalWebhookBody
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const p = body.payload ?? {}
  const attendee = p.attendees?.[0] ?? {}
  const responses = p.responses ?? {}

  const email =
    pick(responses, ['email']) ?? attendee.email ?? null
  const name =
    pick(responses, ['name', 'fullName']) ?? attendee.name ?? null
  const company = pick(responses, ['company', 'companyName', 'business'])
  const phone = pick(responses, ['phone', 'phoneNumber', 'mobile'])
  const tier = pick(responses, ['tier', 'plan', 'package', 'tierInterest'])
  const notes =
    pick(responses, ['notes', 'additionalNotes', 'message', 'goals']) ??
    p.additionalNotes ??
    null

  const externalId =
    p.uid ?? (p.bookingId != null ? String(p.bookingId) : null)

  try {
    const prospect = await upsertProspect({
      source: 'cal.com',
      external_id: externalId,
      name,
      email,
      company,
      phone,
      tier_interest: tier,
      notes,
      booking_url: p.uid ? `https://cal.com/booking/${p.uid}` : null,
      meeting_at: p.startTime ?? null,
      timezone: attendee.timeZone ?? p.organizer?.timeZone ?? null,
      status: mapStatus(body.triggerEvent),
      payload: body as unknown as Record<string, unknown>,
    })

    // Best-effort admin Telegram ping
    const adminChat = process.env.ADMIN_TELEGRAM_CHAT_ID
    if (adminChat) {
      const when = p.startTime ? new Date(p.startTime).toISOString() : 'TBD'
      const lines = [
        `📅 New booking (${body.triggerEvent ?? 'BOOKING'})`,
        `${name ?? 'Unknown'} <${email ?? 'no-email'}>`,
        company ? `Company: ${company}` : null,
        tier ? `Tier: ${tier}` : null,
        `When: ${when}`,
      ].filter(Boolean) as string[]
      sendTelegramMessage(adminChat, lines.join('\n')).catch(() => {})
    }

    return NextResponse.json({ ok: true, id: prospect.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST Cal.com webhooks here' })
}
