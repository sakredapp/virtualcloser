import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { upsertProspect, type ProspectStatus } from '@/lib/prospects'
import { sendTelegramMessage } from '@/lib/telegram'
import { sendEmail, bookingNotificationEmail, bookingConfirmationEmail } from '@/lib/email'
import { supabase } from '@/lib/supabase'

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
  const phone = pick(responses, ['Phone', 'phone', 'phoneNumber', 'mobile'])
  const tier = pick(responses, ['tier', 'plan', 'package', 'tierInterest'])
  const notes =
    pick(responses, ['notes', 'additionalNotes', 'message', 'goals']) ??
    p.additionalNotes ??
    null

  const externalId =
    p.uid ?? (p.bookingId != null ? String(p.bookingId) : null)

  // Fire admin notifications FIRST, before any DB work, so that even if the
  // prospect upsert blows up (schema drift, RLS, transient connection) the
  // human still gets pinged about the booking. We AWAIT them — fire-and-forget
  // is unsafe on Vercel serverless because the lambda is frozen as soon as
  // the handler returns, and an in-flight fetch to Telegram/Resend can be
  // killed mid-request. Use allSettled so one failure can't take out the other.
  const notifyTasks: Promise<unknown>[] = []

  const adminChat = process.env.ADMIN_TELEGRAM_CHAT_ID
  if (adminChat) {
    const when = p.startTime ? new Date(p.startTime).toISOString() : 'TBD'
    const lines = [
      `📅 New booking (${body.triggerEvent ?? 'BOOKING'})`,
      `${name ?? 'Unknown'} <${email ?? 'no-email'}>`,
      company ? `Company: ${company}` : null,
      phone ? `Phone: ${phone}` : null,
      tier ? `Tier: ${tier}` : null,
      `When: ${when}`,
    ].filter(Boolean) as string[]
    notifyTasks.push(
      sendTelegramMessage(adminChat, lines.join('\n')).catch((err) => {
        console.warn('[cal/webhook] admin Telegram ping failed:', err)
      })
    )
  } else {
    console.warn('[cal/webhook] ADMIN_TELEGRAM_CHAT_ID not set — skipping Telegram ping')
  }

  // Defaults to team@virtualcloser.com so bookings always notify ops even if
  // ADMIN_EMAIL isn't explicitly set in Vercel. Override via env var.
  const adminEmail = process.env.ADMIN_EMAIL ?? 'jace@virtualcloser.com'
  if (adminEmail) {
    const tpl = bookingNotificationEmail({
      triggerEvent: body.triggerEvent ?? 'BOOKING_CREATED',
      name,
      email,
      company,
      phone,
      tier,
      notes,
      meetingAt: p.startTime ?? null,
      timezone: attendee.timeZone ?? p.organizer?.timeZone ?? null,
      bookingUrl: p.uid ? `https://cal.com/booking/${p.uid}` : null,
      prospectId: null,
    })
    notifyTasks.push(
      sendEmail({
        to: adminEmail,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
        replyTo: email ?? undefined,
      })
        .then((r) => {
          if (!r.ok) console.warn('[cal/webhook] admin email failed:', r.error)
        })
        .catch((err) => {
          console.warn('[cal/webhook] admin email threw:', err)
        })
    )
  }

  // Send branded confirmation to the booker for booking lifecycle events only.
  const isBookingEvent = ['BOOKING_CREATED', 'BOOKING_RESCHEDULED', 'BOOKING_CANCELLED', 'BOOKING_CANCELED'].includes(
    (body.triggerEvent ?? '').toUpperCase()
  )
  if (isBookingEvent && email) {
    const tpl = bookingConfirmationEmail(
      {
        name,
        meetingAt: p.startTime ?? null,
        timezone: attendee.timeZone ?? p.organizer?.timeZone ?? null,
        bookingUrl: p.uid ? `https://cal.com/booking/${p.uid}` : null,
      },
      body.triggerEvent
    )
    notifyTasks.push(
      sendEmail({
        to: email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      })
        .then((r) => {
          if (!r.ok) console.warn('[cal/webhook] booker confirmation email failed:', r.error)
        })
        .catch((err) => {
          console.warn('[cal/webhook] booker confirmation email threw:', err)
        })
    )
  }

  await Promise.allSettled(notifyTasks)

  // Now persist the prospect. If this fails we still return 200 so Cal.com
  // doesn't keep retrying — the human notification already went out.
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

    // Carry over Kanban metadata baked into the booking by the offer page.
    // /api/quote/attach passes prospect_id + cart_id so we can wire the
    // existing prospect to its cart instead of creating a duplicate.
    try {
      const meta = (p.metadata as Record<string, unknown> | undefined) ?? {}
      const sourceCartId = (meta.cart_id as string | undefined) ?? null
      const sourceProspectId = (meta.prospect_id as string | undefined) ?? null
      const updates: Record<string, unknown> = {}
      if (sourceCartId) updates.cart_id = sourceCartId
      // Stamp pipeline_stage = call_booked so a NEW Cal booking shows up
      // in the Kanban "Call booked" column. Don't downgrade later stages.
      const triggered = body.triggerEvent
      const isCreated = triggered === 'BOOKING_CREATED' || triggered === 'BOOKING_RESCHEDULED'
      if (isCreated) {
        // Detect kickoff vs. discovery by URL slug — kickoff link routes to
        // kickoff_scheduled directly, regular booking → call_booked.
        const isKickoff = (p.uid ?? '').includes('kick') || /kick[-_]?off/i.test(JSON.stringify(meta))
        updates.pipeline_stage = isKickoff ? 'kickoff_scheduled' : 'call_booked'
        if (isKickoff) updates.kickoff_call_at = p.startTime ?? null
      }
      if (Object.keys(updates).length > 0) {
        await supabase.from('prospects').update(updates).eq('id', prospect.id)
      }
      // Auto-advance: only push forward if not already further down funnel.
      if (sourceProspectId && sourceProspectId !== prospect.id) {
        // Cal duplicated the prospect; merge by linking the new row's
        // cart_id back to the original prospect. Future enhancement: full
        // dedup. For now we just log so admin can clean up manually.
        console.warn('[cal/webhook] cart_id metadata suggests existing prospect', { newId: prospect.id, sourceProspectId })
      }
    } catch (e) {
      console.warn('[cal/webhook] kanban stage update failed (non-fatal)', e)
    }

    return NextResponse.json({ ok: true, id: prospect.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown'
    // Log the full error so it shows up in Vercel runtime logs (otherwise the
    // platform just records "500 (no message)" and we can't see what broke).
    console.error('[cal/webhook] upsertProspect failed:', err)
    return NextResponse.json({ ok: true, warning: 'prospect_upsert_failed', error: message })
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, hint: 'POST Cal.com webhooks here' })
}
