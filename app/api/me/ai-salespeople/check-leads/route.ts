// Standalone dedup check used by the bulk-import UI BEFORE the user confirms.
// POST { phones: string[], ai_salesperson_id?: string } → { ok, conflicts }
import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { checkLeadConflicts } from '@/lib/ai-salesperson'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return digits.startsWith('+') ? raw.trim() : `+${digits}`
}

export async function POST(req: NextRequest) {
  let ctx
  try {
    ctx = await requireMember()
  } catch {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let body: { phones?: string[]; ai_salesperson_id?: string | null }
  try {
    body = (await req.json()) as { phones?: string[]; ai_salesperson_id?: string | null }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const phones = Array.isArray(body.phones)
    ? Array.from(new Set(body.phones.filter((p) => typeof p === 'string' && p.trim()).map(normalizePhone)))
    : []
  if (phones.length === 0) {
    return NextResponse.json({ ok: true, conflicts: [] })
  }

  try {
    const conflicts = await checkLeadConflicts(ctx.tenant.id, phones, body.ai_salesperson_id ?? null)
    return NextResponse.json({ ok: true, conflicts })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
