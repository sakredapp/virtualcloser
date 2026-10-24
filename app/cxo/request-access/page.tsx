import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { enforceRateLimit } from '@/lib/rateLimit'
import CxAuthCard from '@/app/components/cxo/CxAuthCard'
import { cxoPageMeta } from '@/lib/seo'
import { safeProspectId } from '@/lib/whopPixel'
import { LeadSent, RememberLeadContact } from './LeadPixel'
import SlotPicker from './SlotPicker'
import { bookCxoSlot, cxoCallIcs, easternLabel, fetchCxoSlots } from '@/lib/cxoBooking'
import {
  CXO_REQUEST_NOTICE_TO,
  cxoCallBookedEmail,
  cxoRequestNoticeEmail,
  cxoRequestReceivedEmail,
  sendEmail,
} from '@/lib/email'
import { alertOperator } from '@/lib/alerts'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = cxoPageMeta(
  '/cxo/request-access',
  'Book a call',
  'Tell us about your company and book a call: the Suite CXO cloud plan or a custom build.',
)

/** What the request is about. The home page links preselect one with ?interest=. */
const INTERESTS = [
  { id: 'cloud', label: 'The cloud plan' },
  { id: 'build', label: 'A custom build' },
  { id: 'unsure', label: 'Not sure yet' },
  { id: 'private', label: 'Private build (on a server you own)' },
] as const

/** The picker link in the prospect's email always opens on the Suite CXO site. */
const PICK_ORIGIN = 'https://www.suitecxo.com'

type Booking = { start: string; end: string | null; event_created: boolean; booked_at: string }
type RequestRow = { id: string; name: string | null; email: string | null; company: string | null; notes: string | null; payload: Record<string, unknown> | null }

async function loadRequest(leadId: string): Promise<RequestRow | null> {
  const { data } = await supabase
    .from('prospects')
    .select('id, name, email, company, notes, payload')
    .eq('id', leadId)
    .eq('source', 'cxo_request_access')
    .maybeSingle()
  return (data as RequestRow | null) ?? null
}

function bookingOf(row: RequestRow | null): Booking | null {
  const b = row?.payload?.booking as Booking | undefined
  return b && typeof b.start === 'string' ? b : null
}

/**
 * Suite CXO "Book a call" (the login card's "Request access" link and the
 * home page's call buttons). On send it saves the request as a prospect,
 * emails the prospect a Suite CXO link to pick a time and tells the owner
 * (jace@virtualcloser.com). The thank-you card shows the owner's open times
 * (Monday to Friday, 9 to 5 Eastern) and books the one picked on the owner's
 * Google calendar through lib/cxoBooking.ts.
 * Lives under /cxo so it is public on every CXO host, including a tenant's
 * own login host (where /demo is the Virtual Closer demo).
 */
