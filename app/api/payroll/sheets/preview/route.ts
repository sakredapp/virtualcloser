// Read a connected Google Sheet's data for preview (tab + first rows).

import { NextRequest, NextResponse } from 'next/server'
import { requireMember } from '@/lib/tenant'
import { isAtLeast } from '@/lib/permissions'
import { getSheet, sheetTabs, previewSheet } from '@/lib/payroll/sheets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ctx = await requireMember().catch(() => null)
  const brand = (ctx?.tenant as { brand?: string } | undefined)?.brand ?? ''
  if (!ctx || brand !== 'cxo' || !ctx.member || !isAtLeast(ctx.member.role, 'admin')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const id = req.nextUrl.searchParams.get('id') ?? ''
  const tabParam = req.nextUrl.searchParams.get('tab') ?? ''
  const sheet = await getSheet(ctx.tenant.id, id)
  if (!sheet) return NextResponse.json({ error: 'sheet not found' }, { status: 404 })

  const tabs = await sheetTabs(ctx.tenant.id, sheet.spreadsheet_id, ctx.member.id)
  const tab = tabParam || sheet.default_tab || tabs[0] || ''
  const preview = await previewSheet(ctx.tenant.id, sheet.spreadsheet_id, tab, ctx.member.id)
  if (!preview) {
    return NextResponse.json({ error: "Couldn't read that sheet — check Google is connected and the tab exists." }, { status: 502 })
  }
  return NextResponse.json({ title: sheet.title, tab, tabs, ...preview })
}
