import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAKREDCRM_SLOTS_URL = 'https://www.sakredcrm.com/api/booking/health-insurance/slots'
const TOOL_SECRET = process.env.REVRING_TOOL_SECRET

type ToolRequest = {
  callId?: string
  tool?: string
  arguments?: {
    timezone?: string
    tz_name?: string
  }
}

export async function POST(req: NextRequest) {
  // Verify shared secret if configured
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

  const timezone = body.arguments?.timezone ?? 'America/New_York'
  const tzName   = body.arguments?.tz_name   ?? 'Eastern Time (ET)'

  let slots: { start: string; end: string }[] = []
  try {
    const res = await fetch(SAKREDCRM_SLOTS_URL, { cache: 'no-store' })
    if (res.ok) {
      const data = (await res.json()) as { slots?: { start: string; end: string }[] }
      slots = data.slots ?? []
    }
  } catch (err) {
    console.error('[tool/get-available-slots] fetch failed', err)
  }

  if (slots.length === 0) {
    return NextResponse.json(
      'I\'m having trouble pulling up available times right now. Let me suggest a few options: would Monday, Tuesday, or Wednesday of next week work for you, and what time of day is best?'
    )
  }

  // Convert UTC slots to lead timezone, deduplicate by day, limit to 5
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })

  const formatted = slots.slice(0, 8).map((s) => {
    const d = new Date(s.start)
    return { utc: s.start, label: fmt.format(d) }
  })

  // Pick up to 5 distinct days — at most 2 slots per day so call isn't overwhelming
  const dayMap = new Map<string, { utc: string; label: string }[]>()
  for (const slot of formatted) {
    const dayKey = new Date(slot.utc).toLocaleDateString('en-US', { timeZone: timezone })
    const existing = dayMap.get(dayKey) ?? []
    if (existing.length < 2) {
      existing.push(slot)
      dayMap.set(dayKey, existing)
    }
    if (dayMap.size >= 3) break
  }

  const picked = Array.from(dayMap.values()).flat().slice(0, 5)

  if (picked.length === 0) {
    return NextResponse.json(
      'I\'m not seeing open slots right now — our calendar may be fully booked for the next few days. Would you like me to have someone follow up with you directly to schedule a time?'
    )
  }

  // Return structured data so Rachel can read natural times AND hold the UTC value for booking
  const lines = picked.map((s, i) => `${i + 1}. ${s.label} ${tzName} (UTC: ${s.utc})`)
  const text = `Here are the next available times:\n${lines.join('\n')}\n\nWhich of these works best for you? Just say the number or the time.`

  return NextResponse.json(text)
}