export default async function CxoRequestAccessPage({ searchParams }: { searchParams?: Promise<{ sent?: string; error?: string; interest?: string; lead?: string }> }) {
  const params = (await searchParams) ?? {}

  async function requestAccess(fd: FormData) {
    'use server'
    const str = (k: string, max: number) => String(fd.get(k) ?? '').trim().slice(0, max)
    // Honeypot: real people never fill this field.
    if (str('website', 200)) redirect('/cxo/request-access?sent=1')
    const name = str('name', 120)
    const email = str('email', 200).toLowerCase()
    const company = str('company', 160)
    const role = str('role', 120)
    const notes = str('notes', 2000)
    const interestId = str('interest', 20)
    const interest = INTERESTS.find((i) => i.id === interestId)?.id ?? null
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect('/cxo/request-access?error=missing')
    const h = await headers()
    const ip = (h.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown'
    const rl = await enforceRateLimit(`cxo_request_access:${ip}`, 5, 3600)
    if (!rl.allowed) redirect('/cxo/request-access?error=busy')
    const { data: saved, error } = await supabase.from('prospects').insert({
      source: 'cxo_request_access',
      name,
      email,
      company: company || null,
      tier_interest: 'cxo',
      notes: [interest ? `Interest: ${interest}` : '', role ? `Role: ${role}` : '', notes].filter(Boolean).join('\n') || null,
      status: 'new',
      payload: { via: 'cxo_login', role: role || null, interest, host: h.get('host') ?? null },
    }).select('id').maybeSingle()
    if (error) {
      console.error('[cxo request-access] save failed', error.message)
      redirect('/cxo/request-access?error=save')
    }
    // The prospect id is the Whop Pixel lead's event_id (LeadPixel.tsx). No name or email in the URL.
    const leadId = safeProspectId((saved as { id?: unknown } | null)?.id)
    if (leadId) {
      const interestLabel = INTERESTS.find((i) => i.id === interest)?.label ?? null
      const toProspect = cxoRequestReceivedEmail({ name, pickUrl: `${PICK_ORIGIN}/cxo/request-access?sent=1&lead=${leadId}` })
      const notice = cxoRequestNoticeEmail({ kind: 'request', name, email, company, role, interest: interestLabel, notes, prospectId: leadId })
      const [a, b] = await Promise.all([
        sendEmail({ to: email, ...toProspect, brand: 'cxo' }),
        sendEmail({ to: CXO_REQUEST_NOTICE_TO, ...notice, replyTo: email, brand: 'cxo' }),
      ])
      if (!a.ok || !b.ok) {
        await alertOperator({
          key: `cxo_request_email:${leadId}`,
          title: 'Suite CXO call request email did not send',
          body: `A Suite CXO call request was saved (prospect ${leadId}) but an email failed. Prospect email: ${a.ok ? 'sent' : a.error}. Owner notice: ${b.ok ? 'sent' : b.error}.`,
        })
      }
    }
    redirect(leadId ? `/cxo/request-access?sent=1&lead=${leadId}` : '/cxo/request-access?sent=1')
  }

  async function bookCall(fd: FormData) {
    'use server'
    const leadId = safeProspectId(String(fd.get('lead') ?? ''))
    const start = String(fd.get('start') ?? '').trim().slice(0, 64)
    if (!leadId) redirect('/cxo/request-access?sent=1')
    const back = `/cxo/request-access?sent=1&lead=${leadId}`
    const row = await loadRequest(leadId)
    if (!row?.email || !row.name) redirect(back)
    if (bookingOf(row)) redirect(back)
    // Only a time the calendar is offering right now; its offer_ref goes back with it.
    const slots = await fetchCxoSlots()
    const slot = slots?.find((s) => s.start === start)
    if (!slot) redirect(`${back}&error=taken`)
    const res = await bookCxoSlot({ start: slot.start, offerRef: slot.offer_ref, name: row.name, email: row.email })
    if (!res.ok) {
      if (!res.taken) {
        await alertOperator({
          key: `cxo_book_failed:${leadId}`,
          title: 'Suite CXO call booking failed',
          body: `A Suite CXO prospect (${leadId}) picked ${easternLabel(slot.start)} and the booking API refused: ${res.error}. They were asked to pick another time; reach out if they do not.`,
        })
      }
      redirect(`${back}&error=${res.taken ? 'taken' : 'book'}`)
    }
    const booking: Booking = { start: res.start, end: res.end, event_created: res.eventCreated, booked_at: new Date().toISOString() }
    const { error } = await supabase
      .from('prospects')
      .update({ payload: { ...(row.payload ?? {}), booking, vc_prospect_id: res.prospectId }, status: 'booked', pipeline_stage: 'call_booked', meeting_at: res.start, timezone: 'America/New_York' })
      .eq('id', leadId)
    if (error) console.error('[cxo request-access] booking save failed', error.message)
    const whenLabel = easternLabel(res.start)
    const [a, b] = await Promise.all([
      sendEmail({
        to: row.email,
        ...cxoCallBookedEmail({ name: row.name, whenLabel }),
        attachments: [{ filename: 'suite-cxo-call.ics', content: Buffer.from(cxoCallIcs({ start: res.start, end: res.end, uid: leadId })), contentType: 'text/calendar; charset=utf-8' }],
        brand: 'cxo',
      }),
      sendEmail({
        to: CXO_REQUEST_NOTICE_TO,
        ...cxoRequestNoticeEmail({ kind: 'booked', name: row.name, email: row.email, company: row.company, notes: row.notes, whenLabel, calendarEvent: res.eventCreated, prospectId: leadId }),
        replyTo: row.email,
        brand: 'cxo',
      }),
    ])
    if (!a.ok || !b.ok || !res.eventCreated) {
      await alertOperator({
        key: `cxo_booked_followup:${leadId}`,
        title: 'Suite CXO call booked, check the follow-up',
        body: `Prospect ${leadId} booked ${whenLabel}. Calendar event: ${res.eventCreated ? 'created' : 'NOT created'}. Prospect confirmation: ${a.ok ? 'sent' : a.error}. Owner notice: ${b.ok ? 'sent' : b.error}.`,
      })
    }
    redirect(back)
  }

  if (params.sent === '1') {
    const leadId = safeProspectId(params.lead)
    const row = leadId ? await loadRequest(leadId) : null
    const booked = bookingOf(row)
    if (booked) {
      return (
        <CxAuthCard title="Your call is booked" sub="A confirmation with a calendar file is on its way to your email.">
          <div className="cx-booked">
            <strong>{easternLabel(booked.start)}</strong>
            <span>30 minute call with Suite CXO</span>
          </div>
          <p className="cx-login-links">
            <span>Need another time? Reply to the confirmation email.</span>
          </p>
          <Link href="/cxo" className="cx-login-submit">
            Back to Suite CXO
          </Link>
        </CxAuthCard>
      )
    }
    const slots = row ? await fetchCxoSlots() : null
    const bookErr =
      params.error === 'taken'
        ? 'That time was just taken. Please pick another.'
        : params.error === 'book'
          ? 'That did not book. Please pick another time.'
          : null
    return (
      <CxAuthCard
        title="Request received"
        sub={row && slots?.length ? 'Thank you. Pick a time for your call.' : 'Thank you. We emailed you a link to book your call, and our team will reach out.'}
      >
        {leadId && <LeadSent prospectId={leadId} />}
        {bookErr && (
          <p className="cx-login-error" role="alert">
            {bookErr}
          </p>
        )}
        {row && leadId && slots && slots.length > 0 ? (
          <SlotPicker slots={slots.map(({ start, dayKey, dayLabel, timeLabel }) => ({ start, dayKey, dayLabel, timeLabel }))} leadId={leadId} action={bookCall} />
        ) : (
          <Link href="/cxo" className="cx-login-submit">
            Back to Suite CXO
          </Link>
        )}
      </CxAuthCard>
    )
  }

  const err =
    params.error === 'missing'
      ? 'Please add your name and a work email.'
      : params.error === 'busy'
        ? 'Too many requests from this network. Try again in an hour.'
        : params.error === 'save'
          ? 'That did not save. Please try again.'
          : null

  const preset = INTERESTS.find((i) => i.id === params.interest)?.id ?? ''

  return (
    <CxAuthCard title="Book a call" sub="Tell us about your company. We'll show you what we'd build and which option fits.">
      {err && (
        <p className="cx-login-error" role="alert">
          {err}
        </p>
      )}
      <RememberLeadContact formId="cxo-request-access-form" />
      <form id="cxo-request-access-form" action={requestAccess} className="cx-login-form">
        <label className="cx-login-field">
          <span>Name</span>
          <input name="name" required autoFocus autoComplete="name" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Work email</span>
          <input name="email" type="email" required autoComplete="email" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Company</span>
          <input name="company" autoComplete="organization" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Role</span>
          <input name="role" autoComplete="organization-title" className="cx-login-input" />
        </label>
        <label className="cx-login-field">
          <span>Interested in</span>
          <select name="interest" defaultValue={preset} className="cx-login-input" style={{ font: 'inherit' }}>
            <option value="">Choose one</option>
            {INTERESTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="cx-login-field">
          <span>Anything we should know</span>
          <textarea name="notes" rows={3} className="cx-login-input" />
        </label>
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px' }} />
        <button type="submit" className="cx-login-submit">
          Send
        </button>
      </form>
      <p className="cx-login-links">
        <Link href="/login">Back to sign in</Link>
        <span aria-hidden="true">·</span>
        <Link href="/cxo/demo">See the demo</Link>
      </p>
    </CxAuthCard>
  )
}
