// Heuristic import: pull a connected sheet's rows into commission_entries.

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { getSheet, importCommissionsFromSheet } from '@/lib/payroll/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ctx = await requireMember().catch(() => null)
  const brand = (ctx?.tenant as { brand?: string } | undefined)?.brand ?? ''
  if (!ctx || brand !== 'cxo' || !ctx.member || !isAtLeast(ctx.member.role, 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const body = (await req.json().catch(() => ({}))) as { id?: string; tab?: string }
  const sheet = await getSheet(ctx.tenant.id, body.id ?? '')
  if (!sheet) return NextResponse.json({ error: 'sheet not found' }, { status: 404 })

  const tab = (body.tab || sheet.default_tab || '').trim()
  const result = await importCommissionsFromSheet(ctx.tenant.id, sheet.spreadsheet_id, tab, ctx.member.id)
  if (!result) return NextResponse.json({ error: "Couldn't read that sheet to import." }, { status: 502 })
  return NextResponse.json(result)
}
