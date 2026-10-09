import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { loadEmployees } from '@/lib/employees/data'
import { applyReview, parseWithClaude, reviewFor, textFromSheetLink, textFromUpload, IngestFileError, type ApplyDecision, type IngestDoc } from '@/lib/employees/ingest'
import { canViewComp } from '@/lib/employees/shared'
import { SheetLinkError } from '@/lib/plan/sheetLink'
import { bookToday } from '@/lib/pinnacle/kpis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const MAX_BYTES = 4_000_000

/**
 * Give it to Mira (Employees).
 *   multipart `file`, or JSON { text } / { link } → Claude reads it → review items (nothing saved)
 *   JSON { action: 'apply', decisions } → saves the reviewed rows
 */
export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    if (err instanceof NotExec) return NextResponse.json({ error: err.message }, { status: 403 })
    return NextResponse.json({ error: 'Sign in again.' }, { status: 401 })
  }
  const repId = ctx.tenant.id
  const comp = canViewComp(ctx.member)
  const today = bookToday(new Date(), ctx.tenant.timezone || 'America/New_York')
  const isForm = (req.headers.get('content-type') ?? '').includes('multipart/form-data')
  try {
    let doc: IngestDoc = { text: '' }
    let source = 'paste'
    if (isForm) {
      const fd = await req.formData()
      const f = fd.get('file')
      if (!(f instanceof File)) return NextResponse.json({ error: 'Choose a file.' }, { status: 400 })
      if (f.size > MAX_BYTES) return NextResponse.json({ error: 'That file is over 4 MB. Split it, or paste the rows.' }, { status: 400 })
      doc = await textFromUpload({ name: f.name, type: f.type, buffer: Buffer.from(await f.arrayBuffer()) })
      source = f.name
    } else {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
      if (body.action === 'apply') {
        const decisions = Array.isArray(body.decisions) ? (body.decisions as ApplyDecision[]) : []
        if (decisions.length === 0) return NextResponse.json({ error: 'Nothing to save.' }, { status: 400 })
        const data = await loadEmployees(repId, comp)
        const res = await applyReview(repId, decisions, data, today, comp)
        return NextResponse.json({ ok: true, ...res })
      }
      if (typeof body.link === 'string' && body.link.trim()) {
        doc = await textFromSheetLink(body.link.trim())
        source = 'Google Sheet'
      } else doc = { text: typeof body.text === 'string' ? body.text.slice(0, 200_000) : '' }
    }
    const chars = 'text' in doc ? doc.text.length : doc.pdfBase64.length
    if ('text' in doc && !doc.text.trim()) return NextResponse.json({ error: 'There is nothing to read in that.' }, { status: 400 })
    const parsed = await parseWithClaude(doc, today, ctx.tenant.claude_api_key)
    const data = await loadEmployees(repId, comp)
    const items = reviewFor(parsed.people, data, today, comp)
    console.log('[employees ingest]', JSON.stringify({ repId, source, chars, people: items.length, ...parsed.usage, costUsd: Number(parsed.costUsd.toFixed(4)) }))
    return NextResponse.json({ ok: true, source, items, unreadable: parsed.unreadable, usage: parsed.usage, costUsd: parsed.costUsd })
  } catch (err) {
    if (err instanceof SheetLinkError || err instanceof IngestFileError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[employees ingest]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Mira could not read that.' }, { status: 500 })
  }
}
