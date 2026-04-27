import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthed } from '@/lib/admin-auth'
import { updateProspect } from '@/lib/prospects'

export async function POST(req: NextRequest) {
  if (!(await isAdminAuthed())) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { prospectId: string; features: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { prospectId, features } = body
  if (!prospectId || typeof prospectId !== 'string') {
    return NextResponse.json({ error: 'prospectId required' }, { status: 400 })
  }
  if (!Array.isArray(features)) {
    return NextResponse.json({ error: 'features must be an array' }, { status: 400 })
  }

  // Only allow known feature keys — strip anything unknown as a safety measure
  const VALID_KEYS = new Set([
    'telegram_bot', 'cal_webhook', 'web_dashboard',
    'bluebubbles', 'ghl', 'google', 'hubspot', 'pipedrive', 'salesforce', 'fathom',
    'zapier', 'custom_api', 'custom_webhook',
    'brain', 'voice_memos', 'team', 'rooms', 'leaderboard', 'roleplay',
  ])
  const clean = features.filter((k) => typeof k === 'string' && VALID_KEYS.has(k))

  await updateProspect(prospectId, { selected_features: clean } as never)

  return NextResponse.json({ ok: true, saved: clean })
}
