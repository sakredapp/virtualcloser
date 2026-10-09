/** Settings › Due-date reminders: in-app and email on/off for the signed-in member. */
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { setReminderPrefs } from '@/lib/dueReminders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const b = ((await req.json().catch(() => ({}))) ?? {}) as { inApp?: unknown; email?: unknown }
  const patch: { inApp?: boolean; email?: boolean } = {}
  if (typeof b.inApp === 'boolean') patch.inApp = b.inApp
  if (typeof b.email === 'boolean') patch.email = b.email
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  try {
    return NextResponse.json({ ok: true, prefs: await setReminderPrefs(ctx.member.id, patch) })
  } catch (err) {
    console.error('[due-reminders prefs]', err)
    return NextResponse.json({ error: 'Could not save that.' }, { status: 500 })
  }
}
