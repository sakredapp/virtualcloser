import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { updateProspect } from '@/lib/prospects'
import { ADDON_CATALOG, type AddonKey } from '@/lib/addons'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { prospectId: string; addons: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { prospectId, addons } = body
  if (!prospectId || typeof prospectId !== 'string') {
    return NextResponse.json({ error: 'prospectId required' }, { status: 400 })
  }
  if (!Array.isArray(addons)) {
    return NextResponse.json({ error: 'addons must be an array' }, { status: 400 })
  }

  // Filter against the catalog so we never persist an unknown key.
  const clean = addons.filter(
    (k): k is AddonKey => typeof k === 'string' && k in ADDON_CATALOG,
  )

  await updateProspect(prospectId, { selected_addons: clean } as never)

  return NextResponse.json({ ok: true, saved: clean })
}
