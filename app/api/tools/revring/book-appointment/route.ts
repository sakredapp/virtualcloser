import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAKREDCRM_BOOK_URL = 'https://www.sakredcrm.com/api/booking/health-insurance/book'
const TOOL_SECRET = process.env.REVRING_TOOL_SECRET

type ToolRequest = {
  callId?: string
  tool?: string
  arguments?: {
    start_utc?: string
    lead_name?: string
    lead_phone?: string
    lead_email?: string
    lead_state?: string
    timezone?: string
    tz_name?: string
  }
}

export async function POST(req: NextRequest) {
  if (TOOL_SECRET) {
    const incoming = req.headers.get('x-tool-secret')
    if (incoming !== TOOL_SECRET) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  let body: ToolRequest
  try {
    body = (await req.json()) as ToolRequest
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const args = body.arguments ?? {}
  const startUtc  = args.start_utc  ?? ''
  const leadName  = args.lead_name  ?? ''
  const leadPhone = args.lead_phone ?? ''
  const leadEmail = args.lead_email ?? ''
  const leadState = args.lead_state ?? ''
  const timezone  = args.timezone   ?? 'America/New_York'
  const tzName    = args.tz_name    ?? 'Eastern Time (ET)'

  if (!startUtc) {
    return NextResponse.json('I need the appointment time to complete the booking. Which time did you choose?')
  }

  // Format the confirmed time in the lead's timezone for readback
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
  const confirmedLabel = fmt.format(new Date(startUtc))

  const bookingBody: Record<string, string | number> = { start: startUtc }
  if (leadName)  bookingBody.name  = leadName
  if (leadPhone) bookingBody.phone = leadPhone
  if (leadEmail) bookingBody.email = leadEmail
  if (leadState) bookingBody.state = leadState

  try {
    const res = await fetch(SAKREDCRM_BOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingBody),
    })

    if (res.ok) {
      const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
      const prospectId = json.prospect_id as string | undefined
      const repName    = json.rep_name    as string | undefined
      const repClause  = repName ? ` with ${repName}` : ''
      console.log(`[tool/book-appointment] booked start=${startUtc} prospect_id=${prospectId ?? 'n/a'} rep=${repName ?? 'n/a'} call=${body.callId}`)
      return NextResponse.json(
        `You're all set! Your appointment${repClause} is confirmed for ${confirmedLabel} ${tzName}. You'll get a text confirmation shortly. Any last questions before I let you go?`
      )
    }

    const errText = await res.text().catch(() => '')
    console.error('[tool/book-appointment] booking failed', res.status, errText)
    return NextResponse.json(
      `I wasn't able to lock in that time — it may have just been taken. Let me pull up the current availability again.`
    )
  } catch (err) {
    console.error('[tool/book-appointment] error', err)
    return NextResponse.json(
      `I ran into a technical issue booking that slot. Let me try again — could you confirm the time you'd like one more time?`
    )
  }
}
