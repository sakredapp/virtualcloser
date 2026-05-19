/**
 * Manual probe for any Pinnacle Airtable base. Useful before locking in
 * PINNACLE_AIRTABLE_BASES + PINNACLE_FIELD_MAP — surface what tables and
 * fields actually exist.
 *
 *   GET /api/admin/pinnacle/discover                              — list configured bases
 *   GET /api/admin/pinnacle/discover?baseId=<id>                  — preview every table in that base
 *   GET /api/admin/pinnacle/discover?baseId=<id>&table=Foo        — preview one table
 *
 * Admin-cookie gated (same as the rest of /api/admin/*).
 */

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { previewAirtableTable, getBases } from '@/lib/pinnacle/airtable'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.PINNACLE_AIRTABLE_TOKEN) {
    return NextResponse.json(
      { error: 'PINNACLE_AIRTABLE_TOKEN not set' },
      { status: 503 },
    )
  }
  const bases = getBases()
  if (bases.length === 0) {
    return NextResponse.json(
      { error: 'No bases configured. Set PINNACLE_AIRTABLE_BASES.' },
      { status: 503 },
    )
  }

  const baseId = req.nextUrl.searchParams.get('baseId')
  const single = req.nextUrl.searchParams.get('table')

  // No baseId → list configured bases + their tables so the caller can pick.
  if (!baseId) {
    return NextResponse.json({ bases })
  }

  const base = bases.find((b) => b.baseId === baseId)
  if (!base) {
    return NextResponse.json(
      { error: `baseId ${baseId} not in PINNACLE_AIRTABLE_BASES — configured: ${bases.map((b) => b.baseId).join(', ')}` },
      { status: 400 },
    )
  }

  // Single table preview
  if (single) {
    try {
      const preview = await previewAirtableTable(baseId, single, 5)
      return NextResponse.json({ baseId, table: single, ...preview })
    } catch (err) {
      return NextResponse.json(
        { baseId, table: single, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }
  }

  // All tables in this base
  const out: Record<string, { ok: boolean; fields?: string[]; rows?: number; error?: string }> = {}
  await Promise.all(
    base.tables.map(async (name) => {
      try {
        const preview = await previewAirtableTable(baseId, name, 1)
        out[name] = { ok: true, fields: preview.fields, rows: preview.sample.length }
      } catch (err) {
        out[name] = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )
  return NextResponse.json({ baseId, tables: out })
}
