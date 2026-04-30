import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { supabase } from '@/lib/supabase'
import { sendEmail, bookingReminderEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ProspectRow = {
  id: string
  name: string | null
  email: string | null
  meeting_at: string | null
  timezone: string | null
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const now = Date.now()

  // 24h window: meeting is 23–25 hours from now
  const h24Low  = new Date(now + 23 * 60 * 60 * 1000).toISOString()
  const h24High = new Date(now + 25 * 60 * 60 * 1000).toISOString()

  // 1h window: meeting is 45–75 minutes from now
  const h1Low  = new Date(now + 45 * 60 * 1000).toISOString()
  const h1High = new Date(now + 75 * 60 * 1000).toISOString()

  const [{ data: remind24 }, { data: remind1h }] = await Promise.all([
    supabase
      .from('prospects')
      .select('id, name, email, meeting_at, timezone')
      .eq('status', 'booked')
      .not('email', 'is', null)
      .gte('meeting_at', h24Low)
      .lte('meeting_at', h24High)
      .is('reminder_24h_sent_at', null),
    supabase
      .from('prospects')
      .select('id, name, email, meeting_at, timezone')
      .eq('status', 'booked')
      .not('email', 'is', null)
      .gte('meeting_at', h1Low)
      .lte('meeting_at', h1High)
      .is('reminder_1h_sent_at', null),
  ])

  const sentAt = new Date().toISOString()
  const tasks: Promise<void>[] = []

  for (const row of (remind24 ?? []) as ProspectRow[]) {
    if (!row.email) continue
    const tpl = bookingReminderEmail({ name: row.name, meetingAt: row.meeting_at, timezone: row.timezone }, '24h')
    tasks.push(
      sendEmail({ to: row.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
        .then(async (r) => {
          if (!r.ok) { console.warn('[booking-reminders] 24h email failed:', row.id, r.error); return }
          await supabase.from('prospects').update({ reminder_24h_sent_at: sentAt }).eq('id', row.id)
        })
        .catch((err) => console.warn('[booking-reminders] 24h threw:', row.id, err))
    )
  }

  for (const row of (remind1h ?? []) as ProspectRow[]) {
    if (!row.email) continue
    const tpl = bookingReminderEmail({ name: row.name, meetingAt: row.meeting_at, timezone: row.timezone }, '1h')
    tasks.push(
      sendEmail({ to: row.email, subject: tpl.subject, html: tpl.html, text: tpl.text })
        .then(async (r) => {
          if (!r.ok) { console.warn('[booking-reminders] 1h email failed:', row.id, r.error); return }
          await supabase.from('prospects').update({ reminder_1h_sent_at: sentAt }).eq('id', row.id)
        })
        .catch((err) => console.warn('[booking-reminders] 1h threw:', row.id, err))
    )
  }

  await Promise.allSettled(tasks)

  return NextResponse.json({
    ok: true,
    sent_24h: remind24?.length ?? 0,
    sent_1h: remind1h?.length ?? 0,
  })
}
