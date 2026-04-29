import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { supabase } from '@/lib/supabase'
import { getIntegrationConfig } from '@/lib/client-integrations'
import { provisionVapiForRep } from '@/lib/voice/vapiProvision'
import {
  createTrainingDoc,
  deleteTrainingDoc,
  setTrainingDocActive,
  listTrainingDocsForMember,
  type TrainingDocKind,
  type TrainingDocScope,
} from '@/lib/roleplay'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'roleplay-training'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB
const MAX_DOCS_PER_TENANT = 200    // hard cap to prevent runaway uploads
const ALLOWED_KINDS: TrainingDocKind[] = [
  'product_brief',
  'script',
  'objection_list',
  'case_study',
  'training',
  'reference',
]

/**
 * Tenant-side training-doc CRUD.
 *
 * GET    → list active docs visible to the calling member
 * POST   → multipart upload OR JSON body with inline `body`. Saves the file
 *          to the `roleplay-training` bucket scoped to the rep_id and creates
 *          a roleplay_training_docs row.
 * PATCH  → toggle is_active by id
 * DELETE → soft-delete by id (?id=...)
 *
 * Files accepted: .pdf, .txt, .md, .docx (we don't OCR PDFs at runtime —
 * Vapi's referenced doc tooling reads the file via signed URL and the
 * provisioner inlines text bodies into the system prompt). For now PDF/DOCX
 * land in storage and the assistant references them by signed URL; .txt /.md
 * also get inlined into prompt addendums.
 */

const ALLOWED_MIME = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
])

export async function GET() {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const docs = await listTrainingDocsForMember(ctx.tenant.id, ctx.member.id)
  return NextResponse.json({ ok: true, docs })
}

/** Fire-and-forget Vapi re-provision when a training doc changes. */
async function syncVapi(repId: string): Promise<void> {
  try {
    const cfg = await getIntegrationConfig(repId, 'vapi')
    if (cfg?.api_key) {
      await provisionVapiForRep(repId)
    }
  } catch (err) {
    console.error('[training-docs] vapi resync failed', err)
  }
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // Quota check — count active docs for this tenant.
  {
    const { count } = await supabase
      .from('roleplay_training_docs')
      .select('id', { head: true, count: 'exact' })
      .eq('rep_id', ctx.tenant.id)
      .eq('is_active', true)
    if ((count ?? 0) >= MAX_DOCS_PER_TENANT) {
      return NextResponse.json(
        {
          ok: false,
          error: `Upload limit reached (${MAX_DOCS_PER_TENANT} active docs). Delete or deactivate older docs first.`,
        },
        { status: 429 },
      )
    }
  }

  const ct = req.headers.get('content-type') || ''

  // ── JSON path: inline text body ────────────────────────────────────
  if (ct.includes('application/json')) {
    const body = (await req.json().catch(() => ({}))) as {
      title?: string
      doc_kind?: TrainingDocKind
      scope?: TrainingDocScope
      body?: string
    }
    if (!body.title || !body.body) {
      return NextResponse.json(
        { ok: false, error: 'title and body required' },
        { status: 400 },
      )
    }
    const kind: TrainingDocKind = ALLOWED_KINDS.includes(body.doc_kind as TrainingDocKind)
      ? (body.doc_kind as TrainingDocKind)
      : 'reference'
    const doc = await createTrainingDoc(ctx.tenant.id, ctx.member.id, {
      title: body.title,
      doc_kind: kind,
      scope: body.scope === 'personal' ? 'personal' : 'account',
      body: body.body,
    })
    await syncVapi(ctx.tenant.id)
    return NextResponse.json({ ok: true, doc })
  }

  // ── Multipart path: file upload ────────────────────────────────────
  const form = await req.formData()
  const file = form.get('file')
  const title = String(form.get('title') ?? '').trim()
  const kindRaw = String(form.get('doc_kind') ?? 'reference') as TrainingDocKind
  const scope = (String(form.get('scope') ?? 'account') === 'personal'
    ? 'personal'
    : 'account') as TrainingDocScope

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'file too large (max 10MB)' }, { status: 413 })
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json(
      { ok: false, error: `unsupported type ${file.type}` },
      { status: 415 },
    )
  }
  const kind: TrainingDocKind = ALLOWED_KINDS.includes(kindRaw) ? kindRaw : 'reference'

  const buf = new Uint8Array(await file.arrayBuffer())
  const safeName = file.name.replace(/[^a-z0-9.\-_]/gi, '_').slice(0, 80)
  const storagePath = `${ctx.tenant.id}/${Date.now()}_${safeName}`

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buf, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    })
  if (upErr) {
    return NextResponse.json(
      { ok: false, error: `upload failed: ${upErr.message}` },
      { status: 500 },
    )
  }

  // For .txt / .md we ALSO inline the body so the Vapi prompt provisioner
  // can stitch the content directly into the assistant system prompt.
  let inlineBody: string | null = null
  if (file.type === 'text/plain' || file.type === 'text/markdown') {
    try {
      inlineBody = new TextDecoder('utf-8').decode(buf).slice(0, 20_000)
    } catch {
      inlineBody = null
    }
  }

  const doc = await createTrainingDoc(ctx.tenant.id, ctx.member.id, {
    title: title || file.name,
    doc_kind: kind,
    scope,
    body: inlineBody,
    storage_path: storagePath,
  })
  await syncVapi(ctx.tenant.id)
  return NextResponse.json({ ok: true, doc })
}

export async function PATCH(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; is_active?: boolean }
  if (!body.id || typeof body.is_active !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'id and is_active required' }, { status: 400 })
  }
  await setTrainingDocActive(ctx.tenant.id, body.id, body.is_active)
  await syncVapi(ctx.tenant.id)
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  await deleteTrainingDoc(ctx.tenant.id, id)
  await syncVapi(ctx.tenant.id)
  return NextResponse.json({ ok: true })
}
