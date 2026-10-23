// Self-hosted box only (selfhost/): ask the box's AI one tiny question so the
// installer and golden-test.sh can prove Ciao answers (the client's own model
// when LOCAL_LLM_URL is set, else OpenRouter). Bearer CRON_SECRET; 404
// anywhere SELFHOST is not 1 (so it does nothing on Vercel).
//
//   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<box>/api/cron/selfhost-ai-test

import { NextRequest, NextResponse } from 'next/server'
import { isAuthorizedCron } from '@/lib/cron-auth'
import { openRouterConfigured, openRouterCreate, routeFor } from '@/lib/aiProvider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  if (process.env.SELFHOST !== '1') return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAuthorizedCron(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  if (!openRouterConfigured()) return NextResponse.json({ ok: false, error: 'AI is off: set LOCAL_LLM_URL or LLM_API_KEY in selfhost/.env' }, { status: 400 })

  const params = {
    max_tokens: 16,
    messages: [{ role: 'user' as const, content: 'Reply with the single word OK.' }],
  }
  const started = Date.now()
  try {
    const route = routeFor(params)
    const res = await openRouterCreate(params, route.model)
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('').trim()
    // `provider` says local vs openrouter; the model name stays internal.
    return NextResponse.json({ ok: text.length > 0, provider: route.provider, reply: text.slice(0, 80), ms: Date.now() - started })
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message.slice(0, 300) : 'ai call failed' }, { status: 502 })
  }
}
