/**
 * Daily 11:00 UTC: board due-date reminders (in-app) + the "Due soon" email
 * for members who turned it on. CRON_SECRET only.
 *   ?member=<id>  limit the run to one member (testing)
 *   ?render=1     return the digest HTML instead of sending; writes nothing
 */
import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { runDueReminders, sendDueDigests, remindersMissing } from '@/lib/dueReminders'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const memberId = url.searchParams.get('member')
  if (memberId && !/^[0-9a-f-]{36}$/i.test(memberId)) return NextResponse.json({ error: 'bad member' }, { status: 400 })
  const render = url.searchParams.get('render') === '1'
  try {
    if (render) {
      const digests = await sendDueDigests({ memberId, render: true })
      return NextResponse.json({ ok: true, digests })
    }
    const reminders = await runDueReminders({ memberId })
    const digests = (await sendDueDigests({ memberId })).map(({ html: _h, ...d }) => d)
    return NextResponse.json({ ok: true, reminders, digests })
  } catch (err) {
    if (remindersMissing(err)) return NextResponse.json({ ok: true, skipped: 'tables missing' })
    console.error('[cron/due-reminders]', err)
    return NextResponse.json({ ok: false, error: (err as Error).message ?? 'failed' }, { status: 500 })
  }
}
