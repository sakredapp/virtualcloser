/**
 * Manual probe for the Pinnacle Airtable. Useful before locking in
 * PINNACLE_AIRTABLE_TABLES + PINNACLE_FIELD_MAP — Spencer can hit this to
 * see what tables/fields actually exist in Brad's base.
 *
 *   GET /api/admin/pinnacle/discover                  — try every candidate
 *   GET /api/admin/pinnacle/discover?table=Foo        — preview one table
 *
 * Admin-cookie gated (same as the rest of /api/admin/*).
 */

import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { previewAirtableTable } from '@/lib/pinnacle/airtable'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANDIDATES = [
  'Applications', 'Apps', 'Submissions', 'Revenue', 'Sales',
  'Leads', 'Customers', 'Deals', 'Pipeline', 'Funded',
  'Approved', 'Funding', 'Clients',
]

export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!process.env.PINNACLE_AIRTABLE_TOKEN || !process.env.PINNACLE_AIRTABLE_BASE_ID) {
    return NextResponse.json(
      { error: 'PINNACLE_AIRTABLE_TOKEN / PINNACLE_AIRTABLE_BASE_ID not set' },
      { status: 503 },
    )
  }
  const single = req.nextUrl.searchParams.get('table')
  if (single) {
    try {
      const preview = await previewAirtableTable(single, 5)
      return NextResponse.json({ table: single, ...preview })
    } catch (err) {
      return NextResponse.json(
        { table: single, error: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      )
    }
  }

  const out: Record<string, { ok: boolean; fields?: string[]; rows?: number; error?: string }> = {}
  await Promise.all(
    CANDIDATES.map(async (name) => {
      try {
        const preview = await previewAirtableTable(name, 1)
        out[name] = { ok: true, fields: preview.fields, rows: preview.sample.length }
      } catch (err) {
        out[name] = { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }),
  )
  return NextResponse.json({ candidates: out })
}
