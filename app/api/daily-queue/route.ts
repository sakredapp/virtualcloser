import { NextRequest, NextResponse } from 'next/server'
import { requireOrgMember, NotExec } from '@/lib/cxoAccess'
import { requireSignedMember } from '@/lib/agreementWall'
import { QueueRefused, approveQueueItem, dismissQueueItem, runDailyQueue, todayReport } from '@/lib/mira/dailyQueue'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Run daily queue (owner 10-11).
 *   GET  → { report } today's report for the caller, or null when not run today
 *   POST { op: 'run' }                → { report } runs it for the caller
 *   POST { op: 'approve', id, body? } → the caller's own tap on one "needs you" item
 *   POST { op: 'dismiss', id }
 * Always the signed-in person, never a member id from the request.
 */
function denied(err: unknown) {
  if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
  return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
}
function refused(err: unknown) {
  if (err instanceof QueueRefused) return NextResponse.json({ error: err.message }, { status: err.status })
  console.error('[daily-queue]', err)
  return NextResponse.json({ error: 'That did not go through. Try again.' }, { status: 500 })
}

export async function GET() {
  let ctx
  try {
    ctx = await requireOrgMember()
  } catch (err) {
    return denied(err)
  }
  // The daily queue is Ciao: not until the agreement is signed.
  const wall = await requireSignedMember(ctx)
  if (wall) return wall
  try {
    return NextResponse.json({ report: await todayReport(ctx) })
  } catch (err) {
    return refused(err)
  }
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireOrgMember()
  } catch (err) {
    return denied(err)
  }
  // The daily queue is Ciao: not until the agreement is signed.
  const wall = await requireSignedMember(ctx)
  if (wall) return wall
  const b = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id : ''
  try {
    switch (b.op) {
      case 'run':
        return NextResponse.json({ report: await runDailyQueue(ctx, { via: 'app' }) })
      case 'approve':
        return NextResponse.json(await approveQueueItem(ctx, id, { body: typeof b.body === 'string' ? b.body : null }))
      case 'dismiss':
        return NextResponse.json(await dismissQueueItem(ctx, id))
      default:
        return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
    }
  } catch (err) {
    return refused(err)
  }
}
