import { redirect } from 'next/navigation'
import { requireMember } from '@/lib/tenant'
import { getBrand, type BrandKey } from '@/lib/brand'
import { isPinnacleViewer } from '@/lib/pinnacle/rollup'
import { ensureStarterBoard } from '@/lib/boards'
import BoardsClient from './BoardsClient'

export const dynamic = 'force-dynamic'

/** Boards — the exec's own boards: columns, cards, owners (team or partners). */
export default async function BoardsPage() {
  const ctx = await requireMember()
  const brandKey = ((ctx.tenant as { brand?: BrandKey }).brand ?? 'virtualcloser') as BrandKey
  const isExec = getBrand(brandKey).tabPreset === 'executive'
  if (!isExec && !isPinnacleViewer(ctx.tenant.id)) redirect('/dashboard')
  // Never an empty page: first visit opens a ready-made To-do board to name.
  let fresh = false
  try {
    fresh = await ensureStarterBoard(ctx.tenant.id, ctx.member.id)
  } catch {
    // Boards tables missing — the client shows its "being set up" notice.
  }
  return <BoardsClient fresh={fresh} />
}
