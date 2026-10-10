/**
 * The company's own Google OAuth client (lib/google/tenantClient). Owner or
 * admin only. The secret goes in and is never returned.
 *   GET    → the masked view
 *   PUT    { clientId, clientSecret, redirectUri? } → save
 *   POST   → "test connection" against Google with what is saved
 *   DELETE → back to the global client
 */
import { NextResponse } from 'next/server'
import { requireExecMember, NotExec } from '@/lib/cxoAccess'
import { getBrand, type BrandKey } from '@/lib/brand'
import { decryptGoogleSecret } from '@/lib/google'
import {
  canManageGoogleClient,
  clearTenantGoogleClient,
  getTenantGoogleClientSetting,
  saveTenantGoogleClient,
  tenantGoogleClientView,
  testGoogleClient,
} from '@/lib/google/tenantClient'

export const dynamic = 'force-dynamic'

async function gate() {
  try {
    const ctx = await requireExecMember()
    if (!canManageGoogleClient(ctx.member)) return { err: NextResponse.json({ error: 'Only the owner or an admin can change this.' }, { status: 403 }) }
    const rootDomain = getBrand((ctx.tenant as { brand?: BrandKey }).brand).rootDomain
    return { ctx, rootDomain }
  } catch (e) {
    if (e instanceof NotExec) return { err: NextResponse.json({ error: 'Executive suite only.' }, { status: 403 }) }
    return { err: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  }
}

export async function GET() {
  const g = await gate()
  if ('err' in g) return g.err
  const setting = await getTenantGoogleClientSetting(g.ctx.tenant.id)
  return NextResponse.json(tenantGoogleClientView(setting, g.rootDomain))
}

export async function PUT(req: Request) {
  const g = await gate()
  if ('err' in g) return g.err
  const body = (await req.json().catch(() => ({}))) as { clientId?: string; clientSecret?: string; redirectUri?: string }
  const r = await saveTenantGoogleClient(g.ctx.tenant.id, body)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 })
  const setting = await getTenantGoogleClientSetting(g.ctx.tenant.id)
  return NextResponse.json(tenantGoogleClientView(setting, g.rootDomain))
}

export async function POST() {
  const g = await gate()
  if ('err' in g) return g.err
  const setting = await getTenantGoogleClientSetting(g.ctx.tenant.id)
  const view = tenantGoogleClientView(setting, g.rootDomain)
  if (!view.own) return NextResponse.json({ ok: false, code: 'not_set', message: view.secretUnreadable ? 'The saved secret cannot be read any more. Enter it again.' : 'Save a client ID and secret first.' }, { status: 400 })
  const check = await testGoogleClient({ clientId: setting!.client_id!, clientSecret: decryptGoogleSecret(setting!.client_secret_enc)!, redirectUri: view.redirectUri })
  return NextResponse.json(check)
}

export async function DELETE() {
  const g = await gate()
  if ('err' in g) return g.err
  await clearTenantGoogleClient(g.ctx.tenant.id)
  return NextResponse.json(tenantGoogleClientView(null, g.rootDomain))
}
