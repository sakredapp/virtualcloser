import { NextRequest, NextResponse } from 'next/server'
import { requireTenant } from '@/lib/tenant'
import { getPipelinesForRep, createPipeline, type PipelineKind } from '@/lib/pipelines'

export const dynamic = 'force-dynamic'

const VALID_KINDS: PipelineKind[] = ['sales', 'recruiting', 'team', 'project', 'custom']

export async function GET() {
  try {
    const tenant = await requireTenant()
    const pipelines = await getPipelinesForRep(tenant.id)
    return NextResponse.json({ pipelines })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const tenant = await requireTenant()
    const body = (await req.json().catch(() => ({}))) as {
      name?: string
      kind?: string
      description?: string | null
    }
    const name =
      typeof body.name === 'string' && body.name.trim()
        ? body.name.trim()
        : 'My Pipeline'
    const kind: PipelineKind = VALID_KINDS.includes(body.kind as PipelineKind)
      ? (body.kind as PipelineKind)
      : 'sales'
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim()
        : null
    const pipeline = await createPipeline(tenant.id, name, { kind, description })
    return NextResponse.json({ pipeline })
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
}
