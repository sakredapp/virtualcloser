import { NextRequest, NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { canViewComp } from '@/lib/employees/shared'
import { knownNames, logUpload, saveCompRates, saveTargets } from '@/lib/plan/data'
import { buildReview, type UploadKind, type UploadSource } from '@/lib/plan/importShared'
import { MAX_UPLOAD_BYTES, readUpload, sourceOf, UploadError } from '@/lib/plan/importServer'
import { fetchSheetCsv, SheetLinkError } from '@/lib/plan/sheetLink'
import { parseAmount, type PlanTarget } from '@/lib/plan/shared'
import { uniqueNames } from '@/lib/plan/match'
import type { CompRate } from '@/lib/plan/comp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Sales Plan uploads (the plan, and comp grids).
 *   POST multipart { file, kind, year }  or  JSON { action:'parse', link, kind, year }
 *     → { draft, review }  — read only; nothing is saved.
 *   POST JSON { action:'save', kind, year, ... rows } → saves what the review produced.
 * Comp grids are exec-only like comp (canViewComp).
 */

const yearOf = (v: unknown) => {
  const y = Math.round(Number(v))
  return y >= 2020 && y <= 2100 ? y : null
}
const txt = (v: unknown, max = 120) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const amt = (v: unknown) => (v == null || v === '' ? null : typeof v === 'number' ? (Number.isFinite(v) ? v : null) : parseAmount(String(v)))
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status })

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireExecMember()
  } catch (err) {
    if (err instanceof NotExec) return bad(err.message, 403)
    return bad('Sign in again.', 401)
  }
  const repId = ctx.tenant.id
  const isForm = (req.headers.get('content-type') || '').includes('multipart/form-data')
  let body: Record<string, unknown> = {}
  let file: File | null = null
  if (isForm) {
    const fd = await req.formData().catch(() => null)
    if (!fd) return bad('That upload did not come through. Try again.')
    for (const [k, v] of fd.entries()) {
      if (typeof v === 'string') body[k] = v
      else if (k === 'file') file = v
    }
    body.action = 'parse'
  } else {
    body = ((await req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  }
  const kind: UploadKind = body.kind === 'comp' ? 'comp' : 'plan'
  if (kind === 'comp' && !canViewComp(ctx.member)) return bad('Comp grids are for the exec team only.', 403)
  const year = yearOf(body.year)
  if (!year) return bad('Pick a plan year.')

  if (body.action === 'parse') {
    let source: UploadSource
    let filename: string
    let bytes: Uint8Array | null = null
    let text: string | undefined
    try {
      if (file) {
        if (file.size > MAX_UPLOAD_BYTES) return bad('That file is over 4MB. Save just the plan sheet, or as CSV, and try again.')
        bytes = new Uint8Array(await file.arrayBuffer())
        const s = sourceOf(file.name || '', bytes)
        if (!s) return bad('Upload an XLSX, XLS, CSV or PDF, or paste a Google Sheets link.')
        source = s
        filename = (file.name || 'upload').slice(0, 200)
      } else if (typeof body.link === 'string' && body.link.trim()) {
        text = await fetchSheetCsv(body.link)
        source = 'sheet'
        filename = 'Google Sheet'
      } else {
        return bad('Choose a file or paste a Google Sheets link.')
      }
      const [draft, known] = await Promise.all([
        readUpload({ kind, year, filename, source, bytes, text }),
        knownNames(repId, year, ctx.tenant.timezone),
      ])
      const review = buildReview(draft, known)
      return NextResponse.json({ ok: true, draft, review })
    } catch (err) {
      if (err instanceof SheetLinkError || err instanceof UploadError) return bad(err.message, 422)
      console.error('[plan upload] parse', err)
      return bad("That file couldn't be read just now. Try again, or save it as XLSX or CSV.", 500)
    }
  }

  if (body.action === 'save') {
    const meta = {
      filename: txt(body.filename, 200) || 'upload',
      source: ['xlsx', 'xls', 'csv', 'pdf', 'sheet'].includes(String(body.source)) ? String(body.source) : 'file',
      read_by: body.readBy === 'claude' ? ('claude' as const) : ('rules' as const),
      ai_cost_usd: Math.max(0, Math.min(10, Number(body.costUsd) || 0)),
      member_id: (ctx.member as { id?: string } | null)?.id ?? null,
      member_name: ((ctx.member as { display_name?: string | null; email?: string | null } | null)?.display_name || (ctx.member as { email?: string | null } | null)?.email || null)?.slice(0, 120) ?? null,
    }
    try {
      if (kind === 'plan') {
        const raw = Array.isArray(body.targets) ? (body.targets as Array<Record<string, unknown>>) : []
        if (!raw.length) return bad('Nothing to save. Every row was skipped.')
        if (raw.length > 20000) return bad('That is more rows than a plan needs. Split it up.')
        const cells: PlanTarget[] = raw
          .map((c) => ({ year, month: Math.round(Number(c.month)), product: txt(c.product), carrier: txt(c.carrier), premium: amt(c.premium) ?? 0, policies: amt(c.policies) == null ? null : Math.round(amt(c.policies)!) }))
          .filter((c) => c.month >= 1 && c.month <= 12 && (c.product || c.carrier))
        const saved = await saveTargets(repId, year, cells, body.replace === true)
        const id = await logUpload(repId, { kind, year, ...meta, rows_saved: saved, carriers: uniqueNames(cells.map((c) => c.carrier)).length, products: uniqueNames(cells.map((c) => c.product)).length })
        return NextResponse.json({ ok: true, saved, uploadId: id })
      }
      const raw = Array.isArray(body.rates) ? (body.rates as Array<Record<string, unknown>>) : []
      if (!raw.length) return bad('Nothing to save. Every row was skipped.')
      if (raw.length > 5000) return bad('That is more rows than a comp grid needs. Split it up.')
      const rates: CompRate[] = raw
        .map((r) => ({
          product: txt(r.product),
          carrier: txt(r.carrier),
          agency_rate: amt(r.agency_rate) ?? NaN,
          payout_rate: null,
          payout_level: null,
          agent_levels: (Array.isArray(r.agent_levels) ? (r.agent_levels as Array<Record<string, unknown>>) : [])
            .map((l) => ({ level: txt(l.level, 60), rate: amt(l.rate) ?? NaN }))
            .filter((l) => l.level && Number.isFinite(l.rate)),
        }))
        .filter((r) => r.carrier && Number.isFinite(r.agency_rate))
      const uploadId = await logUpload(repId, { kind, year, ...meta, rows_saved: rates.length, carriers: uniqueNames(rates.map((r) => r.carrier)).length, products: uniqueNames(rates.map((r) => r.product)).length })
      const saved = await saveCompRates(repId, rates, uploadId, body.replace === true)
      return NextResponse.json({ ok: true, saved, uploadId })
    } catch (err) {
      console.error('[plan upload] save', err)
      return bad(err instanceof Error ? err.message : 'Could not save.', 500)
    }
  }
  return bad('Unknown action.')
}
