import { NextRequest, NextResponse } from 'next/server'
import { generateProjectPlan } from '@/lib/claude'
import { createProjectFromPlan, listProjects } from '@/lib/projects'
import { extractDocText } from '@/lib/extractText'
import { requireMember } from '@/lib/tenant'

export const dynamic = 'force-dynamic'
// Plan generation on a long doc can take a while — give it room.
export const maxDuration = 300

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15 MB

export async function GET() {
  const { tenant } = await requireMember()
  const projects = await listProjects(tenant.id)
  return NextResponse.json({ ok: true, projects })
}

export async function POST(req: NextRequest) {
  const { tenant, member } = await requireMember()
  const ownerMemberId = member?.id ?? null

  const contentType = req.headers.get('content-type') ?? ''

  let source = ''
  let titleHint: string | undefined
  let sourceKind: 'prompt' | 'pdf' | 'docx' | 'manual' = 'prompt'

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData()
      const prompt = (form.get('prompt') as string | null)?.trim() ?? ''
      titleHint = (form.get('title') as string | null)?.trim() || undefined
      const file = form.get('file')

      if (file && typeof file === 'object' && 'arrayBuffer' in file) {
        const f = file as File
        if (f.size > MAX_FILE_BYTES) {
          return NextResponse.json({ error: 'File too large (max 15 MB).' }, { status: 413 })
        }
        const buffer = Buffer.from(await f.arrayBuffer())
        const extracted = await extractDocText({ filename: f.name, mime: f.type, buffer })
        if (!extracted.text) {
          return NextResponse.json({ error: 'Could not read any text from that file.' }, { status: 422 })
        }
        sourceKind = extracted.kind === 'pdf' ? 'pdf' : extracted.kind === 'docx' ? 'docx' : 'prompt'
        // A prompt typed alongside the file steers the plan.
        source = prompt ? `${prompt}\n\n---\n\n${extracted.text}` : extracted.text
        if (!titleHint && f.name) titleHint = f.name.replace(/\.[^.]+$/, '')
      } else {
        source = prompt
      }
    } else {
      const body = (await req.json().catch(() => ({}))) as { prompt?: string; title?: string }
      source = (body.prompt ?? '').trim()
      titleHint = body.title?.trim() || undefined
    }
  } catch {
    return NextResponse.json({ error: 'Could not parse request.' }, { status: 400 })
  }

  source = source.trim()
  if (!source) {
    return NextResponse.json({ error: 'Add a prompt or upload a file to build a project.' }, { status: 400 })
  }

  const plan = await generateProjectPlan(source, { repName: tenant.display_name, titleHint })
  if (plan.sections.length === 0) {
    return NextResponse.json({ error: 'The AI could not turn that into a plan. Try adding more detail.' }, { status: 422 })
  }

  const projectId = await createProjectFromPlan({
    repId: tenant.id,
    ownerMemberId,
    plan,
    sourceKind,
    sourceText: source.slice(0, 50_000),
  })

  return NextResponse.json({ ok: true, projectId })
}
