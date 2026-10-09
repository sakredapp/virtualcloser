import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { getCurrentMember, getCurrentTenant } from '@/lib/tenant'
import { AssistantBlocked } from '@/lib/assistants'
import { getBrand, type BrandKey } from '@/lib/brand'
import { syncPinnacleAirtable } from '@/lib/pinnacle/airtable'
import { pinnacleConfigured } from '@/lib/pinnacle/load'
import { PINNACLE_CACHE_TAG, computePinnacleOverview, pinnacleComputedAt } from '@/lib/pinnacle/cache'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { acquireSyncLease, releaseSyncLease } from '@/lib/pinnacle/syncLease'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MIN_GAP_MS = 2 * 60_000

/**
 * Refresh button on Overview / Performance / Reports: re-run the Airtable
 * sync and rebuild this tenant's rollup, at most once every two minutes.
 */
export async function POST() {
  const tenant = await getCurrentTenant()
  let member: Awaited<ReturnType<typeof getCurrentMember>> = null
  try {
    member = tenant ? await getCurrentMember() : null
  } catch (e) {
    // An assistant acting for the exec may look, not refresh: a clean 403.
    if (e instanceof AssistantBlocked) return NextResponse.json({ error: e.message }, { status: 403 })
    throw e
  }
  if (!tenant || !member) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const brandKey = ((tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  if (getBrand(brandKey).tabPreset !== 'executive' && !isPinnacleViewer(tenant.id)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  if (!pinnacleConfigured() || !isPinnacleViewer(tenant.id)) {
    return NextResponse.json({ error: 'No book of business is connected to this account yet.' }, { status: 409 })
  }
  const last = await pinnacleComputedAt(tenant.id)
  if (last && Date.now() - new Date(last).getTime() < MIN_GAP_MS) {
    return NextResponse.json({ error: 'Refreshed a moment ago. Try again in two minutes.', computedAt: last }, { status: 429 })
  }
  // Same lease as the cron and the Hetzner tick, held for two minutes: one
  // pull at a time across every caller.
  const lease = await acquireSyncLease(MIN_GAP_MS)
  if (!lease) {
    return NextResponse.json({ error: 'refresh already running', computedAt: last }, { status: 409 })
  }
  try {
    // Continue any due or mid-pull tables for ~80s; the cron finishes the rest.
    let sync: Awaited<ReturnType<typeof syncPinnacleAirtable>>
    try {
      sync = await syncPinnacleAirtable({ deadlineAt: Date.now() + 80_000 })
    } finally {
      await releaseSyncLease(lease).catch(() => {})
    }
    const data = await computePinnacleOverview(tenant.id)
    revalidateTag(PINNACLE_CACHE_TAG)
    return NextResponse.json({ ok: true, computedAt: data.computedAt, synced: sync.ok, syncError: sync.error ?? null })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Refresh failed.' }, { status: 500 })
  }
}
