import { NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { syncTrainingDocsToRevRing } from '@/lib/voice/revringKnowledgeBase'
import { audit } from '@/lib/billing/auditLog'

// POST /api/admin/billing/[repId]/sync-revring-kb
//
// Force-syncs the client's active training docs to their RevRing Knowledge
// Base and re-links the KB to all configured agent IDs. Useful after:
//   - Adding new agent IDs to the RevRing integration config
//   - Uploading docs on behalf of a client
//   - Recovering from a failed auto-sync
//
// The client-side training-docs API fires this automatically on every
// upload/toggle/delete, but that sync is fire-and-forget. This endpoint
// is the admin's "force it now and show me the result" escape hatch.

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ repId: string }> },
) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { repId } = await params

  console.info('[sync-revring-kb] admin-triggered sync', { repId })

  const result = await syncTrainingDocsToRevRing(repId)

  await audit({
    actorKind: 'admin',
    action: 'revring.sync_knowledge_base',
    repId,
    after: {
      knowledge_base_id: result.knowledge_base_id,
      docs_uploaded: result.docs_uploaded,
      agents_linked: result.agents_linked.length,
      error: result.error ?? null,
    },
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 })
  }

  return NextResponse.json(result)
}
